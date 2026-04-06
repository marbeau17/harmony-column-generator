// ============================================================================
// src/lib/generators/related-articles.ts
// 関連記事選定エンジン — TF-IDFベースのコサイン類似度
//
// TF-IDF ベースのコサイン類似度で上位3件を選定。
// bigram トークナイザーで日本語テキストを分割。
// ============================================================================

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface RelatedArticle {
  href: string;
  title: string;
  score: number;
}

export interface ArticleCard {
  href: string;
  title: string;
}

// ─── トークナイザー ─────────────────────────────────────────────────────────

/**
 * 日本語テキストを bigram に分割。
 */
export function tokenize(text: string): string[] {
  // 前処理: 半角スペースや記号を除去、小文字化
  const normalized = text
    .replace(/[\s\u3000]+/g, '')         // 空白除去
    .replace(/[!-/:-@[-`{-~]/g, '')      // ASCII記号除去
    .replace(/[！-／：-＠［-｀｛-～]/g, '') // 全角記号除去
    .toLowerCase();

  // Bigram 生成
  const tokens: string[] = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    tokens.push(normalized.slice(i, i + 2));
  }
  return tokens;
}

// ─── TF-IDF 計算 ────────────────────────────────────────────────────────────

type TermFreqMap = Map<string, number>;

export function computeTF(tokens: string[]): TermFreqMap {
  const tf: TermFreqMap = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // 正規化
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) {
    tf.set(k, v / max);
  }
  return tf;
}

export function computeIDF(documents: string[][]): Map<string, number> {
  const N = documents.length;
  const df: Map<string, number> = new Map();

  for (const doc of documents) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const idf: Map<string, number> = new Map();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1); // smoothed IDF
  }
  return idf;
}

function computeTFIDF(
  tf: TermFreqMap,
  idf: Map<string, number>,
): Map<string, number> {
  const tfidf: Map<string, number> = new Map();
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) || 1;
    tfidf.set(term, tfVal * idfVal);
  }
  return tfidf;
}

// ─── コサイン類似度 ─────────────────────────────────────────────────────────

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of a) {
    const valB = b.get(term) || 0;
    dot += valA * valB;
    normA += valA * valA;
  }
  for (const [, valB] of b) {
    normB += valB * valB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── スピリチュアル用語ボーナス ─────────────────────────────────────────────

const SPIRITUAL_TERMS = [
  'ツインレイ',
  'チャクラ',
  '前世',
  'カルマ',
  'オーラ',
  '瞑想',
  '浄化',
  'グリーフケア',
  'ヒーリング',
  'アセンション',
  'ソウルメイト',
  'ハイヤーセルフ',
  'スピリチュアル',
  'エネルギー',
  'パワーストーン',
  'タロット',
  'リーディング',
  'インナーチャイルド',
  'レイキ',
  'マインドフルネス',
  'クンダリーニ',
  '守護霊',
  '波動',
  'サイキック',
  '光の使者',
];

function spiritualTermBonus(keyword: string, title: string): number {
  const kw = keyword.toLowerCase();
  const t = title.toLowerCase();
  for (const term of SPIRITUAL_TERMS) {
    const m = term.toLowerCase();
    if (kw.includes(m) && t.includes(m)) {
      return 0.15; // 同一スピリチュアル用語で +0.15 ボーナス
    }
  }
  return 0;
}

// ─── メイン: 関連記事選定 ───────────────────────────────────────────────────

/**
 * 新規記事のキーワードに最も関連する既存記事を上位 N 件選定する。
 *
 * @param keyword     新規記事のメインキーワード
 * @param candidates  既存記事カード一覧
 * @param topN        返却件数（デフォルト3）
 * @param excludeHref 自分自身の href（除外用）
 */
export function selectRelatedArticles(
  keyword: string,
  candidates: ArticleCard[],
  topN = 3,
  excludeHref?: string,
): RelatedArticle[] {
  if (candidates.length === 0) return [];

  // 除外フィルタ
  const filtered = excludeHref
    ? candidates.filter((c) => c.href !== excludeHref)
    : candidates;

  if (filtered.length === 0) return [];

  // トークナイズ
  const queryTokens = tokenize(keyword);
  const docTokensList = filtered.map((c) => tokenize(c.title));

  // IDF 計算（クエリも含む全コーパス）
  const allDocs = [queryTokens, ...docTokensList];
  const idf = computeIDF(allDocs);

  // クエリ TF-IDF
  const queryTF = computeTF(queryTokens);
  const queryVec = computeTFIDF(queryTF, idf);

  // 各候補とのスコア計算
  const scored: RelatedArticle[] = filtered.map((card, i) => {
    const docTF = computeTF(docTokensList[i]);
    const docVec = computeTFIDF(docTF, idf);

    const cosine = cosineSimilarity(queryVec, docVec);
    const bonus = spiritualTermBonus(keyword, card.title);

    return {
      href: card.href,
      title: card.title,
      score: cosine + bonus,
    };
  });

  // スコア降順ソート → 上位 N 件
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
