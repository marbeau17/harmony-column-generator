// ============================================================================
// src/lib/validators/article-content.ts
// P5-32: stage2_body_html / stage3_final_html の契約検証 (Layer 4)
//
// 目的: 「whack-a-mole」防止のため、フィールド間の役割を契約として定義し、
//      save 時に違反を検出して 400 で reject。
//
// stage2_body_html: 記事本文のみ。<header>/<nav>/<footer>/<aside>/DOCTYPE 等の
//                   テンプレート要素が含まれてはならない。
// stage3_final_html: FTP エクスポート用完全 HTML。DOCTYPE と <html> を必須。
//
// 違反例 (今までに発生したもの):
//   - P5-30: edit autoSave が stage3 を body のみで上書き
//   - 編集中 TipTap が stage3 のテンプレートを部分的にリスト化、stage2 へ保存
//   - run-completion が stage2 にも template marker を埋め込む可能性
// ============================================================================

const STAGE2_BANNED_MARKERS = [
  '<!DOCTYPE',
  '<!doctype',
  '<html',
  '<head>',
  '<header',
  '<footer',
  // <nav> は記事本文にも稀にあり得る (false positive 回避のため除外しない)
  // ただし「サイドバー的な複数 nav」を検出
] as const;

/** 明らかに本ブログのサイドバー/ヘッダーから漏れた文字列パターン */
const STAGE2_TEMPLATE_TEXT_MARKERS = [
  'スピリチュアルカウンセラー 小林由起子\nトップ\n',  // ヘッダ部
  'Copyright © スピリチュアルハーモニー',              // フッタ
  '※ 本コラムの内容はスピリチュアルカウンセラー',      // 免責事項
] as const;

const STAGE2_MAX_CHARS = 50_000;

const STAGE3_REQUIRED_MARKERS = [
  '<!DOCTYPE',
  '<html',
] as const;

const STAGE3_MIN_CHARS = 1_000;

export interface ContentValidation {
  ok: boolean;
  issues: string[];
}

/**
 * stage2_body_html (本文のみ) の検証。
 * テンプレート markers が混入していたら reject。
 */
export function validateStage2Body(html: string): ContentValidation {
  if (!html) return { ok: true, issues: [] };
  const issues: string[] = [];

  for (const marker of STAGE2_BANNED_MARKERS) {
    if (html.includes(marker)) {
      issues.push(
        `stage2_body_html に template marker "${marker}" が含まれています ` +
          `(FTP 用 stage3 を上書きする恐れ)`,
      );
    }
  }

  for (const text of STAGE2_TEMPLATE_TEXT_MARKERS) {
    if (html.includes(text)) {
      issues.push(
        `stage2_body_html に template テキスト "${text.slice(0, 30)}..." が混入`,
      );
    }
  }

  if (html.length > STAGE2_MAX_CHARS) {
    issues.push(
      `stage2_body_html が ${html.length} 字と異常に長い (期待 < ${STAGE2_MAX_CHARS})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * stage3_final_html (FTP 用完全 HTML) の検証。
 * テンプレート markers が必須。
 */
export function validateStage3Final(html: string): ContentValidation {
  if (!html) return { ok: true, issues: [] }; // 空は許容 (未生成)
  const issues: string[] = [];

  for (const marker of STAGE3_REQUIRED_MARKERS) {
    if (!html.includes(marker)) {
      issues.push(
        `stage3_final_html に必須 marker "${marker}" が含まれていない (body のみ?)`,
      );
    }
  }

  if (html.length < STAGE3_MIN_CHARS) {
    issues.push(
      `stage3_final_html が ${html.length} 字と短すぎる (期待 >= ${STAGE3_MIN_CHARS})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * 任意の article 更新 payload に対し、関連フィールドを一括検証。
 */
export function validateArticleContentPayload(
  payload: Record<string, unknown>,
): ContentValidation {
  const allIssues: string[] = [];

  if (typeof payload.stage2_body_html === 'string') {
    const r = validateStage2Body(payload.stage2_body_html);
    allIssues.push(...r.issues);
  }
  if (typeof payload.stage3_final_html === 'string') {
    const r = validateStage3Final(payload.stage3_final_html);
    allIssues.push(...r.issues);
  }
  // published_html は stage2 と同じ契約 (本文のみ)
  if (typeof payload.published_html === 'string') {
    const r = validateStage2Body(payload.published_html);
    allIssues.push(
      ...r.issues.map((i) => i.replace('stage2_body_html', 'published_html')),
    );
  }

  return { ok: allIssues.length === 0, issues: allIssues };
}
