// ============================================================================
// src/lib/seo/score-calculator.ts
// SEO / AIO スコア自動算出
// ============================================================================

import type { Article } from '@/types/article';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface SeoBreakdown {
  title: number;        // メタタイトル最適化 (15点)
  meta: number;         // メタディスクリプション最適化 (15点)
  headings: number;     // 見出し構造 (15点)
  keywords: number;     // キーワード最適化 (15点)
  content: number;      // コンテンツ品質 (15点)
  links: number;        // リンク構造 (10点)
  structured_data: number; // 構造化データ (10点)
  technical: number;    // 技術的SEO (5点)
}

export interface SeoScore {
  total: number;
  breakdown: SeoBreakdown;
}

export interface AioBreakdown {
  answer_block: number;     // 回答ブロック最適化 (25点)
  structured_answer: number; // 構造化回答 (25点)
  faq_quality: number;      // FAQ品質 (20点)
  eeat_signals: number;     // E-E-A-Tシグナル (15点)
  clarity: number;          // 明瞭性 (15点)
}

export interface AioScore {
  total: number;
  breakdown: AioBreakdown;
}

export interface Improvement {
  priority: 'high' | 'medium' | 'low';
  category: string;
  issue: string;
  suggestion: string;
}

// ─── SEO スコア算出 ─────────────────────────────────────────────────────────

/**
 * SEO スコアを100点満点で算出する。
 */
export function calculateSeoScore(article: Article): SeoScore {
  const html = article.stage3_final_html ?? article.stage2_body_html ?? '';
  const keyword = article.keyword ?? '';

  const breakdown: SeoBreakdown = {
    title: scoreSeoTitle(article, keyword),
    meta: scoreSeoMeta(article, keyword),
    headings: scoreSeoHeadings(html, keyword),
    keywords: scoreSeoKeywords(html, keyword),
    content: scoreSeoContent(html, article),
    links: scoreSeoLinks(html),
    structured_data: scoreSeoStructuredData(article),
    technical: scoreSeoTechnical(article),
  };

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return { total: Math.min(100, total), breakdown };
}

// ─── SEO 個別スコア ─────────────────────────────────────────────────────────

function scoreSeoTitle(article: Article, keyword: string): number {
  let score = 0;
  const title = article.title ?? '';

  if (title.length > 0) score += 3;
  if (title.length >= 25 && title.length <= 40) score += 4;
  else if (title.length > 0) score += 2;
  if (keyword && title.includes(keyword)) score += 5;
  // キーワードが前方（先頭15文字以内）にあるか
  if (keyword && title.indexOf(keyword) >= 0 && title.indexOf(keyword) < 15) {
    score += 3;
  }

  return Math.min(15, score);
}

function scoreSeoMeta(article: Article, keyword: string): number {
  let score = 0;
  const desc = article.meta_description ?? '';

  if (desc.length > 0) score += 3;
  if (desc.length >= 80 && desc.length <= 120) score += 5;
  else if (desc.length >= 50 && desc.length <= 160) score += 3;
  if (keyword && desc.includes(keyword)) score += 5;
  // 行動喚起の言葉が含まれるか
  if (/解説|紹介|方法|ガイド|お伝え/.test(desc)) score += 2;

  return Math.min(15, score);
}

function scoreSeoHeadings(html: string, keyword: string): number {
  let score = 0;

  const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) ?? [];
  const h3Matches = html.match(/<h3[^>]*>(.*?)<\/h3>/gi) ?? [];

  // H2 が存在する
  if (h2Matches.length > 0) score += 4;
  // H2 が 3-7 個（適切な数）
  if (h2Matches.length >= 3 && h2Matches.length <= 7) score += 3;
  // H3 が存在する（階層構造）
  if (h3Matches.length > 0) score += 3;
  // 見出しにキーワードが含まれる
  const allHeadings = [...h2Matches, ...h3Matches].join('');
  const headingText = allHeadings.replace(/<[^>]*>/g, '');
  if (keyword && headingText.includes(keyword)) score += 3;
  // H2 の中にキーワードが含まれる見出しが複数ある
  const keywordH2 = h2Matches.filter((h) =>
    h.replace(/<[^>]*>/g, '').includes(keyword),
  );
  if (keywordH2.length >= 2) score += 2;

  return Math.min(15, score);
}

function scoreSeoKeywords(html: string, keyword: string): number {
  if (!keyword || !html) return 0;

  let score = 0;
  const text = html.replace(/<[^>]*>/g, '');
  const textLength = text.length;

  if (textLength === 0) return 0;

  // キーワード出現回数
  const keywordCount = (text.match(new RegExp(keyword, 'g')) ?? []).length;
  // キーワード密度 (0.5% - 2.5% が理想)
  const density = (keywordCount * keyword.length) / textLength;

  if (keywordCount > 0) score += 3;
  if (density >= 0.005 && density <= 0.025) score += 5;
  else if (density > 0 && density < 0.005) score += 2;
  else if (density > 0.025 && density <= 0.04) score += 2;

  // 最初の 200 文字以内にキーワードがあるか
  if (text.slice(0, 200).includes(keyword)) score += 4;

  // 最後の段落にもキーワードがあるか
  const lastParagraph = text.slice(-300);
  if (lastParagraph.includes(keyword)) score += 3;

  return Math.min(15, score);
}

function scoreSeoContent(html: string, article: Article): number {
  let score = 0;
  const text = html.replace(/<[^>]*>/g, '');
  const charCount = text.length;

  // 文字数チェック (3000文字以上が理想)
  if (charCount >= 3000) score += 5;
  else if (charCount >= 2000) score += 3;
  else if (charCount >= 1000) score += 1;

  // 段落構成
  const paragraphs = html.match(/<p[^>]*>/gi) ?? [];
  if (paragraphs.length >= 5) score += 3;
  else if (paragraphs.length >= 3) score += 2;

  // リスト要素の使用
  if (/<[uo]l[^>]*>/i.test(html)) score += 2;

  // テーブルの使用
  if (/<table[^>]*>/i.test(html)) score += 1;

  // 画像の存在
  if (/<img[^>]*>/i.test(html)) score += 2;

  // 強調テキスト
  if (/<strong[^>]*>/i.test(html) || /<em[^>]*>/i.test(html)) score += 2;

  return Math.min(15, score);
}

function scoreSeoLinks(html: string): number {
  let score = 0;

  const links = html.match(/<a[^>]*href="[^"]*"[^>]*>/gi) ?? [];
  const internalLinks = links.filter(
    (l) => l.includes('harmony-mc.com') || l.startsWith('/'),
  );
  const externalLinks = links.filter(
    (l) => !l.includes('harmony-mc.com') && /https?:\/\//.test(l),
  );

  // 内部リンクの存在
  if (internalLinks.length > 0) score += 4;
  if (internalLinks.length >= 3) score += 2;

  // 外部リンクは任意（参考リンク）
  if (externalLinks.length > 0) score += 2;

  // 関連記事リンク
  const article_related = html.match(/関連|おすすめ|こちらも/g) ?? [];
  if (article_related.length > 0) score += 2;

  return Math.min(10, score);
}

function scoreSeoStructuredData(article: Article): number {
  let score = 0;

  // 構造化データが存在する
  if (article.structured_data) score += 5;

  // FAQ データが存在する
  if (article.faq_data) {
    const faqs = parseFaqArray(article.faq_data);
    if (faqs.length > 0) score += 3;
    if (faqs.length >= 3) score += 2;
  }

  return Math.min(10, score);
}

function scoreSeoTechnical(article: Article): number {
  let score = 0;

  // スラッグが設定されている
  if (article.slug) score += 2;
  // スラッグが60文字以内
  if (article.slug && article.slug.length <= 60) score += 1;
  // 公開 URL がある
  if (article.published_url) score += 1;
  // 公開日がある
  if (article.published_at) score += 1;

  return Math.min(5, score);
}

// ─── AIO スコア算出 ─────────────────────────────────────────────────────────

/**
 * AIO (AI Overview) スコアを 100 点満点で算出する。
 * Google AI Overview に選ばれやすいコンテンツかを評価。
 */
export function calculateAioScore(article: Article): AioScore {
  const html = article.stage3_final_html ?? article.stage2_body_html ?? '';
  const keyword = article.keyword ?? '';

  const breakdown: AioBreakdown = {
    answer_block: scoreAioAnswerBlock(html, keyword),
    structured_answer: scoreAioStructuredAnswer(html),
    faq_quality: scoreAioFaqQuality(article),
    eeat_signals: scoreAioEeatSignals(article, html),
    clarity: scoreAioClarity(html),
  };

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return { total: Math.min(100, total), breakdown };
}

// ─── AIO 個別スコア ─────────────────────────────────────────────────────────

function scoreAioAnswerBlock(html: string, keyword: string): number {
  let score = 0;
  const text = html.replace(/<[^>]*>/g, '');

  // 冒頭 300 文字以内にキーワードに対する直接的な回答があるか
  const intro = text.slice(0, 300);
  if (keyword && intro.includes(keyword)) score += 5;

  // 「とは」「です」「ます」で始まる簡潔な定義文
  if (/とは.{10,80}(です|ます)/.test(intro)) score += 8;

  // 最初のパラグラフが 50-150 文字（AI が引用しやすい長さ）
  const firstP = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (firstP) {
    const firstPText = firstP[1].replace(/<[^>]*>/g, '');
    if (firstPText.length >= 50 && firstPText.length <= 150) score += 7;
    else if (firstPText.length >= 30 && firstPText.length <= 200) score += 4;
  }

  // 明確な結論を含む
  if (/まとめ|結論|ポイント/.test(text)) score += 5;

  return Math.min(25, score);
}

function scoreAioStructuredAnswer(html: string): number {
  let score = 0;

  // 番号付きリスト（ステップバイステップ）
  if (/<ol[^>]*>/i.test(html)) score += 6;

  // 箇条書きリスト
  if (/<ul[^>]*>/i.test(html)) score += 5;

  // テーブル（比較表など）
  if (/<table[^>]*>/i.test(html)) score += 5;

  // H2/H3 が疑問形（「〜とは？」「〜の方法」）
  const headings = html.match(/<h[23][^>]*>(.*?)<\/h[23]>/gi) ?? [];
  const questionHeadings = headings.filter((h) => {
    const text = h.replace(/<[^>]*>/g, '');
    return /とは|方法|やり方|ポイント|特徴|違い|メリット|\?|？/.test(text);
  });
  if (questionHeadings.length >= 2) score += 6;
  else if (questionHeadings.length >= 1) score += 3;

  // 段落ごとに簡潔（300文字以内）
  const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gi) ?? [];
  const conciseParagraphs = paragraphs.filter((p) => {
    const text = p.replace(/<[^>]*>/g, '');
    return text.length > 0 && text.length <= 300;
  });
  if (paragraphs.length > 0 && conciseParagraphs.length / paragraphs.length >= 0.7) {
    score += 3;
  }

  return Math.min(25, score);
}

function scoreAioFaqQuality(article: Article): number {
  let score = 0;

  const faqs = parseFaqArray(article.faq_data);

  // FAQ が存在する
  if (faqs.length === 0) return 0;

  score += 5;

  // FAQ が 3 件以上
  if (faqs.length >= 3) score += 5;

  // 各 FAQ の回答が適切な長さ (50-200文字)
  const goodLength = faqs.filter((f) => {
    const ansLen = f.answer?.length ?? 0;
    return ansLen >= 50 && ansLen <= 200;
  });
  if (goodLength.length === faqs.length) score += 5;
  else if (goodLength.length >= faqs.length * 0.5) score += 3;

  // FAQ の質問が疑問形
  const questionForm = faqs.filter((f) =>
    /\?|？|でしょうか|ですか|ますか/.test(f.question ?? ''),
  );
  if (questionForm.length === faqs.length) score += 5;
  else if (questionForm.length >= 1) score += 2;

  return Math.min(20, score);
}

function scoreAioEeatSignals(article: Article, html: string): number {
  let score = 0;
  const text = html.replace(/<[^>]*>/g, '');

  // 著者情報が存在（Person スキーマ / 著者名言及）
  if (text.includes('小林由起子') || text.includes('カウンセラー')) score += 4;

  // 経験に基づく記述（「私の経験では」「カウンセリングの現場で」等）
  if (/経験|実践|カウンセリング|セッション|クライアント/.test(text)) score += 4;

  // 専門用語の適切な使用と説明
  if (/とは.{5,50}(こと|もの|状態)/.test(text)) score += 3;

  // 構造化データに著者情報が含まれる
  if (article.structured_data) score += 2;

  // 免責事項 / 注意書き
  if (/注意|免責|個人差|あくまで/.test(text)) score += 2;

  return Math.min(15, score);
}

function scoreAioClarity(html: string): number {
  let score = 0;
  const text = html.replace(/<[^>]*>/g, '');

  // 平均文長チェック（40-80文字が読みやすい）
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
  if (sentences.length > 0) {
    const avgLen =
      sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
    if (avgLen >= 30 && avgLen <= 80) score += 5;
    else if (avgLen >= 20 && avgLen <= 100) score += 3;
  }

  // 接続詞の適切な使用
  if (/しかし|また|さらに|そのため|つまり|例えば/.test(text)) score += 3;

  // 読みやすさ: 漢字比率チェック (20-35% が理想)
  const kanjiCount = (text.match(/[\u4e00-\u9faf]/g) ?? []).length;
  if (text.length > 0) {
    const kanjiRatio = kanjiCount / text.length;
    if (kanjiRatio >= 0.2 && kanjiRatio <= 0.35) score += 4;
    else if (kanjiRatio >= 0.15 && kanjiRatio <= 0.4) score += 2;
  }

  // 強調・ハイライトの適切な使用
  const strongCount = (html.match(/<strong/gi) ?? []).length;
  if (strongCount >= 2 && strongCount <= 10) score += 3;

  return Math.min(15, score);
}

// ─── 改善提案生成 ───────────────────────────────────────────────────────────

/**
 * SEO / AIO スコアに基づいて改善提案を生成する。
 */
export function generateImprovements(scores: {
  seo: SeoScore;
  aio: AioScore;
}): Improvement[] {
  const improvements: Improvement[] = [];
  const { seo, aio } = scores;

  // --- SEO 改善提案 ---

  if (seo.breakdown.title < 10) {
    improvements.push({
      priority: seo.breakdown.title < 5 ? 'high' : 'medium',
      category: 'SEO: タイトル',
      issue: 'メタタイトルが最適化されていません',
      suggestion:
        'キーワードをタイトルの前方に配置し、28-35文字に収めてください。',
    });
  }

  if (seo.breakdown.meta < 10) {
    improvements.push({
      priority: seo.breakdown.meta < 5 ? 'high' : 'medium',
      category: 'SEO: メタディスクリプション',
      issue: 'メタディスクリプションが最適化されていません',
      suggestion:
        'キーワードを含む80-120文字の説明文を設定してください。行動喚起の言葉も効果的です。',
    });
  }

  if (seo.breakdown.headings < 10) {
    improvements.push({
      priority: seo.breakdown.headings < 5 ? 'high' : 'medium',
      category: 'SEO: 見出し構造',
      issue: '見出し構造が不十分です',
      suggestion:
        'H2を3-7個配置し、H3で階層化してください。見出しにキーワードを含めると効果的です。',
    });
  }

  if (seo.breakdown.keywords < 10) {
    improvements.push({
      priority: 'medium',
      category: 'SEO: キーワード',
      issue: 'キーワード配置が最適化されていません',
      suggestion:
        'キーワード密度を0.5-2.5%に調整し、冒頭と末尾にもキーワードを配置してください。',
    });
  }

  if (seo.breakdown.content < 10) {
    improvements.push({
      priority: seo.breakdown.content < 5 ? 'high' : 'medium',
      category: 'SEO: コンテンツ品質',
      issue: 'コンテンツの構造や分量が不十分です',
      suggestion:
        '3000文字以上を目標にし、リスト・テーブル・画像・強調テキストを活用してください。',
    });
  }

  if (seo.breakdown.links < 5) {
    improvements.push({
      priority: 'low',
      category: 'SEO: リンク',
      issue: '内部リンクが不足しています',
      suggestion:
        '関連するコラム記事への内部リンクを3件以上配置してください。',
    });
  }

  if (seo.breakdown.structured_data < 5) {
    improvements.push({
      priority: 'high',
      category: 'SEO: 構造化データ',
      issue: '構造化データが不足しています',
      suggestion:
        'Article、FAQPage、BreadcrumbList のJSON-LDを設定してください。',
    });
  }

  // --- AIO 改善提案 ---

  if (aio.breakdown.answer_block < 15) {
    improvements.push({
      priority: 'high',
      category: 'AIO: 回答ブロック',
      issue: '冒頭の回答ブロックが最適化されていません',
      suggestion:
        '記事冒頭に「〜とは〜です」形式の簡潔な定義文（50-150文字）を配置してください。',
    });
  }

  if (aio.breakdown.structured_answer < 15) {
    improvements.push({
      priority: 'medium',
      category: 'AIO: 構造化回答',
      issue: '構造化された回答形式が不足しています',
      suggestion:
        '番号付きリスト、箇条書き、比較テーブルを活用してください。見出しを疑問形にするとAI Overviewに選ばれやすくなります。',
    });
  }

  if (aio.breakdown.faq_quality < 10) {
    improvements.push({
      priority: 'medium',
      category: 'AIO: FAQ',
      issue: 'FAQの品質が不十分です',
      suggestion:
        '3件以上のFAQを設定し、各回答を50-200文字で簡潔にまとめてください。',
    });
  }

  if (aio.breakdown.eeat_signals < 8) {
    improvements.push({
      priority: 'medium',
      category: 'AIO: E-E-A-T',
      issue: 'E-E-A-Tシグナルが弱いです',
      suggestion:
        '著者名、経験に基づく記述、専門用語の説明、免責事項を含めてください。',
    });
  }

  if (aio.breakdown.clarity < 8) {
    improvements.push({
      priority: 'low',
      category: 'AIO: 明瞭性',
      issue: '文章の読みやすさに改善の余地があります',
      suggestion:
        '平均文長40-80文字を目指し、接続詞を適切に使い、漢字比率20-35%に調整してください。',
    });
  }

  // 優先度順にソート
  const priorityOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  improvements.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return improvements;
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

function parseFaqArray(
  faqData: unknown,
): { question: string; answer: string }[] {
  if (!faqData) return [];

  let items: unknown[];

  if (typeof faqData === 'string') {
    try {
      items = JSON.parse(faqData);
    } catch {
      return [];
    }
  } else if (Array.isArray(faqData)) {
    items = faqData;
  } else {
    return [];
  }

  if (!Array.isArray(items)) return [];

  return items.filter(
    (item): item is { question: string; answer: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).question === 'string' &&
      typeof (item as Record<string, unknown>).answer === 'string',
  );
}
