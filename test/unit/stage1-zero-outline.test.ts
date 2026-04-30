// ============================================================================
// test/unit/stage1-zero-outline.test.ts
// stage1-zero-outline プロンプトビルダーの単体テスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildZeroOutlinePrompt,
  ZERO_OUTLINE_TEMPERATURE,
  YUKIKO_VOCAB_OK,
  NG_DICTIONARY,
  type ZeroOutlineInput,
} from '@/lib/ai/prompts/stage1-zero-outline';

const baseInput: ZeroOutlineInput = {
  theme: { id: 'theme-pet-loss', name: 'ペットロスと向き合う', category: 'grief' },
  persona: {
    id: 'persona-mature-woman',
    name: '40代の女性・愛犬を亡くしたばかり',
    age_range: '40-49',
    tone_guide: 'やさしく寄り添う',
  },
  keywords: ['ペットロス', '立ち直り方', 'スピリチュアル'],
  intent: 'empathy',
  target_length: 2000,
};

describe('buildZeroOutlinePrompt', () => {
  it('system / user の両方を文字列で返す', () => {
    const result = buildZeroOutlinePrompt(baseInput);
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.system.length).toBeGreaterThan(100);
    expect(result.user.length).toBeGreaterThan(100);
  });

  it('system に由起子 14 箇条が含まれる', () => {
    const { system } = buildZeroOutlinePrompt(baseInput);
    expect(system).toContain('14 箇条');
    expect(system).toContain('ナラティブ・アーク');
    expect(system).toContain('awareness');
    expect(system).toContain('wavering');
    expect(system).toContain('acceptance');
    expect(system).toContain('action');
  });

  it('system に由起子語彙辞書（OK）の代表語が含まれる', () => {
    const { system } = buildZeroOutlinePrompt(baseInput);
    expect(system).toContain('ふと');
    expect(system).toContain('そっと');
    expect(system).toContain('かもしれません');
  });

  it('system に NG ワード辞書の代表語が含まれる', () => {
    const { system } = buildZeroOutlinePrompt(baseInput);
    expect(system).toContain('波動');
    expect(system).toContain('過去世');
    expect(system).toContain('霊格');
  });

  it('user にテーマ名が含まれる', () => {
    const { user } = buildZeroOutlinePrompt(baseInput);
    expect(user).toContain('ペットロスと向き合う');
    expect(user).toContain('theme-pet-loss');
  });

  it('user にペルソナ名が含まれる', () => {
    const { user } = buildZeroOutlinePrompt(baseInput);
    expect(user).toContain('40代の女性・愛犬を亡くしたばかり');
    expect(user).toContain('persona-mature-woman');
  });

  it('user に intent と読者意図ガイダンスが含まれる', () => {
    const { user } = buildZeroOutlinePrompt(baseInput);
    expect(user).toContain('empathy');
    expect(user).toContain('寄り添');
  });

  it('user に全キーワードが含まれる', () => {
    const { user } = buildZeroOutlinePrompt(baseInput);
    for (const kw of baseInput.keywords) {
      expect(user).toContain(kw);
    }
  });

  it('user に target_length が含まれる', () => {
    const { user } = buildZeroOutlinePrompt(baseInput);
    expect(user).toContain('2000');
  });

  it('JSON 出力指示（ZeroOutlineOutput / JSON のみ）が含まれる', () => {
    const { system, user } = buildZeroOutlinePrompt(baseInput);
    const combined = system + user;
    expect(combined).toContain('JSON');
    expect(combined).toContain('ZeroOutlineOutput');
  });

  it('intent ごとに異なるガイダンス文が出る', () => {
    const intents: ZeroOutlineInput['intent'][] = ['info', 'empathy', 'solve', 'introspect'];
    const guides = intents.map(
      (intent) => buildZeroOutlinePrompt({ ...baseInput, intent }).user
    );
    // 4 つの intent ガイダンスが互いに異なること
    const unique = new Set(guides);
    expect(unique.size).toBe(intents.length);
  });

  it('オプショナル persona/theme フィールドが省略されても破綻しない', () => {
    const minimalInput: ZeroOutlineInput = {
      theme: { id: 't1', name: 'シンプルテーマ' },
      persona: { id: 'p1', name: 'シンプルペルソナ' },
      keywords: ['キーワードA'],
      intent: 'info',
      target_length: 1500,
    };
    const result = buildZeroOutlinePrompt(minimalInput);
    expect(result.user).toContain('シンプルテーマ');
    expect(result.user).toContain('シンプルペルソナ');
    expect(result.user).toContain('キーワードA');
    expect(result.user).toContain('1500');
  });
});

describe('YUKIKO_VOCAB_OK', () => {
  it('30 語の OK 語彙が定義されている', () => {
    expect(YUKIKO_VOCAB_OK.length).toBe(30);
    expect(YUKIKO_VOCAB_OK).toContain('ふと');
    expect(YUKIKO_VOCAB_OK).toContain('そっと');
  });
});

describe('NG_DICTIONARY', () => {
  it('代表的な NG ワードが含まれる', () => {
    expect(NG_DICTIONARY).toContain('波動');
    expect(NG_DICTIONARY).toContain('過去世');
    expect(NG_DICTIONARY).toContain('前世');
    expect(NG_DICTIONARY).toContain('霊格');
  });

  it('OK 語彙と NG 語彙は重複しない', () => {
    const okSet = new Set(YUKIKO_VOCAB_OK);
    for (const ng of NG_DICTIONARY) {
      expect(okSet.has(ng)).toBe(false);
    }
  });
});

describe('ZERO_OUTLINE_TEMPERATURE', () => {
  it('spec §5.1 の推奨値 0.5 である', () => {
    expect(ZERO_OUTLINE_TEMPERATURE).toBe(0.5);
  });
});
