// =============================================================================
// scripts/classify-source-articles.ts
// source_articles の全レコードに theme_category を一括分類するスクリプト
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { classifyTheme } from '../src/lib/content/source-analyzer';

const BATCH_SIZE = 500;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を環境変数に設定してください。',
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 総件数を取得
  const { count, error: countError } = await supabase
    .from('source_articles')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    console.error('件数取得に失敗:', countError.message);
    process.exit(1);
  }

  const total = count ?? 0;
  console.log(`対象レコード数: ${total}`);

  if (total === 0) {
    console.log('処理対象がありません。');
    return;
  }

  let processed = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const { data: rows, error: fetchError } = await supabase
      .from('source_articles')
      .select('id, title, content')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) {
      console.error(`バッチ取得エラー (offset=${offset}):`, fetchError.message);
      process.exit(1);
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const theme = classifyTheme(row.title ?? '', row.content ?? '');

      const { error: updateError } = await supabase
        .from('source_articles')
        .update({ theme_category: theme })
        .eq('id', row.id);

      if (updateError) {
        console.error(`更新エラー (id=${row.id}):`, updateError.message);
      }

      processed++;
    }

    console.log(`進捗: ${processed} / ${total} (${((processed / total) * 100).toFixed(1)}%)`);
  }

  console.log(`完了: ${processed} 件を分類しました。`);
}

main().catch((err) => {
  console.error('予期しないエラー:', err);
  process.exit(1);
});
