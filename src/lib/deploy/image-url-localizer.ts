// ============================================================================
// src/lib/deploy/image-url-localizer.ts
// 記事本文中の Supabase Storage 画像 URL を、FTP 配置に合わせた相対パスへ統一する。
//
// 背景 (#4): 以前は deploy / export / static-exporter / article-html-builder の
// 4〜5 箇所に「`.jpg` 固定 + Supabase project ref ハードコード」の同一 regex が
// コピーされており (CLAUDE.md アンチパターン「同一ロジックを複数ファイルに書くな」
// 違反)、かつ Gemini が `image/png` を返す現行モデルでは Storage URL が `.png` に
// なるため rewrite が漏れ、body/summary 画像が Supabase 直リンクのまま残っていた。
//
// 本ヘルパーは:
//   - ホスト非依存 (project ref をハードコードしない)
//   - 拡張子非依存 (jpg/jpeg/png/webp/gif すべて吸収)
//   - 出力は常に `./images/{position}.jpg` に正規化 (FTP 側は position.jpg で
//     binary 配置されるため、拡張子を .jpg に揃える)
// ============================================================================

/**
 * 記事本文 HTML 内の Supabase Storage 記事画像 URL を相対パス
 * `./images/{hero|body|summary}.jpg` に統一する。
 *
 * 任意のホスト・任意の拡張子 (jpg/jpeg/png/webp/gif) にマッチする。
 * プロフィール画像 (article-images/profile/...) は position が hero/body/summary
 * ではないためマッチせず、Supabase 直リンクのまま保持される (意図通り)。
 */
export function localizeArticleImageUrls(html: string): string {
  return html.replace(
    /https?:\/\/[^"']*?\/storage\/v1\/object\/public\/article-images\/articles\/[^"']+?\/(hero|body|summary)\.(?:jpe?g|png|webp|gif)/gi,
    './images/$1.jpg',
  );
}

// ─── 画像実在ゲート (#5) ─────────────────────────────────────────────────────
// 背景: generateArticleHtml は heroImage='images/hero.jpg' を無条件で焼き込むため、
// 画像が 1 枚も生成されていない記事でも HTML には <img src="./images/hero.jpg"> が
// 入り、quality-checklist は「未置換 placeholder の残留」しか見ないため画像ゼロ枚の
// 記事がそのまま live に到達し、公開サイトで hero.jpg が 404 になっていた。
// deploy 前に hero 画像の実在を必須化する。

interface ArticleImageEntry {
  position?: string;
  url?: string;
}

export interface DeployableImageCheck {
  ok: boolean;
  /** url を持つ position の一覧 (例: ['hero','body','summary']) */
  present: string[];
  /** 必須なのに欠けている position (現状 hero のみ必須) */
  missing: string[];
}

/**
 * deploy 可能な画像が揃っているかを検証する。
 * hero は HTML に無条件で焼き込まれるため必須 (欠けると公開サイトで 404)。
 * body / summary は欠けても block しない (本文に img が無いだけで 404 は出ない)。
 */
export function checkDeployableImages(imageFiles: unknown): DeployableImageCheck {
  const REQUIRED_POSITIONS = ['hero'];
  const arr = Array.isArray(imageFiles) ? (imageFiles as ArticleImageEntry[]) : [];
  const present = arr
    .filter((e) => e && typeof e.position === 'string' && typeof e.url === 'string' && e.url.length > 0)
    .map((e) => e.position as string);
  const missing = REQUIRED_POSITIONS.filter((p) => !present.includes(p));
  return { ok: missing.length === 0, present, missing };
}
