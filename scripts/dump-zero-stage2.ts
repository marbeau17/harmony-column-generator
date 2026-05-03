import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const e = fs.readFileSync("/Users/yasudaosamu/Desktop/codes/blogauto/.env.local","utf-8");
const v: Record<string,string> = {};
for (const l of e.split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  v[t.slice(0,i)] = t.slice(i+1);
}
const sb = createClient(v["NEXT_PUBLIC_SUPABASE_URL"], v["SUPABASE_SERVICE_ROLE_KEY"]);

const TMP = "/Users/yasudaosamu/Desktop/codes/blogauto/tmp";

(async () => {
  // 1) get latest 5 zero-mode articles
  const { data: arts, error } = await sb
    .from("articles")
    .select("id, article_number, slug, title, status, generation_mode, stage2_body_html, stage3_final_html, published_html, image_files, image_prompts, created_at, updated_at")
    .eq("generation_mode", "zero")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("ERR articles:", error);
    process.exit(1);
  }

  if (!arts || arts.length === 0) {
    console.log("No zero-mode articles found");
    process.exit(0);
  }

  console.log(`Found ${arts.length} zero-mode articles\n`);

  const results: Array<{
    slug: string;
    article_number: number | null;
    image_files: number;
    image_placeholder_count: number;
    img_tag_count: number;
    placeholder_examples: string[];
    stage2_len: number;
    status: string;
    has_stage3: boolean;
  }> = [];

  for (const a of arts) {
    const slug = a.slug || `id-${a.id.slice(0, 8)}`;
    const stage2 = a.stage2_body_html || "";

    // 2) write stage2 html
    const outPath = path.join(TMP, `article-${slug}-stage2.html`);
    fs.writeFileSync(outPath, stage2, "utf-8");

    // 3) image_files is a JSON column on articles
    let imageFilesCount = 0;
    let imageFilesPreview: string[] = [];
    try {
      const raw = (a as { image_files?: unknown }).image_files;
      const parsed = Array.isArray(raw)
        ? raw
        : (typeof raw === "string" ? JSON.parse(raw) : raw);
      if (Array.isArray(parsed)) {
        imageFilesCount = parsed.length;
        imageFilesPreview = parsed.slice(0, 3).map((x: unknown) => {
          if (typeof x === "object" && x && "url" in (x as Record<string, unknown>)) {
            return String((x as Record<string, unknown>).url).slice(0, 60);
          }
          return JSON.stringify(x).slice(0, 60);
        });
      }
    } catch (e) {
      // ignore
    }

    // 4) grep IMAGE placeholder patterns
    const patterns: RegExp[] = [
      /<!--\s*IMAGE\s*:[^>]*-->/gi,
      /<p>\s*IMAGE\s*:[^<]*<\/p>/gi,
      /\bIMAGE\s*:\s*\w+/gi,
      /IMAGEプレースホルダ/g,
    ];

    const placeholderMatches: string[] = [];
    for (const p of patterns) {
      const m = stage2.match(p);
      if (m) placeholderMatches.push(...m);
    }

    // dedupe and count
    const placeholderSet = new Set(placeholderMatches);
    const placeholderCount = placeholderMatches.length;

    // count <img>
    const imgMatches = stage2.match(/<img\b[^>]*>/gi) || [];
    const imgCount = imgMatches.length;

    results.push({
      slug,
      article_number: a.article_number,
      image_files: imageFilesCount,
      image_placeholder_count: placeholderCount,
      img_tag_count: imgCount,
      placeholder_examples: Array.from(placeholderSet).slice(0, 3),
      stage2_len: stage2.length,
      status: a.status,
      has_stage3: !!a.stage3_final_html,
    });
  }

  // 5) report table
  console.log("\n=== REPORT ===\n");
  console.log("| slug | image_files | IMAGE残存 | <img> | stage2_len | status | stage3? | placeholder形式 |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const ex = r.placeholder_examples.map(s => s.slice(0, 50).replace(/\n/g, " ")).join(" / ") || "-";
    console.log(`| ${r.slug} | ${r.image_files} | ${r.image_placeholder_count} | ${r.img_tag_count} | ${r.stage2_len} | ${r.status} | ${r.has_stage3 ? "Y" : "N"} | ${ex} |`);
  }

  // 6) flag suspicious cases
  console.log("\n=== SUSPICIOUS (placeholder残存 AND <img>=0) ===");
  for (const r of results) {
    if (r.image_placeholder_count > 0 && r.img_tag_count === 0) {
      console.log(` -> ${r.slug} : placeholders=${r.image_placeholder_count}, image_files=${r.image_files}`);
    }
  }

  console.log("\n=== ALL CASES summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: image_files=${r.image_files}, placeholders=${r.image_placeholder_count}, <img>=${r.img_tag_count}`);
  }
})();
