// ============================================================================
// src/lib/content/quality-checklist.ts
// 品質チェックリストエンジン
//
// 記事公開前に全項目をパスする必要がある包括的な品質ゲート。
// これまでの運用で発生した全ての問題を反映。
// ============================================================================

// ─── チェック結果の型定義 ────────────────────────────────────────────────────

export type CheckSeverity = 'error' | 'warning';
export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckItem {
  id: string;
  category: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  detail?: string;  // 不合格時の詳細メッセージ
  value?: string | number; // 検出値（回数など）
}

export interface ChecklistResult {
  passed: boolean;           // 全errorレベルがpassならtrue
  score: number;             // 0-100 スコア
  items: CheckItem[];
  summary: string;           // 日本語サマリ
  checkedAt: string;         // ISO datetime
  errorCount: number;
  warningCount: number;
}

// ─── 禁止表現リスト ─────────────────────────────────────────────────────────

/** 書籍「愛の涙」由来の表現 — 1つでも含まれていたら即不合格 */
const BANNED_BOOK_EXPRESSIONS = [
  '愛の涙', '走馬灯', '光の使者', '愛の記憶', '命の境界線',
  '愛のエネルギー', '波紋のように', '生死の境', '臨死',
  '人生の最後に', '最期の瞬間', '命の淵', '死後の世界',
  '死者との', '死を超えた', '木漏れ日',
];

/** AI生成の残骸パターン — プロンプト漏れ等 */
const ERROR_PATTERNS = [
  'CORRECTIONS_START', 'エラー：', '品質チェック対象',
  'お手数ですが', '再度送信してください', 'プロンプトの途中で',
  'IMAGE:hero', 'IMAGE:body', 'IMAGE:summary',
];

/** 医療関連の禁止表現 */
const BANNED_MEDICAL = [
  '医療機関にご相談', '医師にご相談', '医療行為ではありません',
  '医療的なアドバイスではありません', '専門家にご相談',
  '治療効果', 'が治る', 'に効果がある',
];

/** AI臭い定型表現 */
const BANNED_AI_PATTERNS = [
  'いかがでしたでしょうか', '参考になれば幸いです',
  'この記事では〜を紹介しました', 'まとめると',
];

/** 小説的・文学的すぎる表現 */
const BANNED_LITERARY = [
  '夜風にふわりと', '星が瞬く夜', '静寂に包まれた',
  '天国からの', '天使の', '霊界から',
];

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(pattern, pos)) !== -1) {
    count++;
    pos += pattern.length;
  }
  return count;
}

function countRegex(text: string, regex: RegExp): number {
  return (text.match(regex) || []).length;
}

// ─── 個別チェック関数 ────────────────────────────────────────────────────────

function checkBannedBookExpressions(text: string, html: string): CheckItem[] {
  const found: string[] = [];
  for (const expr of BANNED_BOOK_EXPRESSIONS) {
    const count = countOccurrences(text, expr);
    if (count > 0) found.push(`${expr}(${count}回)`);
  }
  return [{
    id: 'banned_book',
    category: '禁止表現',
    label: '書籍固有の表現が含まれていないか',
    status: found.length === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
    value: found.length,
  }];
}

function checkErrorPatterns(text: string, html: string): CheckItem[] {
  const found: string[] = [];
  for (const pat of ERROR_PATTERNS) {
    if (text.includes(pat) || html.includes(pat)) found.push(pat);
  }
  return [{
    id: 'error_patterns',
    category: '生成品質',
    label: 'AI生成の残骸・エラーパターンがないか',
    status: found.length === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
  }];
}

function checkMedicalExpressions(text: string): CheckItem[] {
  const found: string[] = [];
  for (const expr of BANNED_MEDICAL) {
    if (text.includes(expr)) found.push(expr);
  }
  return [{
    id: 'medical',
    category: '禁止表現',
    label: '医療関連の禁止表現がないか',
    status: found.length === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
  }];
}

function checkAIPatterns(text: string): CheckItem[] {
  const found: string[] = [];
  for (const expr of BANNED_AI_PATTERNS) {
    if (text.includes(expr)) found.push(expr);
  }
  return [{
    id: 'ai_patterns',
    category: '文体',
    label: 'AI臭い定型表現がないか',
    status: found.length === 0 ? 'pass' : 'warn',
    severity: 'warning',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
  }];
}

function checkLiteraryExpressions(text: string): CheckItem[] {
  const found: string[] = [];
  for (const expr of BANNED_LITERARY) {
    if (text.includes(expr)) found.push(expr);
  }
  return [{
    id: 'literary',
    category: '文体',
    label: '小説的・文学的すぎる表現がないか',
    status: found.length === 0 ? 'pass' : 'warn',
    severity: 'warning',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
  }];
}

function checkSoulCount(text: string): CheckItem[] {
  const count = countOccurrences(text, '魂');
  const MAX = 5;
  return [{
    id: 'soul_count',
    category: '表現バランス',
    label: `「魂」の使用回数（上限${MAX}回）`,
    status: count <= MAX ? 'pass' : 'fail',
    severity: 'error',
    detail: `${count}回使用`,
    value: count,
  }];
}

function checkLoveCount(text: string): CheckItem[] {
  const count = countRegex(text, /愛/g);
  const MAX = 5;
  return [{
    id: 'love_count',
    category: '表現バランス',
    label: `「愛」の使用回数（上限${MAX}回）`,
    status: count <= MAX ? 'pass' : count <= 8 ? 'warn' : 'fail',
    severity: count <= 8 ? 'warning' : 'error',
    detail: `${count}回使用`,
    value: count,
  }];
}

function checkContentLength(text: string): CheckItem[] {
  const len = text.length;
  const MIN = 800;
  const IDEAL_MIN = 1500;
  return [{
    id: 'content_length',
    category: 'コンテンツ',
    label: `本文の文字数（最低${MIN}文字）`,
    status: len >= IDEAL_MIN ? 'pass' : len >= MIN ? 'warn' : 'fail',
    severity: len >= MIN ? 'warning' : 'error',
    detail: `${len}文字`,
    value: len,
  }];
}

function checkKeywordDensity(text: string, keyword?: string): CheckItem[] {
  if (!keyword) {
    return [{
      id: 'keyword_density',
      category: 'SEO',
      label: 'キーワードが本文に含まれているか',
      status: 'warn',
      severity: 'warning',
      detail: 'キーワード未設定',
    }];
  }

  // スペース区切りのキーワードは個別トークンでもカウント
  const tokens = keyword.split(/\s+/).filter(t => t.length > 0);
  const fullCount = countOccurrences(text, keyword);

  // 個別トークンの最小出現数
  let minTokenCount = Infinity;
  let weakToken = '';
  for (const token of tokens) {
    const c = countOccurrences(text, token);
    if (c < minTokenCount) {
      minTokenCount = c;
      weakToken = token;
    }
  }
  if (!isFinite(minTokenCount)) minTokenCount = 0;

  const effectiveCount = tokens.length > 1
    ? Math.max(fullCount, minTokenCount)
    : fullCount;

  const MIN = 3;
  return [{
    id: 'keyword_density',
    category: 'SEO',
    label: `キーワード「${keyword}」の出現回数（最低${MIN}回）`,
    status: effectiveCount >= MIN ? 'pass' : effectiveCount >= 1 ? 'warn' : 'fail',
    severity: effectiveCount >= 1 ? 'warning' : 'error',
    detail: tokens.length > 1
      ? `フルフレーズ${fullCount}回、最少トークン「${weakToken}」${minTokenCount}回`
      : `${fullCount}回`,
    value: effectiveCount,
  }];
}

function checkCtaCount(html: string): CheckItem[] {
  const ctaCount = countRegex(html, /class="harmony-cta[\s"]/g);
  const EXPECTED = 2;
  return [{
    id: 'cta_count',
    category: 'CTA',
    label: `CTA配置数（${EXPECTED}箇所）`,
    status: ctaCount === EXPECTED ? 'pass' : ctaCount > 0 ? 'warn' : 'fail',
    severity: ctaCount === 0 ? 'error' : 'warning',
    detail: `${ctaCount}箇所`,
    value: ctaCount,
  }];
}

function checkCtaUrls(html: string): CheckItem[] {
  // CTAリンクのhrefが正しいURLを指しているか
  const ctaLinks = html.match(/class="harmony-cta-btn"[^>]*href="([^"]+)"/g) || [];
  const validDomains = ['harmony-booking.web.app', 'harmony-mc.com'];
  const badLinks: string[] = [];

  for (const link of ctaLinks) {
    const hrefMatch = link.match(/href="([^"]+)"/);
    if (hrefMatch) {
      const href = hrefMatch[1];
      const isValid = validDomains.some(d => href.includes(d));
      if (!isValid) badLinks.push(href);
    }
  }

  return [{
    id: 'cta_urls',
    category: 'CTA',
    label: 'CTAリンク先が正しいか',
    status: badLinks.length === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: badLinks.length > 0 ? `不正なURL: ${badLinks.join(', ')}` : undefined,
  }];
}

function checkTitleBannedExpressions(title: string): CheckItem[] {
  const found: string[] = [];
  const titleBanned = [...BANNED_BOOK_EXPRESSIONS, ...BANNED_LITERARY];
  for (const expr of titleBanned) {
    if (title.includes(expr)) found.push(expr);
  }
  return [{
    id: 'title_banned',
    category: 'タイトル',
    label: 'タイトルに禁止表現が含まれていないか',
    status: found.length === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: found.length > 0 ? `検出: ${found.join('、')}` : undefined,
  }];
}

function checkTitleLength(title: string): CheckItem[] {
  const len = title.length;
  return [{
    id: 'title_length',
    category: 'タイトル',
    label: 'タイトルの文字数（28-40文字推奨）',
    status: len >= 28 && len <= 45 ? 'pass' : len >= 20 && len <= 55 ? 'warn' : 'fail',
    severity: 'warning',
    detail: `${len}文字`,
    value: len,
  }];
}

function checkH2Structure(html: string): CheckItem[] {
  const h2Count = countRegex(html, /<h2[\s>]/g);
  return [{
    id: 'h2_structure',
    category: 'コンテンツ',
    label: 'H2見出しが適切に配置されているか（3-7個）',
    status: h2Count >= 3 && h2Count <= 7 ? 'pass' : h2Count >= 2 ? 'warn' : 'fail',
    severity: h2Count >= 2 ? 'warning' : 'error',
    detail: `${h2Count}個`,
    value: h2Count,
  }];
}

function checkMetaDescription(metaDescription?: string): CheckItem[] {
  if (!metaDescription) {
    return [{
      id: 'meta_description',
      category: 'SEO',
      label: 'メタディスクリプションが設定されているか',
      status: 'fail',
      severity: 'error',
      detail: '未設定',
    }];
  }
  const len = metaDescription.length;
  return [{
    id: 'meta_description',
    category: 'SEO',
    label: 'メタディスクリプション（80-160文字推奨）',
    status: len >= 80 && len <= 160 ? 'pass' : len >= 50 ? 'warn' : 'fail',
    severity: len >= 50 ? 'warning' : 'error',
    detail: `${len}文字`,
    value: len,
  }];
}

function checkImagePlaceholders(html: string): CheckItem[] {
  const remaining = countRegex(html, /<!--IMAGE:[^>]*-->/g);
  return [{
    id: 'image_placeholders',
    category: '画像',
    label: '未置換の画像プレースホルダーがないか',
    status: remaining === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: remaining > 0 ? `${remaining}個の未置換プレースホルダー` : undefined,
    value: remaining,
  }];
}

// ─── 由起子さんフィードバック対応チェック ────────────────────────────────────────

function checkDoubleQuotes(text: string): CheckItem[] {
  const stripped = stripHtml(text);
  const count = (stripped.match(/\u201C|\u201D/g) || []).length;
  return [{
    id: 'double_quotes',
    category: '記号',
    label: '文章中にダブルクォーテーションが使われていないか',
    status: count === 0 ? 'pass' : 'fail',
    severity: 'error',
    detail: count > 0 ? `${count}箇所で\u201C\u201Dを検出。「」に置き換えてください` : undefined,
    value: count,
  }];
}

const ABSTRACT_EXPRESSIONS = [
  '宇宙のエネルギー', '高い波動', 'すべてはつながっている',
  '本来のあなた', '魂のレベル', '次元上昇', 'アセンション',
  '光に満たされ', '愛と光',
];

function checkAbstractExpressions(text: string): CheckItem[] {
  const stripped = stripHtml(text);
  const found: string[] = [];
  for (const expr of ABSTRACT_EXPRESSIONS) {
    if (stripped.includes(expr)) found.push(expr);
  }
  return [{
    id: 'abstract_expressions',
    category: '文体',
    label: '抽象的すぎるスピリチュアル表現がないか',
    status: found.length === 0 ? 'pass' : 'warn',
    severity: 'warning',
    detail: found.length > 0 ? `検出: ${found.join('、')}。具体例を添えてください` : undefined,
  }];
}

function checkSoftEndings(text: string): CheckItem[] {
  const stripped = stripHtml(text);
  const softCount = (stripped.match(/ですよね|ですね|なんです/g) || []).length;
  const totalSentences = (stripped.match(/[。！？]/g) || []).length;
  const ratio = totalSentences > 0 ? softCount / totalSentences : 0;
  return [{
    id: 'soft_endings',
    category: '文体',
    label: '語りかけ語尾（ですよね・ですね・なんです）が十分か',
    status: ratio >= 0.15 ? 'pass' : ratio >= 0.08 ? 'warn' : 'fail',
    severity: 'warning',
    detail: `${softCount}回 / 全${totalSentences}文（${Math.round(ratio * 100)}%、目標15%以上）`,
    value: softCount,
  }];
}

function checkMetaphors(text: string): CheckItem[] {
  const stripped = stripHtml(text);
  const signals = (stripped.match(/たとえば|まるで|のように|みたいに|に似て/g) || []).length;
  return [{
    id: 'metaphors',
    category: '文体',
    label: '比喩・メタファーが含まれているか（2つ以上推奨）',
    status: signals >= 2 ? 'pass' : signals >= 1 ? 'warn' : 'fail',
    severity: 'warning',
    detail: `比喩シグナル ${signals}個検出`,
    value: signals,
  }];
}

// ─── メインチェックリスト関数 ────────────────────────────────────────────────

export interface ChecklistInput {
  title: string;
  html: string;                  // stage2_body_html or published_html
  keyword?: string;
  metaDescription?: string;
  theme?: string;
}

/**
 * 記事の品質チェックリストを実行する。
 * 全てのerrorレベル項目がpassの場合のみ passed=true を返す。
 */
export function runQualityChecklist(input: ChecklistInput): ChecklistResult {
  const { title, html, keyword, metaDescription } = input;
  const text = stripHtml(html);

  const items: CheckItem[] = [
    // 禁止表現
    ...checkBannedBookExpressions(text, html),
    ...checkMedicalExpressions(text),
    ...checkErrorPatterns(text, html),

    // 表現バランス
    ...checkSoulCount(text),
    ...checkLoveCount(text),

    // 文体
    ...checkAIPatterns(text),
    ...checkLiteraryExpressions(text),

    // 由起子さんフィードバック対応
    ...checkDoubleQuotes(html),
    ...checkAbstractExpressions(html),
    ...checkSoftEndings(html),
    ...checkMetaphors(html),

    // タイトル
    ...checkTitleBannedExpressions(title),
    ...checkTitleLength(title),

    // コンテンツ構造
    ...checkContentLength(text),
    ...checkH2Structure(html),
    ...checkImagePlaceholders(html),

    // SEO
    ...checkKeywordDensity(text, keyword),
    ...checkMetaDescription(metaDescription),

    // CTA
    ...checkCtaCount(html),
    ...checkCtaUrls(html),
  ];

  const errorCount = items.filter(i => i.status === 'fail' && i.severity === 'error').length;
  const warningCount = items.filter(i => i.status === 'fail' || i.status === 'warn').length - errorCount;
  const passCount = items.filter(i => i.status === 'pass').length;
  const passed = errorCount === 0;

  // スコア: passは100点、warnは50点、failは0点として平均
  const totalPoints = items.reduce((sum, i) => {
    if (i.status === 'pass') return sum + 100;
    if (i.status === 'warn') return sum + 50;
    return sum;
  }, 0);
  const score = Math.round(totalPoints / items.length);

  const summary = passed
    ? `全${items.length}項目クリア（警告${warningCount}件）— 公開可能です`
    : `${errorCount}件のエラーがあります（${passCount}/${items.length}項目パス）— エラー解消後に公開できます`;

  return {
    passed,
    score,
    items,
    summary,
    checkedAt: new Date().toISOString(),
    errorCount,
    warningCount,
  };
}

// ─── カテゴリ別グルーピング用ユーティリティ ──────────────────────────────────

export function groupByCategory(items: CheckItem[]): Record<string, CheckItem[]> {
  const groups: Record<string, CheckItem[]> = {};
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  return groups;
}
