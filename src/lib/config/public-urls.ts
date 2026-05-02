/**
 * P5-44: 公開サイトの URL 生成を env 駆動に統一する単一ソース。
 *
 * 環境変数:
 *   NEXT_PUBLIC_SITE_URL  : サイトホスト (default: https://harmony-mc.com)
 *   NEXT_PUBLIC_HUB_PATH  : ハブベースパス (default: /column)
 *                           実 FTP 配置と一致させる必要あり (FTP_REMOTE_PATH と同期)
 *
 * URL pattern:
 *   ハブ page 1     : {SITE_URL}{HUB_PATH}/
 *   ハブ page 2+    : {SITE_URL}{HUB_PATH}/page/{N}/
 *   記事 canonical : {SITE_URL}{HUB_PATH}/{slug}/
 *   og:image       : {SITE_URL}{HUB_PATH}/{slug}/images/{position}.jpg
 *   sitemap        : 同上 (記事は canonical と同じ)
 *
 * P5-45 (2026-05-03): default を /spiritual/column → /column に変更。
 *   FTP root の /column/ ディレクトリを公開先として採用。WordPress (root) の
 *   .htaccess catch-all は実ファイル/ディレクトリ存在時はバイパスされるので、
 *   /column/{slug}/index.html を物理配置すれば直接 200 で配信される。
 */

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://harmony-mc.com').replace(/\/+$/, '');
}

export function getHubPath(): string {
  const raw = process.env.NEXT_PUBLIC_HUB_PATH || '/column';
  // 先頭 / 必須、末尾 / 不要 にノーマライズ
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, '');
}

export function getHubUrl(page = 1): string {
  const base = `${getSiteUrl()}${getHubPath()}/`;
  return page === 1 ? base : `${base}page/${page}/`;
}

export function getArticleUrl(slug: string): string {
  return `${getSiteUrl()}${getHubPath()}/${slug}/`;
}

export function getOgImageUrl(slug: string, position: 'hero' | 'body' | 'summary' = 'hero'): string {
  return `${getSiteUrl()}${getHubPath()}/${slug}/images/${position}.jpg`;
}

/** ハブ内記事リンク (相対パス、deploy 後の HTML に埋め込む用) */
export function getArticleRelativePath(slug: string): string {
  return `${getHubPath()}/${slug}/`;
}
