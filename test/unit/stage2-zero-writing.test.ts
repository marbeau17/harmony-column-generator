// ============================================================================
// test/unit/stage2-zero-writing.test.ts
// stage2-zero-writing プロンプトビルダーの単体テスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildZeroWritingPrompt,
  ZERO_WRITING_TEMPERATURE,
  type ZeroWritingInput,
  type ZeroWritingPersona,
  type RetrievedChunk,
} from '@/lib/ai/prompts/stage2-zero-writing';
import type { ZeroOutlineOutput } from '@/lib/ai/prompts/stage1-zero-outline';

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

const baseOutline: ZeroOutlineOutput = {
  lead_summary:
    'ペットを亡くした悲しみの中で、ふと心が軽くなる瞬間があります。そのちいさな兆しを、由起子さんと一緒にやさしく見つめていきましょう。',
  narrative_arc: {
    opening_hook: {
      type: 'empathy',
      text: '愛犬を見送った夜、深い静けさが部屋に残っていました',
    },
    awareness: '悲しみは「忘れる」ためのものではなく、共に生きていくためのもの',
    wavering: 'けれど、本当に立ち直るとは何だろう、と心がゆれる時間',
    acceptance: '癒えなくていい。共にあることを許してみる',
    action: '今日、ノートに一行だけ気持ちを書き留めてみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    {
      title: 'ペットロスの夜にそっと宿るもの',
      summary: '読者の悲しみに寄り添い、その感情に名前を与える',
      target_chars: 500,
      arc_phase: 'awareness',
    },
    {
      title: '立ち直り方を探すあなたへ',
      summary: '「立ち直る」という言葉そのものを問い直す',
      target_chars: 600,
      arc_phase: 'wavering',
    },
    {
      title: 'スピリチュアルな視点で受け止める',
      summary: '魂のつながりを日常の中で感じる視点を提示',
      target_chars: 500,
      arc_phase: 'acceptance',
    },
    {
      title: '今日からできるちいさな一歩',
      summary: '行動提案：ノート、写真、声に出すこと',
      target_chars: 400,
      arc_phase: 'action',
    },
  ],
  citation_highlights: [
    '悲しみは消すものではなく、共に歩いていくもの。だからこそ、急がなくていい',
    'ペットロスは愛していた証。その深さは、あなたの心の温かさの証でもあるのです',
    '魂は形を変えても、つながりは消えません。ふと感じるあのぬくもりを大切に',
  ],
  faq_items: [
    {
      q: 'ペットロスはどれくらいの期間続きますか？',
      a: '人それぞれです。半年で和らぐ方もいれば、数年かけてゆっくり受け止めていく方もいます。比べる必要はありません。',
    },
    {
      q: 'スピリチュアルな視点で見るペットロスとは？',
      a: '魂は形を変えても、つながりは続いていくもの。日常のふとした瞬間に感じる温かさが、その証なのかもしれません。',
    },
  ],
  image_prompts: [
    { slot: 'hero', prompt: '柔らかな朝の光と犬のシルエット' },
    { slot: 'body', prompt: '窓辺に置かれた小さな写真立て' },
    { slot: 'summary', prompt: '夕焼けの空と一輪の花' },
  ],
};

const basePersona: ZeroWritingPersona = {
  id: 'persona-mature-woman',
  name: '40代の女性・愛犬を亡くしたばかり',
  age_range: '40-49',
  tone_guide: 'やさしく寄り添う',
};

const baseTheme = {
  id: 'theme-pet-loss',
  name: 'ペットロスと向き合う',
  category: 'grief',
};

const baseChunks: RetrievedChunk[] = [
  {
    text: 'ふと夜、ひとりで空を見上げる時間がありますね。けれど、その静けさの中にこそ、心の声がそっと届いてくることがあります。',
    similarity: 0.892,
  },
  {
    text: 'たとえば、朝の光がカーテンを通り抜けて部屋に届くとき。それは、目に見えないけれど確かにある温かさのように、わたしたちを包んでくれるんです。',
    similarity: 0.845,
  },
];

const baseInput: ZeroWritingInput = {
  outline: baseOutline,
  persona: basePersona,
  theme: baseTheme,
  retrievedChunks: baseChunks,
};

// ─── 基本構造 ─────────────────────────────────────────────────────────────────

describe('buildZeroWritingPrompt - 基本構造', () => {
  it('system / user の両方を文字列で返す', () => {
    const result = buildZeroWritingPrompt(baseInput);
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.system.length).toBeGreaterThan(500);
    expect(result.user.length).toBeGreaterThan(200);
  });

  it('ZERO_WRITING_TEMPERATURE は 0.7', () => {
    expect(ZERO_WRITING_TEMPERATURE).toBe(0.7);
  });
});

// ─── FB 14 項目の踏襲 ────────────────────────────────────────────────────────

describe('FB 14 項目の踏襲', () => {
  it('system に 14 箇条がすべて埋め込まれている', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('14 箇条');
    // 14 項目を網羅的に確認（番号 1.〜14. が含まれていること）
    for (let i = 1; i <= 14; i++) {
      expect(system).toContain(`${i}.`);
    }
  });

  it('FB 14 各項目の代表キーワードがすべて含まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    // 1. 1テーマ1視点
    expect(system).toContain('1テーマ1視点');
    // 2. ダブルポスト
    expect(system).toContain('ダブルポスト');
    // 3. ダブルクォーテーション禁止
    expect(system).toContain('ダブルクォーテーション');
    // 4. 抽象表現の単独使用禁止
    expect(system).toContain('抽象表現の単独使用');
    // 5. 深い納得
    expect(system).toContain('深い納得');
    // 6. やさしい語尾
    expect(system).toContain('語尾はやさしく');
    // 7. 比喩
    expect(system).toContain('比喩');
    // 8. オリジナリティ
    expect(system).toContain('オリジナリティ');
    // 9. 一文 25〜35
    expect(system).toContain('25〜35');
    // 10. 二人称あなた
    expect(system).toContain('二人称は「あなた」');
    // 11. してみてください
    expect(system).toContain('〜してみてください');
    // 12. 結びは希望と祈り
    expect(system).toContain('希望と祈り');
    // 13. 医療断定禁止
    expect(system).toContain('医療断定');
    // 14. ナラティブ・アーク
    expect(system).toContain('ナラティブ・アーク');
  });
});

// ─── retrievedChunks の文体 DNA 注入指示 ────────────────────────────────────

describe('retrievedChunks の文体 DNA 注入指示', () => {
  it('system に retrievedChunks の本文が埋め込まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('ふと夜、ひとりで空を見上げる時間がありますね');
    expect(system).toContain('朝の光がカーテンを通り抜けて部屋に届くとき');
  });

  it('system に類似度（小数 3 桁）が表示される', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('0.892');
    expect(system).toContain('0.845');
  });

  it('system に「文体 DNA」grounding 指示が含まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('文体 DNA');
    expect(system).toContain('grounding');
    // 事実引用ではなく文体骨格のみ吸収する指示
    expect(system).toContain('文体の骨格');
    expect(system).toContain('引用しない');
  });

  it('chunk が複数あるとき「サンプル1」「サンプル2」と番号付けされる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('サンプル1');
    expect(system).toContain('サンプル2');
  });
});

// ─── retrievedChunks 空時の fallback ────────────────────────────────────────

describe('retrievedChunks 空時の fallback', () => {
  it('retrievedChunks が空配列の場合、ソース無し fallback 指示が入る', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      retrievedChunks: [],
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).toContain('fallback');
    expect(system).toContain('ソース無し');
    expect(system).toContain('創造的');
  });

  it('retrievedChunks が空のとき chunk 由来の本文は埋め込まれない', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      retrievedChunks: [],
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).not.toContain('ふと夜、ひとりで空を見上げる時間がありますね');
    expect(system).not.toContain('サンプル1');
  });

  it('retrievedChunks が空でも 14 箇条と文体 DNA は維持される', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      retrievedChunks: [],
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).toContain('14 箇条');
    expect(system).toContain('ナラティブ・アーク');
    expect(system).toContain('〜ですね');
  });
});

// ─── persona の preferred_words / avoided_words 反映 ─────────────────────────

describe('persona の preferred_words / avoided_words 反映', () => {
  it('preferred_words が指定されると system に列挙される', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      persona: {
        ...basePersona,
        preferred_words: ['寄り添う', 'ぬくもり', 'やさしさ'],
      },
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).toContain('寄り添う');
    expect(system).toContain('ぬくもり');
    expect(system).toContain('やさしさ');
    expect(system).toContain('積極的に使う語彙');
  });

  it('avoided_words が指定されると system に列挙される', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      persona: {
        ...basePersona,
        avoided_words: ['頑張れ', '時間が解決'],
      },
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).toContain('頑張れ');
    expect(system).toContain('時間が解決');
    expect(system).toContain('避ける語彙');
  });

  it('preferred_words / avoided_words が未指定の場合は無視される（破綻しない）', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      persona: {
        id: 'p1',
        name: 'シンプルペルソナ',
      },
    };
    const result = buildZeroWritingPrompt(input);
    expect(typeof result.system).toBe('string');
    expect(result.system).not.toContain('積極的に使う語彙');
    expect(result.system).not.toContain('避ける語彙');
  });

  it('preferred_words が空配列の場合も無視される', () => {
    const input: ZeroWritingInput = {
      ...baseInput,
      persona: {
        ...basePersona,
        preferred_words: [],
        avoided_words: [],
      },
    };
    const { system } = buildZeroWritingPrompt(input);
    expect(system).not.toContain('積極的に使う語彙');
    expect(system).not.toContain('避ける語彙');
  });
});

// ─── JSON outline の各章を順次展開する指示 ─────────────────────────────────

describe('JSON outline の各章を順次展開する指示', () => {
  it('user に「順次展開」指示が含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('順次展開');
    expect(user).toContain('h2_chapters');
  });

  it('user に各 H2 章の title / target_chars / arc_phase が含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('ペットロスの夜にそっと宿るもの');
    expect(user).toContain('立ち直り方を探すあなたへ');
    expect(user).toContain('スピリチュアルな視点で受け止める');
    expect(user).toContain('今日からできるちいさな一歩');
    // arc_phase
    expect(user).toContain('awareness');
    expect(user).toContain('wavering');
    expect(user).toContain('acceptance');
    expect(user).toContain('action');
    // target_chars
    expect(user).toContain('500');
    expect(user).toContain('600');
    expect(user).toContain('400');
  });

  it('user に narrative_arc の各段階が含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('愛犬を見送った夜、深い静けさが部屋に残っていました');
    expect(user).toContain('opening_hook');
    expect(user).toContain('closing_style');
    expect(user).toContain('lingering');
  });

  it('user に citation_highlights（核心フレーズ）がすべて含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    for (const c of baseOutline.citation_highlights) {
      expect(user).toContain(c);
    }
  });

  it('user に FAQ がすべて含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('ペットロスはどれくらいの期間続きますか？');
    expect(user).toContain('スピリチュアルな視点で見るペットロスとは？');
  });

  it('user に画像プレースホルダー（body / summary）が含まれ、hero は除外される', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('<!--IMAGE:body:body.webp-->');
    expect(user).toContain('<!--IMAGE:summary:summary.webp-->');
    expect(user).not.toContain('<!--IMAGE:hero:');
  });

  it('user にテーマ情報が含まれる', () => {
    const { user } = buildZeroWritingPrompt(baseInput);
    expect(user).toContain('ペットロスと向き合う');
    expect(user).toContain('theme-pet-loss');
  });
});

// ─── data-claim-idx 属性付与の指示 ─────────────────────────────────────────

describe('data-claim-idx 属性付与の指示', () => {
  it('system / user のいずれかに data-claim-idx 属性付与の指示が含まれる', () => {
    const { system, user } = buildZeroWritingPrompt(baseInput);
    const combined = system + user;
    expect(combined).toContain('data-claim-idx');
  });

  it('system に「すべての文に span data-claim-idx」を付与する指示が含まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('data-claim-idx');
    expect(system).toContain('span');
    // 連番である指示
    expect(system).toContain('連番');
  });
});

// ─── 出力形式 ─────────────────────────────────────────────────────────────────

describe('出力形式の指示', () => {
  it('HTML 出力指示と CTA URL が含まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('HTML');
    expect(system).toContain('https://harmony-booking.web.app/');
    expect(system).toContain('harmony-cta');
    expect(system).toContain('harmony-faq');
  });

  it('禁止タグ（DOCTYPE / html / body / script）の明記がある', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('DOCTYPE');
    expect(system).toContain('script');
  });

  it('ハイライトマーカー（marker-yellow / marker-pink）の指示が含まれる', () => {
    const { system } = buildZeroWritingPrompt(baseInput);
    expect(system).toContain('marker-yellow');
    expect(system).toContain('marker-pink');
  });
});
