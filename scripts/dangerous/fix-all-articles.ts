/**
 * 全公開記事のHTML品質問題を一括修復するスクリプト
 * - 壊れCTA除去（AI直接生成のもの）
 * - \&quot; エスケープ修復
 * - <br>構造修復
 * - 重複テキスト修復
 * - alt="" 修復（out/ファイルのみ）
 *
 * Usage: npx tsx scripts/fix-all-articles.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** AI生成HTMLの修復処理 */
function sanitizeBodyHtml(html: string): string {
  if (!html) return html;

  // 1. \&quot; / \" エスケープ修復
  html = html.replace(/="\\&quot;/g, '="').replace(/\\&quot;"/g, '"');
  html = html.replace(/="\\"/g, '="').replace(/\\""/g, '"');

  // 2. TOC/CTA内の不要<br>除去
  html = html.replace(/<br\s*\/?>\s*(<\/?(?:nav|details|summary|ol|li|div|a|p)\b)/gi, '$1');
  html = html.replace(/(<\/?(?:nav|details|summary|ol|li|div|a|p)[^>]*>)\s*<br\s*\/?>/gi, '$1');

  // 3. AI直接生成の壊れCTA除去（複数パターン対応）
  // Pattern A: class="harmony-cta"> <p class="harmony-cta-catch">...<a>...</a> </div>
  html = html.replace(/<div class="harmony-cta">\s*<p class="harmony-cta-catch">[\s\S]*?<\/a>\s*<\/div>/gi, '');
  // Pattern B: class="harmony-cta"> <h3>...</h3> <p>...</p> <a class="cta-button">...</a> </div>
  html = html.replace(/<div class="harmony-cta">\s*<h[34][^>]*>[\s\S]*?<\/a>\s*<\/div>/gi, '');
  // Pattern C: class="harmony-cta"> <h4>...</h4> <p>...</p> <a href=...class="cta-button">...</a> </div>
  html = html.replace(/<div class="harmony-cta">\s*<h4>[\s\S]*?<\/div>/gi, '');
  // Pattern D: <div class="cta-box">...<a class="cta-button">...</a></div>
  html = html.replace(/<div class="cta-box">[\s\S]*?<\/div>/gi, '');

  // 4. <p>内ブロック要素修復
  html = html.replace(/<p>\s*(<div\s)/gi, '$1');
  html = html.replace(/(<\/div>)\s*<\/p>/gi, '$1');

  // 5. 重複テキスト修復: "あなたのあなたの" → "あなたの"
  html = html.replace(/あなたのあなたの/g, 'あなたの');

  return html;
}

/** out/ファイルのalt=""修復 */
function fixAltInOutHtml(html: string): string {
  // Related article images: alt="" → alt="記事タイトル"
  // Pattern: <img src="..." alt="" ... > inside <a> that contains <span>title</span>
  html = html.replace(
    /(<a[^>]*>)\s*<img([^>]*)\balt=""\s*([^>]*)>\s*([\s\S]*?<span[^>]*>)([\s\S]*?)(<\/span>)/gi,
    (match, aTag, imgBefore, imgAfter, midContent, title, spanClose) => {
      const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
      return `${aTag}<img${imgBefore} alt="${cleanTitle}" ${imgAfter}>${midContent}${title}${spanClose}`;
    }
  );
  return html;
}

async function main() {
  console.log('=== 全公開記事HTML一括修復 ===\n');

  // 1. DB内の全published記事を取得
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, slug, title, status, stage2_body_html, stage3_final_html')
    .eq('status', 'published');

  if (error || !articles) {
    console.error('DB取得エラー:', error?.message);
    process.exit(1);
  }

  console.log(`${articles.length} 件の公開記事を処理\n`);

  let dbFixed = 0;
  let outFixed = 0;
  const truncated: string[] = [];

  for (const article of articles) {
    const slug = article.slug || article.id;
    const bodyField = article.stage3_final_html ? 'stage3_final_html' : 'stage2_body_html';
    const originalHtml = (article as Record<string, string>)[bodyField] || '';

    if (!originalHtml.trim()) {
      console.log(`⏭️  ${slug}: 本文なし`);
      continue;
    }

    // Check for truncation (content < 500 chars after stripping HTML)
    const plainText = originalHtml.replace(/<[^>]+>/g, '').trim();
    if (plainText.length < 500) {
      truncated.push(slug);
    }

    // Fix DB HTML
    const fixedHtml = sanitizeBodyHtml(originalHtml);
    if (fixedHtml !== originalHtml) {
      const { error: updateError } = await supabase
        .from('articles')
        .update({ [bodyField]: fixedHtml })
        .eq('id', article.id);

      if (updateError) {
        console.log(`❌ ${slug}: DB更新失敗 - ${updateError.message}`);
      } else {
        console.log(`✅ ${slug}: DB修復完了`);
        dbFixed++;
      }
    }

    // Fix out/ file
    const outFile = path.join('out/column', slug, 'index.html');
    if (fs.existsSync(outFile)) {
      let outHtml = fs.readFileSync(outFile, 'utf-8');
      const original = outHtml;
      outHtml = sanitizeBodyHtml(outHtml);
      outHtml = fixAltInOutHtml(outHtml);
      // Fix old color
      outHtml = outHtml.replace(/#b39578/g, '#8b6f5e');
      if (outHtml !== original) {
        fs.writeFileSync(outFile, outHtml);
        console.log(`  📄 ${slug}: out/修復完了`);
        outFixed++;
      }
    }
  }

  // Fix hub page
  const hubFile = 'out/column/index.html';
  if (fs.existsSync(hubFile)) {
    let hubHtml = fs.readFileSync(hubFile, 'utf-8');
    const original = hubHtml;
    hubHtml = hubHtml.replace(/#b39578/g, '#8b6f5e');
    if (hubHtml !== original) {
      fs.writeFileSync(hubFile, hubHtml);
      console.log(`\n📄 ハブページ: カラー修復完了`);
    }
  }

  console.log(`\n=== 結果 ===`);
  console.log(`DB修復: ${dbFixed} 件`);
  console.log(`out/修復: ${outFixed} 件`);
  if (truncated.length > 0) {
    console.log(`\n⚠️  コンテンツ不足（再生成推奨）: ${truncated.length} 件`);
    truncated.forEach(s => console.log(`  - ${s}`));
  }
}

main().catch(console.error);
