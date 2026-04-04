import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas / newlines)
// ---------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a full CSV string into rows (handles multi-line quoted fields).
 */
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // end of logical row
      if (ch === '\r' && i + 1 < raw.length && raw[i + 1] === '\n') {
        i++; // skip \r\n
      }
      if (current.trim().length > 0) {
        rows.push(parseCsvLine(current));
      }
      current = '';
    } else {
      current += ch;
    }
  }
  // last row (no trailing newline)
  if (current.trim().length > 0) {
    rows.push(parseCsvLine(current));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Word count helper – strips HTML tags, counts characters
// ---------------------------------------------------------------------------
function countWords(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '');
  return text.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const csvPath = resolve(__dirname, '..', 'ameblo_articles.csv');
  console.log(`Reading CSV: ${csvPath}`);

  let raw = readFileSync(csvPath, 'utf-8');

  // Strip BOM if present
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  const rows = parseCsv(raw);

  // First row is header
  const header = rows[0];
  console.log(`Header: ${header.join(' | ')}`);

  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;
  console.log(`Total data rows: ${totalRows}`);

  // Map header names to indices
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    colIndex[h.trim().toLowerCase()] = i;
  });

  // ------- Fetch existing titles for duplicate check -------
  console.log('Fetching existing titles for duplicate check...');
  const { data: existingArticles, error: fetchErr } = await supabase
    .from('source_articles')
    .select('title');

  if (fetchErr) {
    console.error('Failed to fetch existing articles:', fetchErr.message);
    process.exit(1);
  }

  const existingTitles = new Set(
    (existingArticles ?? []).map((a: { title: string }) => a.title),
  );
  console.log(`Existing articles in DB: ${existingTitles.size}`);

  // ------- Build insert payload -------
  type InsertRow = {
    title: string;
    content: string;
    original_url: string;
    published_at: string | null;
    word_count: number;
  };

  const toInsert: InsertRow[] = [];
  let skippedEmpty = 0;
  let skippedDuplicate = 0;

  for (const row of dataRows) {
    const date = row[colIndex['date']]?.trim() ?? '';
    const title = row[colIndex['title']]?.trim() ?? '';
    const content = row[colIndex['content']] ?? '';
    const url = row[colIndex['url']]?.trim() ?? '';

    if (!title) {
      skippedEmpty++;
      continue;
    }

    if (existingTitles.has(title)) {
      skippedDuplicate++;
      continue;
    }

    // Mark as seen to avoid inserting duplicates within the CSV itself
    existingTitles.add(title);

    toInsert.push({
      title,
      content,
      original_url: url,
      published_at: date || null,
      word_count: countWords(content),
    });
  }

  console.log(`Skipped (empty title): ${skippedEmpty}`);
  console.log(`Skipped (duplicate):   ${skippedDuplicate}`);
  console.log(`Rows to insert:        ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('Nothing to insert. Done.');
    return;
  }

  // ------- Batch insert (500 rows at a time) -------
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('source_articles').insert(batch);

    if (error) {
      console.error(
        `Error inserting batch starting at index ${i}:`,
        error.message,
      );
      process.exit(1);
    }

    inserted += batch.length;
    console.log(`${inserted}/${toInsert.length} 件処理済み`);
  }

  console.log(`\nImport complete! ${inserted} articles inserted.`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
