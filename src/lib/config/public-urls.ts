/**
 * P5-44: 公開サイトの URL 生成を env 駆動に統一する単一ソース。
 *
 * 環境変数:
 *   NEXT_PUBLIC_SITE_URL  : サイトホスト (default: https://harmony-mc.com)
 *   NEXT_PUBLIC_HUB_PATH  : ハブベースパス (default: /spiritual/column)
 *                           実 FTP 配置と一致させる必要あり (FTP_REMOTE_PATH と同期)
 *
 * URL pattern (P5-46: index.html 明示形式に統一):
 *   ハブ page 1     : {SITE_URL}{HUB_PATH}/index.html
 *   ハブ page 2+    : {SITE_URL}{HUB_PATH}/page/{N}/index.html
 *   記事 canonical : {SITE_URL}{HUB_PATH}/{slug}/index.html
 *   og:image       : {SITE_URL}{HUB_PATH}/{slug}/images/{position}.jpg
 *   sitemap        : 同上 (記事は canonical と同じ)
 *
 * P5-46 (2026-05-03): 直リンクに `/index.html` を明示する形式に変更。
 *   harmony-mc.com (lolipop + WordPress root) では `/spiritual/column/{slug}/`
 *   形式のディレクトリリクエストが WordPress catch-all で 301 されてしまう。
 *   `/spiritual/column/{slug}/index.html` のように index.html を明示した
 *   ファイルリクエストは 200 で配信される (実証済み)。
 *
 * 公開先: /spiritual/column (FTP root の既存配置、58 記事が稼働済)
 */

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://harmony-mc.com').replace(/\/+$/, '');
}

export function getHubPath(): string {
  const raw = process.env.NEXT_PUBLIC_HUB_PATH || '/spiritual/column';
  // 先頭 / 必須、末尾 / 不要 にノーマライズ
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, '');
}

/**
 * ハブページの公開 URL。P5-46: WordPress catch-all 回避のため index.html 明示。
 *   page=1 : {SITE_URL}{HUB_PATH}/index.html
 *   page>=2: {SITE_URL}{HUB_PATH}/page/{N}/index.html
 */
export function getHubUrl(page = 1): string {
  const base = `${getSiteUrl()}${getHubPath()}`;
  return page === 1 ? `${base}/index.html` : `${base}/page/${page}/index.html`;
}

/**
 * 記事の公開 URL。P5-46: index.html 明示。
 *   {SITE_URL}{HUB_PATH}/{slug}/index.html
 */
export function getArticleUrl(slug: string): string {
  return `${getSiteUrl()}${getHubPath()}/${slug}/index.html`;
}

/**
 * og:image / 画像 URL は index.html 不要 (実ファイル名で配信)。
 *   {SITE_URL}{HUB_PATH}/{slug}/images/{position}.jpg
 */
export function getOgImageUrl(slug: string, position: 'hero' | 'body' | 'summary' = 'hero'): string {
  return `${getSiteUrl()}${getHubPath()}/${slug}/images/${position}.jpg`;
}

/**
 * ハブ内記事リンク (相対パス、deploy 後の HTML に埋め込む用)。
 * P5-46: index.html 明示でリンク作成。
 *   {HUB_PATH}/{slug}/index.html
 */
export function getArticleRelativePath(slug: string): string {
  return `${getHubPath()}/${slug}/index.html`;
}
