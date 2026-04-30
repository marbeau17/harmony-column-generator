// ============================================================================
// src/lib/hallucination/claim-extractor.ts
// spec §6.2 step1: Claim 抽出
//   1) HTML タグを除去してプレーンテキスト化
//   2) 句点（。！？）単位で文に分割
//   3) Gemini に文集合を渡し、{sentence_idx, claim_text, claim_type} を JSON で受領
//   4) 不正値（範囲外 idx / 未知 claim_type）を除去して返す
//
// 既存 publish-control コア / articles.ts は変更しない。
// 記事本文への write は一切行わない。
// ============================================================================

import { generateJson } from '@/lib/ai/gemini-client';
import type { Claim, ClaimType } from '@/types/hallucination';

// ─── 定数 ──────────────────────────────────────────────────────────────────

const VALID_CLAIM_TYPES: ReadonlySet<ClaimType> = new Set<ClaimType>([
  'factual',
  'attribution',
  'spiritual',
  'logical',
  'experience',
  'general',
]);

const SYSTEM_PROMPT =
  'あなたは記事の文単位 claim 抽出器です。与えられた文集合を逐一分析し、claim_type を厳密に判定して JSON 配列のみを出力してください。説明や前置きは禁止です。';

// ─── ユーティリティ ────────────────────────────────────────────────────────

/**
 * HTML タグを除去してプレーンテキストへ正規化する。
 * cheerio は持ち込まず、軽量な正規表現で処理する。
 *  - <script>, <style> ブロックは中身ごと除去
 *  - その他のタグは開閉ともに除去
 *  - 主要 HTML エンティティをデコード
 *  - 連続空白を 1 個に圧縮
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  let text = html;

  // script / style ブロックは中身ごと削除
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // ブロック要素は文区切りとして改行に変換
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, '\n');
  text = text.replace(/<br\s*\/?>(?=)/gi, '\n');

  // 残りのタグ除去
  text = text.replace(/<[^>]+>/g, '');

  // HTML エンティティ簡易デコード
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 空白の正規化（改行は文分割のため一旦残す）
  text = text.replace(/[ \t　]+/g, ' ');
  text = text.replace(/\n{2,}/g, '\n');

  return text.trim();
}

/**
 * 句点（。！？!?）単位で文に分割する。
 * 句点直後に閉じ括弧（」』）が続く場合は、その閉じ括弧まで含めて 1 文とする。
 * 改行も区切りとして扱う。空文字列は除外する。
 */
export function splitSentences(plainText: string): string[] {
  if (!plainText) return [];

  const sentences: string[] = [];
  let buf = '';

  for (let i = 0; i < plainText.length; i++) {
    const ch = plainText[i];
    buf += ch;

    const isSentenceEnd =
      ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?';

    if (isSentenceEnd) {
      // 直後が閉じ括弧なら吸収
      while (
        i + 1 < plainText.length &&
        (plainText[i + 1] === '」' || plainText[i + 1] === '』' || plainText[i + 1] === ')' || plainText[i + 1] === '）')
      ) {
        buf += plainText[i + 1];
        i++;
      }
      const trimmed = buf.trim();
      if (trimmed.length > 0) sentences.push(trimmed);
      buf = '';
      continue;
    }

    if (ch === '\n') {
      const trimmed = buf.replace(/\n/g, '').trim();
      if (trimmed.length > 0) sentences.push(trimmed);
      buf = '';
    }
  }

  // 末尾に句点なしで残った文も拾う
  const tail = buf.trim();
  if (tail.length > 0) sentences.push(tail);

  return sentences;
}

// ─── プロンプト構築 ────────────────────────────────────────────────────────

function buildUserPrompt(sentences: string[]): string {
  const numbered = sentences
    .map((s, idx) => `${idx}: ${s}`)
    .join('\n');

  return [
    'あなたは記事の文単位 claim 抽出器。',
    '以下の本文（句点で分割済み）を分析し、各文に対して以下を JSON 配列で返してください。',
    '',
    '[{"sentence_idx": 0, "claim_text": "...", "claim_type": "factual|attribution|spiritual|logical|experience|general"}]',
    '',
    'claim_type 定義:',
    '- factual: 事実主張（年代、数値、固有名詞、統計）',
    '- attribution: 引用（〇〇研究者は、〇〇によると）',
    '- spiritual: スピリチュアル断定（波動が、過去世が）',
    '- logical: 論理主張（A だから B である）',
    '- experience: 体験談（個人の体験）',
    '- general: 一般論・問いかけ',
    '',
    '制約:',
    '- 各文に対して必ず 1 件返すこと',
    '- sentence_idx は入力で付与した番号と一致させること',
    '- JSON 配列のみを出力し、前後に説明を付けないこと',
    '',
    '本文:',
    numbered,
  ].join('\n');
}

// ─── Gemini レスポンスのバリデーション ──────────────────────────────────────

interface RawClaimRow {
  sentence_idx?: unknown;
  claim_text?: unknown;
  claim_type?: unknown;
}

function isClaimType(v: unknown): v is ClaimType {
  return typeof v === 'string' && VALID_CLAIM_TYPES.has(v as ClaimType);
}

function normalizeRows(
  rows: RawClaimRow[],
  sentences: string[],
): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const idx = typeof row.sentence_idx === 'number' ? row.sentence_idx : Number(row.sentence_idx);
    if (!Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= sentences.length) continue;
    if (seen.has(idx)) continue;

    const claimType: ClaimType = isClaimType(row.claim_type) ? row.claim_type : 'general';
    // claim_text が空または欠落していたら元文を採用（recall 確保）
    const rawText = typeof row.claim_text === 'string' ? row.claim_text.trim() : '';
    const claim_text = rawText.length > 0 ? rawText : sentences[idx];

    out.push({ sentence_idx: idx, claim_text, claim_type: claimType });
    seen.add(idx);
  }

  return out.sort((a, b) => a.sentence_idx - b.sentence_idx);
}

// ─── メイン ───────────────────────────────────────────────────────────────

/**
 * 記事 HTML 本文から文単位の Claim を抽出する。
 *
 * 失敗時の挙動:
 *   - 空文字列 → 空配列を返す
 *   - Gemini 応答が配列でない / パース不能 → 空配列を返す（呼び出し側でハンドリング）
 *
 * 注意: この関数は記事本文を一切書き換えない（read-only）。
 */
export async function extractClaims(htmlBody: string): Promise<Claim[]> {
  const plain = stripHtml(htmlBody);
  const sentences = splitSentences(plain);
  if (sentences.length === 0) return [];

  let parsed: unknown;
  try {
    const { data } = await generateJson<unknown>(
      SYSTEM_PROMPT,
      buildUserPrompt(sentences),
      {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    );
    parsed = data;
  } catch (err) {
    console.error('[claim-extractor.gemini_failed]', { err });
    return [];
  }

  // Gemini が { claims: [...] } 形式で包んでくるケースも許容
  let rows: RawClaimRow[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed as RawClaimRow[];
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { claims?: unknown }).claims)) {
    rows = (parsed as { claims: RawClaimRow[] }).claims;
  } else {
    console.warn('[claim-extractor.unexpected_shape]', {
      type: typeof parsed,
    });
    return [];
  }

  return normalizeRows(rows, sentences);
}
