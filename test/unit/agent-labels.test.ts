// composeAgentLabel — role × step × env var モデル名から表示ラベルを構築するヘルパー
//
// 検証ケース:
//   1. Planner × outline → "AI プランナー (gemini-3.1-pro-preview)" (text モデル)
//   2. Generator × body  → "AI ライター (gemini-3.1-pro-preview)" (text モデル)
//   3. Generator × images → "AI ライター (gemini-3-pro-image-preview)" (image モデル)
//   4. Evaluator × seo_check → "AI 校閲 (gemini-3.1-pro-preview)"
//   5. Publisher × completed → "公開処理" (AI 非関与、モデル名なし)
//   6. role=null → null
//   7. role unknown → 既知 role が空でも生文字列にフォールバック
//   8. GEMINI_MODEL env 上書き時に反映される (動的紐付けの本義)
//   9. GEMINI_IMAGE_MODEL env 上書き時に反映される
//  10. step=null → モデル名なし

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { composeAgentLabel } from '@/lib/queue/agent-labels';

describe('composeAgentLabel', () => {
  const ORIGINAL_TEXT = process.env.GEMINI_MODEL;
  const ORIGINAL_IMAGE = process.env.GEMINI_IMAGE_MODEL;

  beforeEach(() => {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_TEXT === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = ORIGINAL_TEXT;
    if (ORIGINAL_IMAGE === undefined) delete process.env.GEMINI_IMAGE_MODEL;
    else process.env.GEMINI_IMAGE_MODEL = ORIGINAL_IMAGE;
  });

  it('1) Planner × outline → text モデル付与', () => {
    expect(composeAgentLabel('Planner', 'outline')).toBe(
      'AI プランナー (gemini-3.1-pro-preview)',
    );
  });

  it('2) Generator × body → text モデル付与', () => {
    expect(composeAgentLabel('Generator', 'body')).toBe(
      'AI ライター (gemini-3.1-pro-preview)',
    );
  });

  it('3) Generator × images → image モデル付与', () => {
    expect(composeAgentLabel('Generator', 'images')).toBe(
      'AI ライター (gemini-3-pro-image-preview)',
    );
  });

  it('4) Evaluator × seo_check → text モデル付与', () => {
    expect(composeAgentLabel('Evaluator', 'seo_check')).toBe(
      'AI 校閲 (gemini-3.1-pro-preview)',
    );
  });

  it('5) Publisher × completed → AI 非関与、モデル名なし', () => {
    expect(composeAgentLabel('Publisher', 'completed')).toBe('公開処理');
  });

  it('6) role=null → null', () => {
    expect(composeAgentLabel(null, 'outline')).toBeNull();
    expect(composeAgentLabel(undefined, 'outline')).toBeNull();
  });

  it('7) 未知 role でも raw 値を return', () => {
    expect(composeAgentLabel('MysteryAgent', 'outline')).toBe(
      'MysteryAgent (gemini-3.1-pro-preview)',
    );
  });

  it('8) GEMINI_MODEL env 上書きが反映される (動的紐付け)', () => {
    process.env.GEMINI_MODEL = 'gemini-4-pro-experimental';
    expect(composeAgentLabel('Generator', 'body')).toBe(
      'AI ライター (gemini-4-pro-experimental)',
    );
  });

  it('9) GEMINI_IMAGE_MODEL env 上書きが反映される', () => {
    process.env.GEMINI_IMAGE_MODEL = 'banana-pro-2025';
    expect(composeAgentLabel('Generator', 'images')).toBe(
      'AI ライター (banana-pro-2025)',
    );
  });

  it('10) step=null → モデル名なし (役割名のみ)', () => {
    expect(composeAgentLabel('Planner', null)).toBe('AI プランナー');
    expect(composeAgentLabel('Planner', undefined)).toBe('AI プランナー');
  });

  it('未定義の step → モデル名なし', () => {
    expect(composeAgentLabel('Planner', 'unknown_step')).toBe('AI プランナー');
  });
});
