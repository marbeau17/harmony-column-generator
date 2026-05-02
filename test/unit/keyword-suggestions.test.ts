import { describe, it, expect } from 'vitest';
import {
  buildPersonaCandidates,
  buildAiSuggestionPrompt,
  normalizeAiCandidates,
} from '@/lib/ai/prompts/keyword-suggestions';

describe('buildPersonaCandidates — persona × theme から候補', () => {
  const theme = { name: 'ヒーリングと癒し', category: null };
  const persona = {
    name: '彩花',
    age_range: '20-29',
    description: '20代女性。SNSでスピリチュアル系をフォロー。',
    search_patterns: ['タロット', 'オラクルカード'],
    tone_guide: '明るくポップ、共感を重視',
  };

  it('search_patterns × theme で keyword を生成する（テーマの助詞「と」は除去して長尾化）', () => {
    const got = buildPersonaCandidates({ theme, persona });
    const keywords = got.map((c) => c.keyword);
    // 'ヒーリングと癒し' → splitJaWords で ['ヒーリング', '癒し'] → 短い方を採用
    expect(keywords).toContain('タロット ヒーリング');
    expect(keywords).toContain('オラクルカード ヒーリング');
  });

  it('intent=info で「とは」「初心者」の長尾を含む', () => {
    const got = buildPersonaCandidates({ theme, persona, intent: 'info' });
    const keywords = got.map((c) => c.keyword);
    expect(keywords).toContain('タロット 初心者');
    expect(keywords).toContain('タロット とは');
    expect(keywords).toContain('オラクルカード とは');
  });

  it('intent=solve で「やり方」を含む', () => {
    const got = buildPersonaCandidates({ theme, persona, intent: 'solve' });
    const keywords = got.map((c) => c.keyword);
    expect(keywords).toContain('タロット やり方');
    expect(keywords).toContain('オラクルカード やり方');
    expect(keywords).not.toContain('タロット 初心者');
  });

  it('age_range から世代キーワードを生成する', () => {
    const got = buildPersonaCandidates({ theme, persona });
    const keywords = got.map((c) => c.keyword);
    expect(keywords.some((k) => k.includes('20代'))).toBe(true);
  });

  it('全候補に source=persona と rationale が付与される', () => {
    const got = buildPersonaCandidates({ theme, persona, intent: 'empathy' });
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(c.source).toBe('persona');
      expect(c.rationale).toBeTruthy();
      expect(c.score).toBeGreaterThan(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it('search_patterns が空でも空文字エラーにならない', () => {
    const got = buildPersonaCandidates({
      theme,
      persona: { ...persona, search_patterns: [] },
    });
    // age_range 由来の候補のみ残る
    expect(got.length).toBeGreaterThanOrEqual(0);
    for (const c of got) expect(c.keyword.length).toBeGreaterThan(0);
  });
});

describe('buildAiSuggestionPrompt — Gemini への prompt', () => {
  const args = {
    theme: { name: 'ヒーリングと癒し', category: null },
    persona: {
      name: '彩花',
      age_range: '20-29',
      description: '20代女性',
      search_patterns: ['タロット'],
      tone_guide: '明るくポップ',
    },
    intent: 'info' as const,
    exclude: ['既存KW'],
  };

  it('system + user prompt の必要素材が含まれる', () => {
    const { system, user } = buildAiSuggestionPrompt(args);
    expect(system).toContain('SEO');
    expect(system).toContain('JSON');
    expect(user).toContain('彩花');
    expect(user).toContain('タロット');
    expect(user).toContain('ヒーリングと癒し');
    expect(user).toContain('既存KW');
  });

  it('intent 未指定でも prompt が生成される', () => {
    const { user } = buildAiSuggestionPrompt({ ...args, intent: undefined });
    expect(user).toContain('未指定');
  });

  it('exclude が空でも「なし」と表記される', () => {
    const { user } = buildAiSuggestionPrompt({ ...args, exclude: [] });
    expect(user).toContain('なし');
  });
});

describe('normalizeAiCandidates — Gemini レスポンス正規化', () => {
  it('{candidates:[...]} を正規化', () => {
    const got = normalizeAiCandidates({
      candidates: [
        { keyword: '瞑想 初心者 効果', rationale: '入門需要が高い' },
        { keyword: 'タロット 一日一枚 やり方', rationale: '初心者の継続行動' },
      ],
    });
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      keyword: '瞑想 初心者 効果',
      source: 'ai',
      rationale: '入門需要が高い',
    });
    expect(got[0].score).toBeGreaterThan(got[1].score);
  });

  it('直配列も正規化', () => {
    const got = normalizeAiCandidates([{ keyword: 'A', rationale: 'B' }]);
    expect(got).toHaveLength(1);
    expect(got[0].keyword).toBe('A');
  });

  it('keyword フィールドの代替形（kw）も拾う', () => {
    const got = normalizeAiCandidates({
      candidates: [{ kw: 'fallback', rationale: 'ok' }],
    });
    expect(got).toHaveLength(1);
    expect(got[0].keyword).toBe('fallback');
  });

  it('keyword 欠損エントリはスキップ', () => {
    const got = normalizeAiCandidates({
      candidates: [
        { rationale: 'kw missing' },
        { keyword: 'OK', rationale: 'fine' },
      ],
    });
    expect(got).toHaveLength(1);
    expect(got[0].keyword).toBe('OK');
  });

  it('rationale 欠損は "AI 提案" にフォールバック', () => {
    const got = normalizeAiCandidates([{ keyword: 'X' }]);
    expect(got[0].rationale).toBe('AI 提案');
  });

  it('null/undefined/想定外型は空配列', () => {
    expect(normalizeAiCandidates(null)).toEqual([]);
    expect(normalizeAiCandidates(undefined)).toEqual([]);
    expect(normalizeAiCandidates('string')).toEqual([]);
    expect(normalizeAiCandidates(42)).toEqual([]);
  });
});
