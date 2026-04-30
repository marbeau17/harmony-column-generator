// ============================================================================
// src/lib/content/cta-variants-generator.ts
//
// G9: ペルソナ × 感情ステージで A/B テスト用の CTA バリアントを 3 つ生成する。
//
// 仕様 (docs/optimized_spec.md §9.1 / §9.2 / §9.3):
//   位置1 (序盤 30%, 共感ピーク後): empathy   ソフト誘導
//   位置2 (中盤 55%, 転換点直後)  : transition 中強度
//   位置3 (結末 85-100%)          : action    決意の後押し
//
//   utm_content フォーマット:
//     {position}-{persona}-{variant}
//     例: pos1-30s_housewife-A
//
// 制約:
//   - 既存 cta-generator.ts / publish-control コアには手を加えない
//   - 記事本文への write を行わない (純粋関数のみ)
//   - DB アクセスは行わない (永続化は persist-cta-variants.ts に分離)
// ============================================================================

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export type CtaIntent = 'info' | 'empathy' | 'solve' | 'introspect';
export type CtaStage = 'empathy' | 'transition' | 'action';
export type CtaPosition = 1 | 2 | 3;
export type CtaVariantLabel = 'A' | 'B' | 'C';

export interface CtaPersonaInput {
  id: string;
  name: string;
  age_range?: string | null;
}

export interface GenerateCtaVariantsInput {
  articleSlug: string;
  persona: CtaPersonaInput;
  intent: CtaIntent;
}

export interface CtaVariant {
  position: CtaPosition;
  persona_id: string;
  stage: CtaStage;
  copy_text: string;
  micro_copy: string;
  variant_label: CtaVariantLabel;
  utm_content: string;
}

// ─── マイクロコピー（spec §9.2 固定リスト） ────────────────────────────────

export const MICRO_COPY_POOL: readonly string[] = [
  '初回 30 分無料 / オンライン対応',
  '予約後すぐキャンセル可・キャンセル料なし',
  'LINEで気軽にご相談から',
  '秘密厳守',
] as const;

// ─── ペルソナ × ステージ別 文言テーブル ─────────────────────────────────────
//
// spec §9.1 の例文を起点に、4 ペルソナトーン × 3 ステージで構成。
// 「ペルソナトーン」は persona.age_range / name から自動マップする。
//
// マップロジック:
//   age_range が "30" を含む → 30s_housewife
//   age_range が "40" を含む → 40s_career
//   age_range が "50" 以上を含む → 50s_plus
//   それ以外 / 不明           → default
// ─────────────────────────────────────────────────────────────────────────────

type PersonaToneKey = '30s_housewife' | '40s_career' | '50s_plus' | 'default';

interface StageCopy {
  empathy: string;
  transition: string;
  action: string;
}

// intent ごとに微妙にトーンを差し替えるための語尾調整辞書
// 各 intent は base 文を一意に変換するサフィックス的な語を持つ
const INTENT_FLAVORS: Record<CtaIntent, { empathy: string; transition: string; action: string }> = {
  info: {
    empathy: '気になることがあれば、気軽に質問してみませんか',
    transition: '知りたいことを 30 分でじっくり聞ける時間をご用意しました',
    action: '次の一歩は、確かな情報と一緒に踏み出せます',
  },
  empathy: {
    empathy: 'ひとりで抱え込まなくて大丈夫。まずは話してみませんか',
    transition: 'あなたの心が軽くなる時間を、30 分だけ用意しました',
    action: '次の一歩は、由起子と一緒に踏み出せます',
  },
  solve: {
    empathy: 'モヤモヤを言葉にするだけで、出口は見えてきます',
    transition: '解決の糸口を一緒に探す 30 分を、お預かりします',
    action: '今日の決断が、明日の自分を変えていきます',
  },
  introspect: {
    empathy: '自分の声に耳をすませる時間、持ってみませんか',
    transition: '内側の声をゆっくり辿る 30 分を、用意しました',
    action: '本当の願いに気づいた今が、動き出すタイミングです',
  },
};

// ペルソナトーン別の語尾微調整（軽量に差し替えるためのプリフィックス／クロージング）
const PERSONA_TONE_PREFIX: Record<PersonaToneKey, { empathy: string; transition: string; action: string }> = {
  '30s_housewife': {
    empathy: '日々のなかでふと立ち止まったとき、',
    transition: '家族のことを思いながらも、',
    action: 'あなた自身の時間として、',
  },
  '40s_career': {
    empathy: '走り続ける毎日のなかで、',
    transition: 'キャリアの節目に立つ今だからこそ、',
    action: 'これからの選択を、',
  },
  '50s_plus': {
    empathy: 'これまで歩んできた道を振り返るとき、',
    transition: '人生後半をやさしく整える時間として、',
    action: 'これからの自分のために、',
  },
  default: {
    empathy: '',
    transition: '',
    action: '',
  },
};

// ─── ヘルパー ──────────────────────────────────────────────────────────────

function resolvePersonaToneKey(persona: CtaPersonaInput): PersonaToneKey {
  const age = (persona.age_range ?? '').trim();
  if (!age) return 'default';
  if (/30/.test(age)) return '30s_housewife';
  if (/40/.test(age)) return '40s_career';
  if (/50|60|70/.test(age)) return '50s_plus';
  return 'default';
}

/**
 * 決定的にマイクロコピーを 1 つ選ぶ。
 * articleSlug + persona.id + position の hash で MICRO_COPY_POOL から 1 つ選択。
 * 「ランダム 1 つ」だが、テストで再現可能にするため決定論的 hash を採用。
 */
function pickMicroCopy(articleSlug: string, personaId: string, position: CtaPosition): string {
  const seed = `${articleSlug}::${personaId}::${position}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return MICRO_COPY_POOL[hash % MICRO_COPY_POOL.length];
}

/**
 * persona 名から utm_content 用の slug を作る。
 * "30 代主婦" → "30s_housewife" のような変換は age_range 由来のキーを優先する。
 * persona.name を ASCII safe な英数アンダースコアに正規化する。
 */
function personaSlugForUtm(persona: CtaPersonaInput): string {
  const toneKey = resolvePersonaToneKey(persona);
  if (toneKey !== 'default') return toneKey;

  // フォールバック: persona.id 末尾 8 文字
  const safeId = persona.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return safeId.length > 0 ? `p_${safeId}` : 'p_unknown';
}

function variantLabelFor(position: CtaPosition): CtaVariantLabel {
  // 位置 → variant_label を 1:1 で割り当て (A: empathy, B: transition, C: action)
  if (position === 1) return 'A';
  if (position === 2) return 'B';
  return 'C';
}

function stageFor(position: CtaPosition): CtaStage {
  if (position === 1) return 'empathy';
  if (position === 2) return 'transition';
  return 'action';
}

function buildCopyText(intent: CtaIntent, toneKey: PersonaToneKey, stage: CtaStage): string {
  const base = INTENT_FLAVORS[intent][stage];
  const prefix = PERSONA_TONE_PREFIX[toneKey][stage];
  if (!prefix) return base;
  return `${prefix}${base}`;
}

function buildUtmContent(position: CtaPosition, personaSlug: string, variantLabel: CtaVariantLabel): string {
  return `pos${position}-${personaSlug}-${variantLabel}`;
}

// ─── メイン関数 ────────────────────────────────────────────────────────────

/**
 * 1 記事に対して 3 バリアントの CTA を生成する。
 *
 * 各位置 (1/2/3) に対し、感情ステージ (empathy/transition/action) を割り当て、
 * persona × intent から copy_text を生成、固定リストから micro_copy を選択する。
 */
export function generateCtaVariants(input: GenerateCtaVariantsInput): CtaVariant[] {
  if (!input.articleSlug || input.articleSlug.trim() === '') {
    throw new Error('generateCtaVariants: articleSlug is required');
  }
  if (!input.persona || !input.persona.id) {
    throw new Error('generateCtaVariants: persona.id is required');
  }
  if (!INTENT_FLAVORS[input.intent]) {
    throw new Error(`generateCtaVariants: unknown intent "${input.intent}"`);
  }

  const toneKey = resolvePersonaToneKey(input.persona);
  const personaSlug = personaSlugForUtm(input.persona);

  const positions: CtaPosition[] = [1, 2, 3];

  return positions.map((position) => {
    const stage = stageFor(position);
    const variantLabel = variantLabelFor(position);
    const copyText = buildCopyText(input.intent, toneKey, stage);
    const microCopy = pickMicroCopy(input.articleSlug, input.persona.id, position);
    const utmContent = buildUtmContent(position, personaSlug, variantLabel);

    return {
      position,
      persona_id: input.persona.id,
      stage,
      copy_text: copyText,
      micro_copy: microCopy,
      variant_label: variantLabel,
      utm_content: utmContent,
    };
  });
}
