// ============================================================================
// test/unit/cta-variants-generator.test.ts
//
// G9: generateCtaVariants の振る舞いを検証する。
//
// テスト観点:
//   1. 3 バリアント生成確認 (position 1,2,3 / stage empathy,transition,action)
//   2. utm_content フォーマット検証 (pos{N}-{persona}-{variant})
//   3. intent ごとの文言差分 (info / empathy / solve / introspect)
//   4. micro_copy が固定 4 種から選択される
//   5. 入力バリデーション
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  generateCtaVariants,
  MICRO_COPY_POOL,
  type CtaIntent,
  type CtaPersonaInput,
} from '@/lib/content/cta-variants-generator';

const PERSONA_30S: CtaPersonaInput = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '30代主婦',
  age_range: '30代',
};

const PERSONA_40S: CtaPersonaInput = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '40代キャリア',
  age_range: '40代',
};

const PERSONA_50S: CtaPersonaInput = {
  id: '33333333-3333-4333-8333-333333333333',
  name: '50代以上',
  age_range: '50代以上',
};

const PERSONA_UNKNOWN: CtaPersonaInput = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '不明',
};

describe('generateCtaVariants - 3 バリアント生成', () => {
  it('必ず 3 件のバリアントを返す', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(variants).toHaveLength(3);
  });

  it('position は 1, 2, 3 の昇順で並ぶ', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(variants.map((v) => v.position)).toEqual([1, 2, 3]);
  });

  it('stage は empathy / transition / action の順で割り当てられる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(variants.map((v) => v.stage)).toEqual(['empathy', 'transition', 'action']);
  });

  it('variant_label は A / B / C の順で割り当てられる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(variants.map((v) => v.variant_label)).toEqual(['A', 'B', 'C']);
  });

  it('persona_id がすべてのバリアントに正しく入る', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_40S,
      intent: 'solve',
    });
    for (const v of variants) {
      expect(v.persona_id).toBe(PERSONA_40S.id);
    }
  });

  it('copy_text / micro_copy / utm_content は空文字でない', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    for (const v of variants) {
      expect(v.copy_text.length).toBeGreaterThan(0);
      expect(v.micro_copy.length).toBeGreaterThan(0);
      expect(v.utm_content.length).toBeGreaterThan(0);
    }
  });
});

describe('generateCtaVariants - utm_content フォーマット検証', () => {
  it('"pos{N}-{persona}-{variant}" の形式に従う', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    const re = /^pos[123]-[a-z0-9_]+-[ABC]$/;
    for (const v of variants) {
      expect(v.utm_content).toMatch(re);
    }
  });

  it('30代ペルソナでは persona slug が "30s_housewife" になる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(variants[0].utm_content).toBe('pos1-30s_housewife-A');
    expect(variants[1].utm_content).toBe('pos2-30s_housewife-B');
    expect(variants[2].utm_content).toBe('pos3-30s_housewife-C');
  });

  it('40代ペルソナでは persona slug が "40s_career" になる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_40S,
      intent: 'empathy',
    });
    expect(variants[0].utm_content).toBe('pos1-40s_career-A');
  });

  it('50代以上ペルソナでは persona slug が "50s_plus" になる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_50S,
      intent: 'empathy',
    });
    expect(variants[2].utm_content).toBe('pos3-50s_plus-C');
  });

  it('age_range 不明な persona では persona id 由来の slug が入る', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_UNKNOWN,
      intent: 'empathy',
    });
    expect(variants[0].utm_content).toMatch(/^pos1-p_[a-zA-Z0-9]+-A$/);
  });
});

describe('generateCtaVariants - intent ごとの文言差分', () => {
  const intents: CtaIntent[] = ['info', 'empathy', 'solve', 'introspect'];

  it('intent ごとに position 1 (empathy stage) の文言が異なる', () => {
    const copies = intents.map(
      (intent) =>
        generateCtaVariants({
          articleSlug: 'a',
          persona: PERSONA_30S,
          intent,
        })[0].copy_text,
    );
    // 4 つの文言がすべてユニーク
    const unique = new Set(copies);
    expect(unique.size).toBe(intents.length);
  });

  it('intent ごとに position 2 (transition stage) の文言が異なる', () => {
    const copies = intents.map(
      (intent) =>
        generateCtaVariants({
          articleSlug: 'a',
          persona: PERSONA_30S,
          intent,
        })[1].copy_text,
    );
    const unique = new Set(copies);
    expect(unique.size).toBe(intents.length);
  });

  it('intent ごとに position 3 (action stage) の文言が異なる', () => {
    const copies = intents.map(
      (intent) =>
        generateCtaVariants({
          articleSlug: 'a',
          persona: PERSONA_30S,
          intent,
        })[2].copy_text,
    );
    const unique = new Set(copies);
    expect(unique.size).toBe(intents.length);
  });

  it('intent="empathy" の position1 はソフト誘導フレーズ「ひとりで抱え込まなくて大丈夫」を含む', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_UNKNOWN,
      intent: 'empathy',
    });
    expect(variants[0].copy_text).toContain('ひとりで抱え込まなくて大丈夫');
  });

  it('intent="empathy" の position3 は「次の一歩」フレーズを含む', () => {
    const variants = generateCtaVariants({
      articleSlug: 'a',
      persona: PERSONA_UNKNOWN,
      intent: 'empathy',
    });
    expect(variants[2].copy_text).toContain('次の一歩');
  });
});

describe('generateCtaVariants - micro_copy 検証', () => {
  it('micro_copy は固定 4 種リストから選ばれる', () => {
    const variants = generateCtaVariants({
      articleSlug: 'sample-article',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    for (const v of variants) {
      expect(MICRO_COPY_POOL).toContain(v.micro_copy);
    }
  });

  it('同じ入力に対して micro_copy は決定論的 (再実行でも同じ)', () => {
    const a = generateCtaVariants({
      articleSlug: 'reproducible',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    const b = generateCtaVariants({
      articleSlug: 'reproducible',
      persona: PERSONA_30S,
      intent: 'empathy',
    });
    expect(a.map((v) => v.micro_copy)).toEqual(b.map((v) => v.micro_copy));
  });
});

describe('generateCtaVariants - 入力バリデーション', () => {
  it('articleSlug が空文字なら例外', () => {
    expect(() =>
      generateCtaVariants({
        articleSlug: '',
        persona: PERSONA_30S,
        intent: 'empathy',
      }),
    ).toThrow();
  });

  it('persona.id が空なら例外', () => {
    expect(() =>
      generateCtaVariants({
        articleSlug: 'a',
        persona: { id: '', name: 'x' },
        intent: 'empathy',
      }),
    ).toThrow();
  });

  it('未知の intent なら例外', () => {
    expect(() =>
      generateCtaVariants({
        articleSlug: 'a',
        persona: PERSONA_30S,
        // @ts-expect-error: 未知 intent をあえて渡す
        intent: 'unknown_intent',
      }),
    ).toThrow();
  });
});
