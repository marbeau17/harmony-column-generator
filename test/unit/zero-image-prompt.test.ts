// ============================================================================
// test/unit/zero-image-prompt.test.ts
// Zero Generation 画像プロンプトビルダーの単体テスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildZeroImagePrompts,
  ZERO_NEGATIVE_PROMPT,
  ZERO_IMAGE_STYLE_PRESETS,
  type ZeroImagePromptInput,
} from '@/lib/ai/prompts/zero-image-prompt';
import type { ZeroOutlineOutput } from '@/lib/ai/prompts/stage1-zero-outline';

// ─── ベース fixture ───────────────────────────────────────────────────────────

const baseOutline: ZeroOutlineOutput = {
  lead_summary:
    'ペットを亡くした夜、心にぽっかりと空白が残ります。けれどその空白は、共に過ごした時間が確かにあった証なのですね。',
  narrative_arc: {
    opening_hook: { type: 'empathy', text: '夜更けにふと涙がこぼれること、ありませんか' },
    awareness: '喪失感は愛の深さの裏返しであるという気づき',
    wavering: '前を向きたいのに進めない自分への戸惑い',
    acceptance: '悲しみを抱えたまま生きていいという受容',
    action: '今日はゆっくりお茶を淹れてみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    { title: 'ふと訪れる涙の意味', summary: '...', target_chars: 500, arc_phase: 'awareness' },
    { title: '前に進めない夜にそっと', summary: '...', target_chars: 500, arc_phase: 'wavering' },
    { title: '悲しみと共に在ること', summary: '...', target_chars: 500, arc_phase: 'acceptance' },
    { title: '今日できる小さな一歩', summary: '...', target_chars: 500, arc_phase: 'action' },
  ],
  citation_highlights: [
    '悲しみは愛があった証なのですね',
    '涙はやさしさの記憶です',
    'そのままのあなたで大丈夫です',
  ],
  faq_items: [
    { q: 'ペットロスはいつまで続きますか', a: '...' },
    { q: '泣いてばかりの自分が情けないです', a: '...' },
  ],
  image_prompts: [
    { slot: 'hero', prompt: 'a quiet evening room with soft lamplight and a single white flower' },
    { slot: 'body', prompt: 'a hand gently holding a small ribbon, symbolizing memory' },
    { slot: 'summary', prompt: 'a warm cup of tea by a window with morning light' },
  ],
};

const baseInput: ZeroImagePromptInput = {
  outline: baseOutline,
  persona: {
    image_style: {
      preset: '30s_homemaker',
    },
  },
  theme: {
    name: 'グリーフケア',
    visual_mood: {
      palette: 'warm gold, soft lavender',
      lighting: 'morning haze',
      mood: 'introspective, hopeful',
    },
  },
};

// ─── 基本生成 ─────────────────────────────────────────────────────────────────

describe('buildZeroImagePrompts — 基本生成', () => {
  it('hero / body / summary の 3 つすべて生成する', () => {
    const result = buildZeroImagePrompts(baseInput);
    expect(result.hero).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.summary).toBeTruthy();
    expect(typeof result.hero).toBe('string');
    expect(typeof result.body).toBe('string');
    expect(typeof result.summary).toBe('string');
  });

  it('3 つのプロンプトはそれぞれ異なる', () => {
    const result = buildZeroImagePrompts(baseInput);
    expect(result.hero).not.toBe(result.body);
    expect(result.body).not.toBe(result.summary);
    expect(result.hero).not.toBe(result.summary);
  });

  it('スロット別の構図キーワード（16:9 / 1:1）が反映される', () => {
    const result = buildZeroImagePrompts(baseInput);
    expect(result.hero).toContain('16:9');
    expect(result.body).toContain('1:1');
    expect(result.summary).toContain('1:1');
  });

  it('共通スタイル "soft pastel illustration" を含む', () => {
    const result = buildZeroImagePrompts(baseInput);
    expect(result.hero).toContain('soft pastel illustration');
    expect(result.body).toContain('soft pastel illustration');
    expect(result.summary).toContain('soft pastel illustration');
  });
});

// ─── negative_prompt ─────────────────────────────────────────────────────────

describe('buildZeroImagePrompts — negative_prompt 含有', () => {
  it('全スロットに固定 negative_prompt が含まれる', () => {
    const result = buildZeroImagePrompts(baseInput);
    for (const slot of ['hero', 'body', 'summary'] as const) {
      expect(result[slot]).toContain('negative_prompt:');
      expect(result[slot]).toContain('text');
      expect(result[slot]).toContain('watermark');
      expect(result[slot]).toContain('logo');
      expect(result[slot]).toContain('signature');
      expect(result[slot]).toContain('deformed hands');
      expect(result[slot]).toContain('religious symbols');
      expect(result[slot]).toContain('medical equipment');
    }
  });

  it('ZERO_NEGATIVE_PROMPT 定数が仕様 §10.1 + P5-29 拡張と一致する', () => {
    expect(ZERO_NEGATIVE_PROMPT).toContain('text');
    expect(ZERO_NEGATIVE_PROMPT).toContain('deformed hands');
    expect(ZERO_NEGATIVE_PROMPT).toContain('medical equipment');
    // P5-29: 人物の暴走生成防止
    expect(ZERO_NEGATIVE_PROMPT).toContain('human face');
    expect(ZERO_NEGATIVE_PROMPT).toContain('portrait');
  });
});

// ─── persona.image_style 反映 ────────────────────────────────────────────────

describe('buildZeroImagePrompts — persona.image_style 反映', () => {
  it('30 代主婦プリセットで pastel / warm beige / natural light / dreamy bokeh が出る', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: { image_style: { preset: '30s_homemaker' } },
    });
    expect(result.hero).toContain('soft pastel');
    expect(result.hero).toContain('warm beige');
    expect(result.hero).toContain('natural light');
    expect(result.hero).toContain('dreamy bokeh');
  });

  it('40 代キャリアプリセットで clean minimal / muted earth / modern interior が出る', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: { image_style: { preset: '40s_career' } },
    });
    expect(result.hero).toContain('clean minimal');
    expect(result.hero).toContain('muted earth tones');
    expect(result.hero).toContain('modern interior');
  });

  it('50 代以上プリセットで serene / deep amber / golden hour / mature elegance が出る', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: { image_style: { preset: '50s_plus' } },
    });
    expect(result.hero).toContain('serene');
    expect(result.hero).toContain('deep amber');
    expect(result.hero).toContain('golden hour');
    expect(result.hero).toContain('mature elegance');
  });

  it('age_range "30-39" から 30 代主婦スタイルへ自動マッピング', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: { image_style: { age_range: '30-39' } },
    });
    expect(result.hero).toContain('warm beige');
    expect(result.hero).toContain('dreamy bokeh');
  });

  it('age_range "50-59" から 50 代以上スタイルへ自動マッピング', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: { image_style: { age_range: '50-59' } },
    });
    expect(result.hero).toContain('deep amber');
    expect(result.hero).toContain('golden hour');
  });

  it('palette / mood / extra による個別カスタムが反映される', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      persona: {
        image_style: {
          palette: 'rose pink, ivory',
          mood: 'tender quiet morning',
          extra: ['linen texture'],
        },
      },
    });
    expect(result.hero).toContain('rose pink, ivory');
    expect(result.hero).toContain('tender quiet morning');
    expect(result.hero).toContain('linen texture');
  });
});

// ─── theme.visual_mood 反映 ──────────────────────────────────────────────────

describe('buildZeroImagePrompts — theme.visual_mood 反映', () => {
  it('palette / lighting / mood がすべて含まれる', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      theme: {
        name: 'グリーフケア',
        visual_mood: {
          palette: 'warm gold, soft lavender',
          lighting: 'morning haze',
          mood: 'introspective, hopeful',
        },
      },
    });
    expect(result.hero).toContain('warm gold, soft lavender');
    expect(result.hero).toContain('morning haze');
    expect(result.hero).toContain('introspective, hopeful');
  });

  it('theme.name からテーマ別モチーフ（butterfly / rainbow など）が引かれる', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      theme: { name: 'グリーフケア' },
    });
    expect(result.hero).toMatch(/butterfly|rainbow|soft flowers|peaceful meadow/);
  });

  it('theme.name "癒しと浄化" で crystal / clear water モチーフが出る', () => {
    const result = buildZeroImagePrompts({
      ...baseInput,
      theme: { name: '癒しと浄化' },
    });
    expect(result.hero).toMatch(/crystal|clear water|forest|morning dew/);
  });
});

// ─── outline image_prompts シード反映 ────────────────────────────────────────

describe('buildZeroImagePrompts — outline シード反映', () => {
  it('outline.image_prompts のシード文字列が各スロットに含まれる', () => {
    const result = buildZeroImagePrompts(baseInput);
    expect(result.hero).toContain('quiet evening room with soft lamplight');
    expect(result.body).toContain('hand gently holding a small ribbon');
    expect(result.summary).toContain('warm cup of tea by a window');
  });
});

// ─── fallback（persona / theme 不在） ────────────────────────────────────────

describe('buildZeroImagePrompts — fallback', () => {
  it('persona / theme が共に undefined でも 3 つ生成される', () => {
    const result = buildZeroImagePrompts({ outline: baseOutline });
    expect(result.hero).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.summary).toBeTruthy();
    expect(result.hero).toContain('soft pastel illustration');
    expect(result.hero).toContain('negative_prompt:');
  });

  it('persona が null でも fallback スタイルで生成される', () => {
    const result = buildZeroImagePrompts({
      outline: baseOutline,
      persona: null,
      theme: null,
    });
    expect(result.hero).toContain(ZERO_IMAGE_STYLE_PRESETS.fallback);
  });

  it('persona.image_style が空オブジェクトでも fallback で生成される', () => {
    const result = buildZeroImagePrompts({
      outline: baseOutline,
      persona: { image_style: {} },
    });
    expect(result.hero).toContain(ZERO_IMAGE_STYLE_PRESETS.fallback);
  });

  it('outline.image_prompts が空でも lead_summary から fallback context が組まれる', () => {
    const outlineNoImages: ZeroOutlineOutput = {
      ...baseOutline,
      image_prompts: [],
    };
    const result = buildZeroImagePrompts({
      outline: outlineNoImages,
      persona: { image_style: { preset: '40s_career' } },
      theme: { name: '自己成長' },
    });
    expect(result.hero).toBeTruthy();
    expect(result.hero).toContain('opening atmosphere');
    expect(result.body).toContain('symbolic moment');
    expect(result.summary).toContain('closing scene');
  });

  it('theme.name 未指定ならモチーフ部分は省略されるが他要素は揃う', () => {
    const result = buildZeroImagePrompts({
      outline: baseOutline,
      persona: { image_style: { preset: '30s_homemaker' } },
      theme: undefined,
    });
    // モチーフは無いが style / common / negative は揃う
    expect(result.hero).toContain('warm beige');
    expect(result.hero).toContain('soft pastel illustration');
    expect(result.hero).toContain('negative_prompt:');
  });
});

// ─── プリセット定数 ──────────────────────────────────────────────────────────

describe('ZERO_IMAGE_STYLE_PRESETS', () => {
  it('spec §10.1 の 3 プリセットが定義されている', () => {
    expect(ZERO_IMAGE_STYLE_PRESETS.homemaker_30s).toContain('warm beige');
    expect(ZERO_IMAGE_STYLE_PRESETS.career_40s).toContain('modern interior');
    expect(ZERO_IMAGE_STYLE_PRESETS.mature_50s_plus).toContain('golden hour');
    expect(ZERO_IMAGE_STYLE_PRESETS.fallback).toBeTruthy();
  });
});
