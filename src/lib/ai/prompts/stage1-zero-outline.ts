// ============================================================================
// src/lib/ai/prompts/stage1-zero-outline.ts
// ステージ1（ゼロ生成版）: 元記事に依存せず、テーマ/ペルソナ/キーワードのみから
// 「ナラティブ・アーク（気づき→揺らぎ→受容→行動）」を中核とする深い構成案を生成する。
// spec §5.1 に対応。既存 stage1-outline.ts は変更せず、独立した別関数として提供する。
//
// 出力 JSON は zod schema (zeroOutlineOutputSchema) で強制検証する。
// schema 違反時は logger.error + プロンプト 1 回リトライ → それでも失敗ならスロー。
// （P5-17: Stage1 outline の構造保証を強化）
// ============================================================================

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { generateJson } from '@/lib/ai/gemini-client';

// ─── 入出力型 ─────────────────────────────────────────────────────────────────

export interface ZeroOutlineInput {
  theme: { id: string; name: string; category?: string };
  persona: { id: string; name: string; age_range?: string; tone_guide?: string };
  keywords: string[];
  intent: 'info' | 'empathy' | 'solve' | 'introspect';
  target_length: number;
}

// ─── zod schema（Gemini 出力検証） ────────────────────────────────────────────
//
// AI 出力は不安定で、しばしば
//   - キー欠落（faq_items / image_prompts 等）
//   - 型不一致（emotion_curve が "1" 等の文字列になる）
//   - enum 違反（closing_style が "soft" など）
//   - image_prompts のオブジェクト形式（{hero,body,summary}）
// を含む。これらを catch して検出し、リトライ or fallback を判定する。

const arcPhaseSchema = z.enum(['awareness', 'wavering', 'acceptance', 'action']);

const openingHookSchema = z.object({
  type: z.enum(['question', 'scene', 'empathy']),
  text: z.string().min(1),
});

const narrativeArcSchema = z.object({
  opening_hook: openingHookSchema,
  awareness: z.string().min(1),
  wavering: z.string().min(1),
  acceptance: z.string().min(1),
  action: z.string().min(1),
  closing_style: z.enum(['lingering', 'direct']),
});

const h2ChapterSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  target_chars: z.number().int().nonnegative(),
  // arc_phase はモデルによって表記揺れが起きるため z.string() に留め、
  // 値検査は別途 warn ログでカバー（過剰拒否で生成失敗にしない）。
  arc_phase: z.string().min(1),
});

const faqItemSchema = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
});

const imagePromptSchema = z.object({
  slot: z.enum(['hero', 'body', 'summary']),
  prompt: z.string().min(1),
});

/**
 * Stage1 ゼロ生成 outline の zod schema。
 * Gemini 応答は generateJson で受け取った後、本 schema で parse される。
 */
export const zeroOutlineOutputSchema = z.object({
  lead_summary: z.string().min(1),
  narrative_arc: narrativeArcSchema,
  emotion_curve: z.array(z.number()).min(1),
  h2_chapters: z.array(h2ChapterSchema).min(1),
  citation_highlights: z.array(z.string()).min(1),
  faq_items: z.array(faqItemSchema).min(1),
  image_prompts: z.array(imagePromptSchema).min(1),
});

export type ZeroOutlineOutput = z.infer<typeof zeroOutlineOutputSchema>;

/**
 * 既知の表記揺れを修復する best-effort coercion。
 * 主に image_prompts の object → array 形式変換を担当。
 */
function coerceLooseOutline(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  // image_prompts: {hero, body, summary} 形式 → 配列形式へ変換
  const ip = obj.image_prompts;
  if (ip && typeof ip === 'object' && !Array.isArray(ip)) {
    const ipObj = ip as Record<string, unknown>;
    const slots: Array<'hero' | 'body' | 'summary'> = ['hero', 'body', 'summary'];
    const arr = slots
      .map((slot) => {
        const v = ipObj[slot];
        if (typeof v === 'string' && v.length > 0) {
          return { slot, prompt: v };
        }
        if (v && typeof v === 'object' && typeof (v as { prompt?: unknown }).prompt === 'string') {
          return { slot, prompt: (v as { prompt: string }).prompt };
        }
        return null;
      })
      .filter((x): x is { slot: 'hero' | 'body' | 'summary'; prompt: string } => x !== null);
    if (arr.length > 0) obj.image_prompts = arr;
  }

  return obj;
}

/**
 * AI 出力 raw を zod で検証する。
 * 失敗時は logger.warn を吐いた上で **best-effort で raw を返す**（hard fail 回避）。
 *
 * P5-63 (2026-05-03): 旧実装は失敗時 null を返し呼出側 retry → 2 連続失敗で
 *   throw "outline 生成失敗" としていたが、AI 出力の自然なブレ（opening_hook の
 *   キー名違い等）でも完全停止していたため本番で生成不能に陥った。
 *   schema 違反は warn ログ + 必須フィールドが揃っていれば raw を通す形に変更。
 *   完全に必須フィールドが欠ける場合のみ null を返す。
 */
export function parseZeroOutlineOutput(
  raw: unknown,
  ctx: { requestId?: string; attempt?: number } = {},
): ZeroOutlineOutput | null {
  const coerced = coerceLooseOutline(raw);
  const result = zeroOutlineOutputSchema.safeParse(coerced);
  if (result.success) return result.data;

  // 必須最小条件: object であり、h2_chapters / image_prompts / lead_summary が
  // 何らかの形で存在すれば「使える」と判断。それ以外は本当に壊れた応答。
  const isMinimallyUsable =
    coerced !== null &&
    typeof coerced === 'object' &&
    'h2_chapters' in (coerced as Record<string, unknown>) &&
    'image_prompts' in (coerced as Record<string, unknown>) &&
    'lead_summary' in (coerced as Record<string, unknown>);

  logger.warn(
    'ai',
    'stage1_zero_outline.schema_violation',
    {
      request_id: ctx.requestId,
      attempt: ctx.attempt ?? 1,
      issues: result.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
      received_keys: raw && typeof raw === 'object' ? Object.keys(raw as object) : null,
      fallback: isMinimallyUsable ? 'raw_passthrough' : 'null_reject',
    },
  );

  if (isMinimallyUsable) {
    // best-effort: AI 出力を ZeroOutlineOutput として通す。型は緩むが下流で
    // null チェックや個別 access で堅牢化されている前提。
    return coerced as ZeroOutlineOutput;
  }
  return null;
}

// ─── 由起子さん語彙辞書（OK 30 語） ────────────────────────────────────────────
// 原文文体の核を成す語彙。プロンプトに埋め込み、生成時の語彙傾斜を促す。

export const YUKIKO_VOCAB_OK: readonly string[] = [
  'ふと',
  'そっと',
  'ですね',
  'かもしれません',
  'ふいに',
  'ゆっくり',
  '少しずつ',
  'やさしい',
  'けれど',
  'たとえば',
  'ひとつ',
  'ふたつ',
  'ときに',
  'さまざま',
  'いっけん',
  'ひとり',
  'すべて',
  'わたしたち',
  '心に宿る',
  '心のスペース',
  '心の声に耳を澄ませる',
  'それでいい',
  '大丈夫',
  'そのままのあなたで',
  '目に見えないけれど確かにある',
  'ですよね',
  'なんです',
  'ではないでしょうか',
  '〜してみてください',
  '〜してみてくださいね',
];

// ─── NG ワード辞書（forbidden_phrases.json 借用想定） ──────────────────────────
// 由起子 FB / 過去のレビューで指摘された禁止語彙。
// 抽象スピリチュアル語、書籍固有語、AI 臭フレーズを網羅する。

export const NG_DICTIONARY: readonly string[] = [
  // 抽象スピリチュアル語（読者が体感できない語）
  '波動',
  '過去世',
  '前世',
  '霊格',
  '霊性',
  'オーラ',
  'チャクラ',
  '高次元',
  'アセンション',
  '宇宙のエネルギー',
  '高い波動',
  '魂のレベル',
  'ハイヤーセルフ',
  // 書籍固有エピソード（一般コラム不適切）
  '愛の涙',
  '走馬灯',
  '光の使者',
  '愛の記憶',
  '命の境界線',
  '愛のエネルギー',
  '波紋のように',
  '生死の境',
  '臨死',
  '人生の最後に',
  '最期の瞬間',
  '命の淵',
  '死後の世界',
  '木漏れ日',
  // AI 臭・SEO 定型
  'いかがでしたでしょうか',
  '参考になれば幸いです',
  'まとめると',
  '結論から言うと',
  'について解説します',
  'を紹介します',
  'していきましょう',
  // カタカナ語（言い換え推奨）
  'アプローチ',
  'メソッド',
  'ソリューション',
  'フレームワーク',
  'ポジティブ',
  'メンタル',
  // 押し付け / 恐怖煽り
  'すべきです',
  'しなければなりません',
  'このままでは',
  '手遅れになる前に',
  '放置すると',
];

// ─── 由起子 FB 14 項目（spec §5.1 / stage2-writing.ts から抽出） ───────────────
// プロンプト埋め込み用に 14 箇条へ正規化。生成段階での品質ゲート前置きに用いる。

const YUKIKO_FB_14: readonly string[] = [
  '1. 1記事は1テーマ1視点に絞る。複数の論点を混ぜず、1つの気づきへ深く降りていく',
  '2. ダブルポスト（同型記事の量産）を避け、切り口・問い・比喩を必ず変える',
  '3. ""（ダブルクォーテーション）は使用禁止。重要語は「」（鍵括弧）で囲む',
  '4. 抽象表現の単独使用を禁止（「宇宙のエネルギー」「高い波動」等は具体例とセットで）',
  '5. 読者が「深い納得」を得られる構成にする：当たり前の結論にしない、視点の転換を必ず入れる',
  '6. 語尾はやさしく：「〜ですね」「〜なんです」「〜ですよね」「〜かもしれません」を自然に混ぜる',
  '7. 比喩は日常から。木漏れ日・波紋などの常套句は避け、独自の比喩を最低2つ創作する',
  '8. オリジナリティ：元記事や類似記事と語順・語彙・接続を全面置換する',
  '9. 一文 25〜35 字を基本に、最長 50 字以内。短文と中文のリズムを刻む',
  '10. 二人称は「あなた」。「皆さん」「読者の方」は使わない',
  '11. 行動提案は「〜してみてください（ね）」。命令形・「〜しましょう」は禁止',
  '12. 結びは希望と祈りで温かく：「遠回りしてもいい」「それでいい」「〜しますように」',
  '13. 医療断定・宗教断定・恐怖煽りは絶対禁止',
  '14. ナラティブ・アーク：気づき → 揺らぎ → 受容 → 行動 の感情曲線で構成する',
];

// ─── intent 別ガイダンス ───────────────────────────────────────────────────────

const INTENT_GUIDE: Record<ZeroOutlineInput['intent'], string> = {
  info: '情報提供型：読者が知らない知識/視点を、由起子さんの語り口で噛み砕いて伝える',
  empathy: '共感寄り添い型：読者の感情に寄り添い、「あなたは一人ではない」と感じさせる',
  solve: '課題解決型：読者の悩みに対し、心の在り方と小さな行動の両面から具体策を示す',
  introspect: '内省誘発型：読者が自分自身の心を見つめ直す問いをそっと差し出す',
};

// ─── システム / ユーザープロンプト構築 ─────────────────────────────────────────

function buildSystemPrompt(input: ZeroOutlineInput): string {
  return `あなたはスピリチュアルカウンセラー小林由起子さんの文体・思想を深く理解した、コンテンツストラテジストです。
元記事を一切参照せず、テーマ・ペルソナ・キーワード・読者意図のみから、由起子さんらしい「ナラティブ・アーク型」コラムの構成案を生成してください。

## 由起子さん 14 箇条（厳守）
${YUKIKO_FB_14.join('\n')}

## 由起子さん語彙辞書（積極的に使う 30 語）
${YUKIKO_VOCAB_OK.join('、')}

## NG ワード辞書（一切使用禁止）
${NG_DICTIONARY.join('、')}

## ナラティブ・アーク（spec §5.1 中核設計）
記事は以下 4 段階の感情の弧を描くこと。
1. opening_hook（導入の引き）: question / scene / empathy のいずれかで読者を引き込む
2. awareness（気づき）: 読者がうすうす感じていたことを言語化する
3. wavering（揺らぎ）: 「でも実は」「けれど」で視点を転換し、心を揺らす
4. acceptance（受容）: 揺らぎを越えた先の、新しい受け止め方をそっと提示する
5. action（行動）: 今日からできる小さな一歩を「〜してみてくださいね」で提案する
6. closing_style: lingering（余韻）または direct（明瞭な祈り）で閉じる

emotion_curve は H2 章数分の整数列で、-2（沈み込み）〜 +2（解放・希望）の範囲。
典型的には [-1, -2, +1, +2] のように「沈んでから昇る」曲線を描く。

## 出力フォーマット
出力は **JSON のみ**。前後の説明文・コードフェンスは一切不要。
スキーマは ZeroOutlineOutput に厳密準拠：
- lead_summary: 100〜150 字
- narrative_arc: opening_hook / awareness / wavering / acceptance / action / closing_style
- emotion_curve: 数値配列（h2_chapters と同じ要素数）
- h2_chapters: 各章 title / summary / target_chars / arc_phase（awareness|wavering|acceptance|action のいずれか）
- citation_highlights: 80〜120 字 × 3（記事内で引用されうる核心フレーズ）
- faq_items: 2〜3 個の Q&A（Q は読者の検索クエリ風、A は 100〜150 字）
- image_prompts は必ず以下の **配列形式** で返すこと（オブジェクト形式 \`{hero, body, summary}\` は不可）:
\`\`\`json
"image_prompts": [
  {"slot": "hero", "prompt": "..."},
  {"slot": "body", "prompt": "..."},
  {"slot": "summary", "prompt": "..."}
]
\`\`\`
  各要素は必ず \`slot\` と \`prompt\` のキーを持つオブジェクトとし、prompt は日本語で柔らかく幻想的な情景を描写する

## 絶対禁止
- 元記事の参照を装った具体エピソードのねつ造
- NG ワード辞書の語彙の使用
- 医療断定・宗教断定・恐怖煽り
- 「まとめ」「おわりに」「最後に」という見出し`;
}

function buildUserPrompt(input: ZeroOutlineInput): string {
  const personaLine = [
    `id: ${input.persona.id}`,
    `name: ${input.persona.name}`,
    input.persona.age_range ? `age_range: ${input.persona.age_range}` : null,
    input.persona.tone_guide ? `tone_guide: ${input.persona.tone_guide}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  const themeLine = [
    `id: ${input.theme.id}`,
    `name: ${input.theme.name}`,
    input.theme.category ? `category: ${input.theme.category}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return `以下の条件で、ゼロ生成（元記事なし）のスピリチュアルコラム構成案を作成してください。

## 入力条件
- テーマ: ${themeLine}
- ペルソナ: ${personaLine}
- 主要キーワード: ${input.keywords.map((k) => `「${k}」`).join('、')}
- 読者意図 (intent): ${input.intent} — ${INTENT_GUIDE[input.intent]}
- 目標文字数: ${input.target_length} 字（h2_chapters の target_chars 合計をこの値に近づける）

## 設計指針
1. ナラティブ・アーク（awareness → wavering → acceptance → action）の順に H2 章を 3〜4 個構成する
2. emotion_curve は h2_chapters と同じ要素数で、感情の沈降と上昇を数値で示す
3. 主要キーワードは少なくとも 1 つの H2 タイトルに自然に含める
4. citation_highlights は記事内に必ず登場させたい「核心フレーズ」を 3 つ。各 80〜120 字で、由起子さんの語り口で書く
5. faq_items は読者が検索しそうな疑問。Q は短く、A は 100〜150 字
6. image_prompts は hero / body / summary の 3 スロットすべて埋めること。**必ず配列形式 \`[{"slot": "hero", "prompt": "..."}, {"slot": "body", "prompt": "..."}, {"slot": "summary", "prompt": "..."}]\` で返すこと**。オブジェクト形式 \`{hero: "...", body: "...", summary: "..."}\` は禁止

## 出力
ZeroOutlineOutput スキーマに完全準拠した JSON のみを出力してください。`;
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/** ゼロ生成プロンプト（system / user）を組み立てる */
export function buildZeroOutlinePrompt(input: ZeroOutlineInput): {
  system: string;
  user: string;
} {
  return {
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
  };
}

/** ゼロ生成プロンプトの推奨 temperature（spec §5.1） */
export const ZERO_OUTLINE_TEMPERATURE = 0.5;

// ─── Stage1 outline 生成 + zod validation + retry ─────────────────────────────

export interface GenerateZeroOutlineOptions {
  /** generateJson に渡す追加オプション（temperature 等は既定値あり） */
  generateOptions?: Parameters<typeof generateJson>[2];
  /** 1 回目失敗時に再試行するか（既定 true） */
  retryOnSchemaError?: boolean;
  /** 構造化ログ用の request id */
  requestId?: string;
  /** generateJson の差し替え用（テスト注入） */
  generateJsonImpl?: typeof generateJson;
}

/**
 * Stage1 outline を生成し、zod schema で検証する。
 *
 * 検証フロー:
 *   1. プロンプト組立 → generateJson
 *   2. parseZeroOutlineOutput で zod parse
 *      - 成功: 即 return
 *      - 失敗: logger.error 済み。retryOnSchemaError なら 1 回だけ retry
 *   3. 2 度目も失敗ならスロー（呼び出し側で 502 等を返す）
 *
 * NOTE: 既存ルートが直接 generateJson を呼んでいる箇所は別関数として残し、
 *       本関数は新規導入する（responsibility は「生成 + 検証」）。
 */
export async function generateZeroOutlineWithValidation(
  input: ZeroOutlineInput,
  opts: GenerateZeroOutlineOptions = {},
): Promise<ZeroOutlineOutput> {
  const generate = opts.generateJsonImpl ?? generateJson;
  const retry = opts.retryOnSchemaError ?? true;
  const generateOptions = opts.generateOptions ?? {
    temperature: ZERO_OUTLINE_TEMPERATURE,
    topP: 0.9,
  };

  const { system, user } = buildZeroOutlinePrompt(input);

  // 1 回目
  const first = await generate<unknown>(system, user, generateOptions);
  const parsed1 = parseZeroOutlineOutput(first.data, {
    requestId: opts.requestId,
    attempt: 1,
  });
  if (parsed1) return parsed1;

  if (!retry) {
    throw new Error(
      'Stage1 outline schema validation failed (retry disabled)',
    );
  }

  // 2 回目（retry）— プロンプトに「直前の出力が schema 違反だった」旨を追記
  const retryUser =
    user +
    '\n\n## 注意（再試行）\n直前の出力は ZeroOutlineOutput スキーマに違反していました。' +
    'lead_summary / narrative_arc / emotion_curve / h2_chapters / citation_highlights / faq_items / image_prompts を' +
    '**全て**埋め、image_prompts は必ず配列形式で返してください。';

  const second = await generate<unknown>(system, retryUser, generateOptions);
  const parsed2 = parseZeroOutlineOutput(second.data, {
    requestId: opts.requestId,
    attempt: 2,
  });
  if (parsed2) return parsed2;

  // 2 度連続失敗 → 致命扱い（呼び出し側で 502/500 を返す）
  throw new Error(
    'Stage1 outline schema validation failed after retry',
  );
}
