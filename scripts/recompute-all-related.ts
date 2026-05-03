/**
 * P5-54: 全公開済み記事の related_articles を再計算 + DB 保存。
 *
 * 必要性:
 *   - law-of-attraction が related_articles=[] (空) で関連記事が表示されない
 *   - 他 31 件も related_articles の href が旧 /column/{slug}/ 形式で 404 になる
 *   → updateAllRelatedArticles() で全件再計算 (P5-44/46 で URL 形式が正しい
 *     /spiritual/column/{slug}/index.html に統一済)
 */
import * as fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

(async () => {
  const { updateAllRelatedArticles } = await import(
    '../src/lib/publish/auto-related'
  );
  console.log('=== 全記事 related_articles 一括再計算 ===\n');
  const result = await updateAllRelatedArticles();
  console.log('updated:', result.updated);
  if (result.errors.length > 0) {
    console.log('errors:', result.errors.length);
    for (const e of result.errors.slice(0, 5)) console.log('  -', e);
  }
})();
