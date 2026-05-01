// ============================================================================
// test/unit/zero-gen-logging.test.ts
// P5-12 M13: 構造化ロギングのキー契約を固定化する単体テスト
//
// 目的:
//   - buildZeroImagePrompts が begin/end ログを emit することを動的検証
//   - stage2 CLI と gemini-client は production を実行せず
//     ソース文字列検査で代表的なログキーが残っていることを保証する
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildZeroImagePrompts } from '@/lib/ai/prompts/zero-image-prompt';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ─── 1. buildZeroImagePrompts: 動的ログ検証 ─────────────────────────────────

describe('buildZeroImagePrompts — 構造化ログ契約', () => {
  it('emits [image-prompt.begin] and [image-prompt.end]', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    buildZeroImagePrompts({
      // outline は最小限 — h2_chapters / lead_summary / image_prompts のみ参照される
      outline: {
        lead_summary: 'テスト用の短いリード文。',
        h2_chapters: [
          { title: 'A', summary: '...', target_chars: 400, arc_phase: 'awareness' },
        ],
        image_prompts: [],
      } as never,
      persona: { image_style: { primary: 'soft pastel' } as never },
      theme: {
        name: 'テスト',
        visual_mood: { keywords: ['warm'] } as never,
      },
    });

    const calls = spy.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain('[image-prompt.begin]');
    expect(calls).toContain('[image-prompt.end]');

    spy.mockRestore();
  });
});

// ─── 2. stage2 CLI: ログキーのインデックスチェック ──────────────────────────

describe('zero-gen-stage2-onwards.ts — stage2 ログキー網羅', () => {
  it('contains the 11 expected stage2 log keys as string literals', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts', 'ops', 'zero-gen-stage2-onwards.ts'),
      'utf-8',
    );

    const expectedKeys = [
      '[zero-gen.stage2.start]',
      '[zero-gen.stage2.article_loaded]',
      '[zero-gen.stage2.refs_resolved]',
      '[zero-gen.stage2.rag.begin]',
      '[zero-gen.stage2.rag.end]',
      '[zero-gen.stage2.writing.begin]',
      '[zero-gen.stage2.writing.end]',
      '[zero-gen.stage2.hallucination.end]',
      '[zero-gen.stage2.tone.end]',
      '[zero-gen.stage2.image.end]',
      '[zero-gen.stage2.done]',
    ];

    for (const key of expectedKeys) {
      expect(src, `stage2 script must contain log key: ${key}`).toContain(key);
    }
  });
});

// ─── 3. gemini-client: 新規構造化ログキーのソース検査 ───────────────────────

describe('gemini-client.ts — 構造化ログキー存在検査', () => {
  it('contains [gemini.request.begin] / [gemini.thinking_dominant] / thinkingPctOfTotal', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src', 'lib', 'ai', 'gemini-client.ts'),
      'utf-8',
    );

    expect(src).toContain('[gemini.request.begin]');
    expect(src).toContain('[gemini.thinking_dominant]');
    expect(src).toContain('thinkingPctOfTotal');
  });
});
