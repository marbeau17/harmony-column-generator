// ============================================================================
// src/types/ai.ts
// AI生成パイプライン全体の型定義
// スピリチュアルコラム向け（シングルテナント）
// ============================================================================

// ─── Gemini API 共通 ───────────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiRequestConfig {
  model?: string;
  systemInstruction?: string;
  messages: GeminiMessage[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  /** JSON モードを強制する */
  responseAsJson?: boolean;
  /** タイムアウト (ms) */
  timeoutMs?: number;
  /** リトライ回数 (0 = リトライなし) */
  maxRetries?: number;
  /** APIキー（未設定時は環境変数フォールバック） */
  apiKey?: string;
}

export interface GeminiResponse {
  text: string;
  finishReason: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rawResponse?: unknown;
}

// ─── ステージ1: 構成案 ─────────────────────────────────────────────────────

/** Stage1 構成案 API への入力パラメータ（スピリチュアルコラム向け） */
export interface Stage1Input {
  /** 元記事ID（リライト時） */
  sourceArticleId?: string;
  /** 元記事の内容（source_articlesから取得、プロンプトに含める） */
  sourceArticleContent?: string;
  /** メインキーワード */
  keyword: string;
  /** テーマ（例: チャクラ、瞑想、エネルギーワーク、天使、タロット等） */
  theme: string;
  /** ターゲットペルソナ（例: スピリチュアル初心者、30代女性） */
  targetPersona: string;
  /** 視点タイプ（例: 解説、体験談、ガイド、考察） */
  perspectiveType: string;
  /** 目標文字数（デフォルト 2000） */
  targetWordCount?: number;
}

/** Stage1 AI が返す構成案 JSON（スピリチュアルコラム向け） */
export interface Stage1OutlineResult {
  seo_filename: string;
  title_proposal: string;
  meta_description: string;
  headings: Stage1Heading[];
  /** quick_answer: 検索結果で表示される即答（PASF構成の冒頭用） */
  quick_answer: string;
  faq: Stage1Faq[];
  image_prompts: Stage1ImagePrompt[];
  /** CTA挿入位置（見出しIDの配列） */
  cta_positions: string[];
  /** CTA文言 */
  cta_texts: string[];
}

export interface Stage1Heading {
  level: 'h2' | 'h3';
  text: string;
  estimated_words: number;
  children?: Stage1Heading[];
}

export interface Stage1Faq {
  question: string;
  answer: string;
}

export interface Stage1ImagePrompt {
  section_id: string;
  heading_text: string;
  prompt: string;
  suggested_filename: string;
}

// ─── ステージ2: 本文生成チェーン ───────────────────────────────────────────

/** Stage2 チェーン全体への入力 */
export interface Stage2Input {
  articleId: string;
  /** 承認済み Stage1 構成案 */
  outline: Stage1OutlineResult;
  keyword: string;
  theme: string;
  targetPersona: string;
  perspectiveType: string;
  /** 目標文字数（デフォルト 2000） */
  targetWordCount?: number;
}

/** サブステップA: 執筆結果 */
export interface WritingResult {
  bodyMarkdown: string;
  chartData: Record<string, unknown> | null;
  ctaPositions: string[];
  tablePositions: string[];
  imagePlaceholders: string[];
}

/** サブステップB: 校閲結果 */
export interface ProofreadResult {
  correctedMarkdown: string;
  corrections: ProofreadCorrection[];
}

export interface ProofreadCorrection {
  before: string;
  after: string;
  reason: string;
}

/** サブステップC: 事実確認結果 */
export interface FactcheckResult {
  finalMarkdown: string;
  factIssues: FactcheckIssue[];
  chartData: Record<string, unknown> | null;
}

export interface FactcheckIssue {
  claim: string;
  status: 'verified' | 'needs_review' | 'corrected';
  note: string;
  correctedText?: string;
}

/** Stage2 チェーン全体の最終結果 */
export interface Stage2ChainResult {
  bodyHtml: string;
  chartData: Record<string, unknown> | null;
  generationLog: string;
  writingResult: WritingResult;
  proofreadResult: ProofreadResult;
  factcheckResult: FactcheckResult;
}

// ─── プロンプトチェーン ─────────────────────────────────────────────────────

export type ChainStepName = 'writing' | 'proofreading' | 'factcheck';

export interface ChainStepResult {
  step: ChainStepName;
  success: boolean;
  durationMs: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rawOutput: string;
  parsedOutput?: unknown;
  error?: string;
}

export interface ChainProgress {
  currentStep: ChainStepName;
  completedSteps: ChainStepName[];
  totalSteps: number;
  startedAt: string;
}
