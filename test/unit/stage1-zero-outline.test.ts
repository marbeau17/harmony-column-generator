// ============================================================================
// test/unit/stage1-zero-outline.test.ts
// stage1-zero-outline プロンプトビルダーの単体テスト
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  buildZeroOutlinePrompt,
  ZERO_OUTLINE_TEMPERATURE,
  YUKIKO_VOCAB_OK,
  NG_DICTIONARY,
  parseZeroOutlineOutput,
  zeroOutlineOutputSchema,
  generateZeroOutlineWithValidation,
  type ZeroOutlineInput,
  type ZeroOutlineOutput,
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

// ─── zod schema 検証 ──────────────────────────────────────────────────────────

const VALID_OUTLINE: ZeroOutlineOutput = {
  lead_summary: 'リード（100〜150字を想定。最低 1 字以上）',
  narrative_arc: {
    opening_hook: { type: 'empathy', text: 'あの子のいない朝' },
    awareness: '悲しみは形を変えながら、いまも胸の奥に残る',
    wavering: 'けれど、忘れたいわけじゃない',
    acceptance: '思い出は、いまも一緒に呼吸している',
    action: '今日はひとつだけ、深呼吸してみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    { title: 'あの子のいない朝', summary: 'はじまり', target_chars: 500, arc_phase: 'awareness' },
    { title: '揺れる気持ち', summary: '揺らぎ', target_chars: 500, arc_phase: 'wavering' },
    { title: 'そのままでいい', summary: '受容', target_chars: 500, arc_phase: 'acceptance' },
    { title: '小さな一歩', summary: '前進', target_chars: 500, arc_phase: 'action' },
  ],
  citation_highlights: ['ハイライト1', 'ハイライト2', 'ハイライト3'],
  faq_items: [
    { q: 'ペットロスはどれくらい続きますか', a: '人それぞれです。長さよりも、いまの気持ちにそっと寄り添ってあげてください。' },
  ],
  image_prompts: [
    { slot: 'hero', prompt: '柔らかい朝日と窓辺の小さな影' },
    { slot: 'body', prompt: '木漏れ日の中の散歩道' },
    { slot: 'summary', prompt: '優しい光に包まれた夕暮れ' },
  ],
  // P5-90: meta_description 必須化に伴い、テスト用の VALID_OUTLINE にも 100 字超の説明を追加。
  meta_description:
    'ペットロスの悲しみとそっと向き合うための小さなヒントを、由起子さんの優しい語り口でお届けします。あなたの心に寄り添う気づきが、ここにあります。',
};

describe('zeroOutlineOutputSchema (zod)', () => {
  it('完全な出力を受理する', () => {
    const result = zeroOutlineOutputSchema.safeParse(VALID_OUTLINE);
    expect(result.success).toBe(true);
  });

  it('lead_summary が空文字なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({ ...VALID_OUTLINE, lead_summary: '' });
    expect(r.success).toBe(false);
  });

  it('closing_style が enum 外なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({
      ...VALID_OUTLINE,
      narrative_arc: { ...VALID_OUTLINE.narrative_arc, closing_style: 'soft' as never },
    });
    expect(r.success).toBe(false);
  });

  it('emotion_curve が空配列なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({ ...VALID_OUTLINE, emotion_curve: [] });
    expect(r.success).toBe(false);
  });

  it('image_prompts が空配列なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({ ...VALID_OUTLINE, image_prompts: [] });
    expect(r.success).toBe(false);
  });

  it('image_prompts の slot が enum 外なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({
      ...VALID_OUTLINE,
      image_prompts: [{ slot: 'cover', prompt: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('h2_chapters.target_chars が負の数なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({
      ...VALID_OUTLINE,
      h2_chapters: [{ ...VALID_OUTLINE.h2_chapters[0], target_chars: -1 }],
    });
    expect(r.success).toBe(false);
  });

  // P5-90: meta_description 必須化
  it('meta_description が空文字なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({
      ...VALID_OUTLINE,
      meta_description: '',
    });
    expect(r.success).toBe(false);
  });

  it('meta_description が 50 字未満なら拒否する', () => {
    const r = zeroOutlineOutputSchema.safeParse({
      ...VALID_OUTLINE,
      meta_description: 'みじかすぎる',
    });
    expect(r.success).toBe(false);
  });

  it('meta_description が欠落していたら拒否する', () => {
    const { meta_description: _omit, ...rest } = VALID_OUTLINE;
    void _omit;
    const r = zeroOutlineOutputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

describe('parseZeroOutlineOutput', () => {
  it('valid output をパースして同等のオブジェクトを返す', () => {
    const parsed = parseZeroOutlineOutput(VALID_OUTLINE);
    expect(parsed).not.toBeNull();
    expect(parsed?.lead_summary).toBe(VALID_OUTLINE.lead_summary);
    expect(parsed?.image_prompts).toHaveLength(3);
  });

  it('image_prompts がオブジェクト形式 {hero, body, summary} でも coerce で受理される', () => {
    const looseRaw = {
      ...VALID_OUTLINE,
      image_prompts: {
        hero: 'h-prompt',
        body: 'b-prompt',
        summary: 's-prompt',
      },
    };
    const parsed = parseZeroOutlineOutput(looseRaw);
    expect(parsed).not.toBeNull();
    expect(parsed?.image_prompts).toEqual([
      { slot: 'hero', prompt: 'h-prompt' },
      { slot: 'body', prompt: 'b-prompt' },
      { slot: 'summary', prompt: 's-prompt' },
    ]);
  });

  it('schema 違反時は null を返す（throw しない）', () => {
    const broken = { lead_summary: '', narrative_arc: null };
    const parsed = parseZeroOutlineOutput(broken, { attempt: 1 });
    expect(parsed).toBeNull();
  });

  it('null や非オブジェクトを渡しても throw しない', () => {
    expect(parseZeroOutlineOutput(null)).toBeNull();
    expect(parseZeroOutlineOutput('string')).toBeNull();
    expect(parseZeroOutlineOutput(42)).toBeNull();
  });
});

describe('generateZeroOutlineWithValidation', () => {
  const fakeInput: ZeroOutlineInput = {
    theme: { id: 't', name: 'テーマ' },
    persona: { id: 'p', name: 'ペルソナ' },
    keywords: ['k'],
    intent: 'empathy',
    target_length: 2000,
  };

  it('1 回目で valid なら 1 回のみ generateJson を呼ぶ', async () => {
    const generateJsonImpl = vi.fn().mockResolvedValue({
      data: VALID_OUTLINE,
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    });
    const result = await generateZeroOutlineWithValidation(fakeInput, {
      generateJsonImpl: generateJsonImpl as never,
    });
    expect(result.lead_summary).toBe(VALID_OUTLINE.lead_summary);
    expect(generateJsonImpl).toHaveBeenCalledTimes(1);
  });

  it('1 回目が schema 違反なら自動で 1 回 retry し、retry 成功なら成功扱い', async () => {
    const generateJsonImpl = vi.fn()
      .mockResolvedValueOnce({
        data: { lead_summary: '', narrative_arc: null }, // 違反
        response: { text: '', finishReason: 'STOP', tokenUsage: {} },
      })
      .mockResolvedValueOnce({
        data: VALID_OUTLINE,
        response: { text: '', finishReason: 'STOP', tokenUsage: {} },
      });
    const result = await generateZeroOutlineWithValidation(fakeInput, {
      generateJsonImpl: generateJsonImpl as never,
      requestId: 'req-test',
    });
    expect(result.lead_summary).toBe(VALID_OUTLINE.lead_summary);
    expect(generateJsonImpl).toHaveBeenCalledTimes(2);
    // 2 回目の user prompt には retry 注意書きが追加されている
    const secondUser = generateJsonImpl.mock.calls[1][1] as string;
    expect(secondUser).toContain('再試行');
  });

  it('2 回連続 schema 違反なら throw する', async () => {
    const broken = { lead_summary: '', narrative_arc: null };
    const generateJsonImpl = vi.fn().mockResolvedValue({
      data: broken,
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    });
    await expect(
      generateZeroOutlineWithValidation(fakeInput, {
        generateJsonImpl: generateJsonImpl as never,
      }),
    ).rejects.toThrow(/schema validation failed after retry/);
    expect(generateJsonImpl).toHaveBeenCalledTimes(2);
  });

  it('retryOnSchemaError=false なら 1 回失敗で即 throw', async () => {
    const broken = { lead_summary: '', narrative_arc: null };
    const generateJsonImpl = vi.fn().mockResolvedValue({
      data: broken,
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    });
    await expect(
      generateZeroOutlineWithValidation(fakeInput, {
        generateJsonImpl: generateJsonImpl as never,
        retryOnSchemaError: false,
      }),
    ).rejects.toThrow(/retry disabled/);
    expect(generateJsonImpl).toHaveBeenCalledTimes(1);
  });
});
