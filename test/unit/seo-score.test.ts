import { describe, it, expect } from 'vitest';
import {
  calculateSeoScore,
  calculateAioScore,
  generateImprovements,
} from '@/lib/seo/score-calculator';
import type { Article } from '@/types/article';

/** テスト用のArticleオブジェクトを生成するヘルパー */
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-id',
    status: 'body_review',
    title: null,
    slug: null,
    content: null,
    meta_description: null,
    keyword: '',
    theme: 'healing',
    persona: 'spiritual_beginner',
    source_article_id: null,
    perspective_type: null,
    target_word_count: 2000,
    stage1_outline: null,
    stage2_body_html: null,
    stage3_final_html: null,
    published_html: null,
    image_prompts: null,
    image_files: null,
    cta_texts: null,
    faq_data: null,
    structured_data: null,
    seo_score: null,
    related_articles: null,
    published_url: null,
    published_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('calculateSeoScore', () => {
  it('タイトル・メタ・本文ありの記事で50点以上', () => {
    const article = makeArticle({
      title: '瞑想の効果と正しいやり方を徹底解説',
      keyword: '瞑想',
      meta_description:
        '瞑想の効果や正しいやり方を初心者にもわかりやすく解説します。日常に瞑想を取り入れて心身のバランスを整える方法をご紹介。',
      slug: 'meditation-guide',
      stage3_final_html: `
        <p>瞑想とは、心を静めて内面に集中する実践方法です。瞑想は古くから行われてきました。</p>
        <h2>瞑想の基本的な効果</h2>
        <p>瞑想にはストレス軽減、集中力向上、感情の安定など多くの効果があります。また瞑想を続けることで自己理解が深まります。</p>
        <h2>瞑想の正しいやり方</h2>
        <p>まずは静かな場所を見つけましょう。しかし特別な場所は必要ありません。さらに姿勢を整え、呼吸に意識を向けます。</p>
        <ul><li>静かな場所を選ぶ</li><li>楽な姿勢で座る</li><li>呼吸に集中する</li></ul>
        <h2>瞑想を日常に取り入れるコツ</h2>
        <p>毎朝5分から始めてみましょう。つまり無理のない範囲で継続することが大切です。例えば朝起きてすぐの時間がおすすめです。</p>
        <h3>初心者向けの瞑想ガイド</h3>
        <p>初めての方は<strong>ガイド付き瞑想</strong>がおすすめです。また<em>呼吸法</em>を組み合わせると効果的です。</p>
        <h2>まとめ</h2>
        <p>瞑想は誰でも簡単に始められる心のケア方法です。瞑想を日常に取り入れて、より豊かな毎日を過ごしましょう。</p>
      `,
    });

    const score = calculateSeoScore(article);
    expect(score.total).toBeGreaterThanOrEqual(50);
  });
});

describe('calculateAioScore', () => {
  it('FAQ付き記事で50点以上', () => {
    const article = makeArticle({
      title: '瞑想とは？初心者向けの効果と方法ガイド',
      keyword: '瞑想',
      meta_description: '瞑想とは心を静める実践です。効果ややり方を解説します。',
      slug: 'meditation-intro',
      faq_data: [
        {
          question: '瞑想は初心者でもできますか？',
          answer:
            'はい、瞑想は初心者でも簡単に始められます。まずは1日5分の呼吸瞑想から始めることをおすすめします。特別な道具や場所は必要ありません。',
        },
        {
          question: '瞑想の効果はどれくらいで実感できますか？',
          answer:
            '個人差はありますが、多くの方が2週間ほど継続することでストレス軽減や集中力向上を実感されています。継続がポイントです。',
        },
        {
          question: '瞑想中に雑念が浮かんだらどうすればいいですか？',
          answer:
            '雑念は自然なことです。気づいたら優しく呼吸に意識を戻しましょう。雑念を否定せず、あるがままに受け入れることが大切です。',
        },
      ],
      structured_data: { '@type': 'Article' },
      stage3_final_html: `
        <p>瞑想とは、心を静めて内面と向き合う古くからの実践方法です。</p>
        <h2>瞑想とは？基本を理解しよう</h2>
        <p>瞑想は心身のバランスを整えるための方法です。しかし難しく考える必要はありません。</p>
        <ol><li>静かな場所を選ぶ</li><li>楽な姿勢をとる</li><li>呼吸に集中する</li></ol>
        <h2>瞑想の効果とメリット</h2>
        <ul><li>ストレス軽減</li><li>集中力向上</li><li>感情の安定</li></ul>
        <p>カウンセリングの経験からも、瞑想を実践される方は心の安定を得やすいと感じています。</p>
        <h2>まとめ</h2>
        <p>瞑想は誰でも始められます。まずは5分から試してみましょう。</p>
      `,
    });

    const score = calculateAioScore(article);
    expect(score.total).toBeGreaterThanOrEqual(50);
  });
});

describe('generateImprovements', () => {
  it('低スコア記事で改善提案が返る', () => {
    const article = makeArticle({
      keyword: '瞑想',
      stage3_final_html: '<p>短い本文</p>',
    });

    const seo = calculateSeoScore(article);
    const aio = calculateAioScore(article);
    const improvements = generateImprovements({ seo, aio });

    expect(Array.isArray(improvements)).toBe(true);
    expect(improvements.length).toBeGreaterThan(0);
    // 各改善提案にpriority, category, issue, suggestionが含まれる
    for (const item of improvements) {
      expect(item).toHaveProperty('priority');
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('issue');
      expect(item).toHaveProperty('suggestion');
    }
  });
});
