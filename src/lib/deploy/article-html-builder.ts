// ============================================================================
// src/lib/deploy/article-html-builder.ts
// 記事 1 本分の最終 HTML を組み立てる共有ヘルパー。
//
// 既存の `src/app/api/articles/[id]/deploy/route.ts` (lines 79-93) と
// `scripts/redeploy-all-articles.ts` (lines 80-100) で同一の post-process が
// 重複して書かれていたため、bulk-deploy 実装にあたり唯一のソースに集約する。
//
// 注意 (CLAUDE.md アンチパターン §):
//  - HTML を string.replace(regex) で操作するのは記事レイヤでは禁止だが、
//    本ヘルパーが扱うのは "Storage URL → 相対パス" 等の構造変換のみ。
//    将来 cheerio に置き換える場合も、この 1 箇所を直せば全経路に伝搬する。
// ============================================================================
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import { getOgImageUrl, getHubPath } from '@/lib/config/public-urls';
import type { Article } from '@/types/article';

/** 正規表現メタ文字をエスケープ (hubPath を regex に埋め込む用) */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 記事レコードから FTP デプロイ用の最終 HTML を生成する。
 * - generateArticleHtml で素の HTML を作る
 * - Supabase Storage URL を相対 ./images/*.jpg に書換
 * - hub.css / hub.js のパスを ../../ に書換
 * - 関連記事リンクのパスを env 駆動 hubPath ベースで書換
 * - 不正な hero <img> / <!--IMAGE:hero:--> placeholder を除去
 */
export function buildDeployHtml(article: Article): { html: string; slug: string; charsBeforeReplace: number } {
  const slug = article.slug ?? article.id;

  let html = generateArticleHtml(article, {
    heroImage: 'images/hero.jpg',
    heroImageAlt: article.title ?? slug,
    ogImage: getOgImageUrl(slug, 'hero'),
    hubUrl: '../index.html',
  });
  const charsBeforeReplace = html.length;

  // post-process (deploy/route.ts と完全同一)
  html = html.replace(
    /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
    './images/$1.jpg',
  );
  html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
  html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');

  const hubPathPattern = escapeRegex(getHubPath());
  html = html.replace(
    new RegExp(`href="${hubPathPattern}/([^"]+)/"`, 'g'),
    'href="../$1/index.html"',
  );
  html = html.replace(
    new RegExp(`src="${hubPathPattern}/([^"]+)/images/`, 'g'),
    'src="../$1/images/',
  );
  html = html.replace(
    /<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g,
    '',
  );
  html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

  return { html, slug, charsBeforeReplace };
}
