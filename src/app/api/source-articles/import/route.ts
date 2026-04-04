// ============================================================================
// src/app/api/source-articles/import/route.ts
// CSVインポート API（元記事のバッチインポート）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { importSourceArticles } from '@/lib/db/source-articles';
import type { ImportSourceArticleInput } from '@/lib/db/source-articles';
import { logger } from '@/lib/logger';

// ─── CSV パーサー ───────────────────────────────────────────────────────────

/**
 * CSV 文字列をパースする。BOM 付き UTF-8 に対応。
 * 期待カラム: date, title, content, url
 */
function parseCsv(raw: string): ImportSourceArticleInput[] {
  // BOM 除去
  const text = raw.replace(/^\uFEFF/, '');

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error('CSVにデータ行がありません');
  }

  // ヘッダー解析
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());

  const dateIdx = headers.indexOf('date');
  const titleIdx = headers.indexOf('title');
  const contentIdx = headers.indexOf('content');
  const urlIdx = headers.indexOf('url');

  if (titleIdx === -1 || contentIdx === -1) {
    throw new Error(
      'CSVに必須カラム (title, content) が見つかりません。ヘッダー: ' +
        headers.join(', '),
    );
  }

  // データ行パース
  const articles: ImportSourceArticleInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);

    const title = cols[titleIdx]?.trim();
    const content = cols[contentIdx]?.trim();

    if (!title || !content) {
      continue; // title / content が空の行はスキップ
    }

    const article: ImportSourceArticleInput = {
      title,
      content,
    };

    if (urlIdx !== -1 && cols[urlIdx]?.trim()) {
      article.original_url = cols[urlIdx].trim();
    }

    if (dateIdx !== -1 && cols[dateIdx]?.trim()) {
      article.published_at = cols[dateIdx].trim();
    }

    articles.push(article);
  }

  return articles;
}

/**
 * RFC 4180 準拠の CSV 行パーサー。
 * ダブルクォートで囲まれたフィールド（改行・カンマ含む）に対応。
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // エスケープされた " かどうか
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next "
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}

// ─── POST /api/source-articles/import ───────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // multipart/form-data からファイルを取得
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'CSVファイルが指定されていません' },
        { status: 400 },
      );
    }

    // ファイル形式チェック
    if (
      !file.name.endsWith('.csv') &&
      file.type !== 'text/csv' &&
      file.type !== 'application/vnd.ms-excel'
    ) {
      return NextResponse.json(
        { error: 'CSVファイルのみアップロード可能です' },
        { status: 400 },
      );
    }

    // ファイルサイズ制限（10MB）
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'ファイルサイズが上限（10MB）を超えています' },
        { status: 400 },
      );
    }

    // CSV パース
    const rawText = await file.text();
    let articles: ImportSourceArticleInput[];

    try {
      articles = parseCsv(rawText);
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : 'CSVのパースに失敗しました';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (articles.length === 0) {
      return NextResponse.json(
        { error: 'インポート可能なデータが見つかりません' },
        { status: 400 },
      );
    }

    // Supabase にバッチ insert
    const result = await importSourceArticles(articles);

    logger.info('api', 'importSourceArticles', {
      fileName: file.name,
      fileSize: file.size,
      parsed: articles.length,
      inserted: result.inserted,
    });

    return NextResponse.json(
      {
        data: {
          imported: result.inserted,
          total: result.total,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('api', 'importSourceArticles', undefined, error);
    return NextResponse.json(
      { error: 'CSVインポートに失敗しました' },
      { status: 500 },
    );
  }
}
