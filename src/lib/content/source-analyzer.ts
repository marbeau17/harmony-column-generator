// =============================================================================
// 元記事分析エンジン
// =============================================================================

/**
 * 記事分析結果
 */
export interface SourceAnalysis {
  /** 検出されたテーマ一覧 */
  themes: string[];
  /** 抽出されたキーワード */
  keywords: string[];
  /** 感情トーン */
  emotionalTone: string;
  /** スピリチュアル関連コンセプト */
  spiritualConcepts: string[];
}

// ---------------------------------------------------------------------------
// テーマ分類用キーワード辞書
// ---------------------------------------------------------------------------

const THEME_KEYWORDS: Record<string, string[]> = {
  soul_mission: [
    '魂', '使命', 'ミッション', '天命', '運命', '目覚め', '覚醒',
    '光の使者', '魂の目的', '生まれてきた意味', '宇宙', '存在意義',
  ],
  relationships: [
    '人間関係', '恋愛', 'パートナー', '夫婦', '親子', '友人',
    'コミュニケーション', '絆', 'つながり', '信頼', '共依存', '境界線',
    'ツインレイ', 'ソウルメイト', '縁',
  ],
  grief_care: [
    'グリーフ', '悲嘆', '喪失', '死別', '看取り', '亡くなった',
    'お別れ', '悲しみ', '供養', '弔い', 'ペットロス', '流産', '死',
  ],
  self_growth: [
    '成長', '変容', '自己実現', '自分らしさ', '可能性', '挑戦',
    'ステージ', 'レベルアップ', '進化', '変化', '目標', '夢',
    '自己啓発', 'マインドセット',
  ],
  healing: [
    '癒し', 'ヒーリング', '浄化', 'エネルギー', 'チャクラ', 'オーラ',
    'レイキ', '瞑想', 'マインドフルネス', '呼吸法', 'リラックス',
    'デトックス', 'セルフケア',
  ],
  daily: [
    '日常', '暮らし', '習慣', 'ルーティン', '朝活', '生活',
    'バランス', 'ストレス', '仕事', '家事', '育児', '季節',
    '食事', '睡眠',
  ],
  introduction: [
    '入門', '初心者', '初めて', '基本', '基礎', 'とは',
    'スピリチュアルとは', '始め方', 'やり方', 'Q&A', 'よくある質問',
    'カウンセリングとは',
  ],
};

// 感情トーン判定用キーワード辞書
const EMOTIONAL_TONE_KEYWORDS: Record<string, string[]> = {
  hopeful: ['希望', '光', '未来', '可能性', '前向き', 'ポジティブ', '信じる', '願い'],
  compassionate: ['寄り添い', '共感', '理解', '受容', '温かい', '優しい', '思いやり'],
  empowering: ['力', '強さ', '勇気', '決断', '行動', '踏み出す', '自信', '乗り越える'],
  reflective: ['振り返り', '気づき', '内省', '静か', '深い', '考える', '見つめる'],
  nurturing: ['育む', '守る', '支える', 'ケア', '大切', '慈しむ', '愛'],
  calming: ['安心', '穏やか', 'リラックス', '落ち着き', '平和', '静寂', '安らぎ'],
};

// スピリチュアルコンセプト辞書
const SPIRITUAL_CONCEPTS: string[] = [
  'チャクラ', 'オーラ', 'ハイヤーセルフ', 'アカシックレコード',
  'ツインレイ', 'ソウルメイト', 'カルマ', '前世', '輪廻',
  'エネルギーワーク', 'レイキ', '光の使者',
  'アセンション', '波動', '周波数', '引き寄せ',
  '瞑想', 'マインドフルネス', '第三の目', 'クンダリーニ',
  'グラウンディング', 'プロテクション', 'インナーチャイルド',
  'シャーマニズム', 'タロット', 'オラクルカード',
  '数秘術', '占星術', 'ホロスコープ', 'マヤ暦',
  '満月', '新月', 'レムリア', 'アトランティス',
  '天使', '大天使', 'スピリットガイド', '守護霊',
];

// ---------------------------------------------------------------------------
// メイン分析関数
// ---------------------------------------------------------------------------

/**
 * 元記事のコンテンツを分析し、テーマ・キーワード・トーン・スピリチュアルコンセプトを返す
 * @param content 記事本文（プレーンテキストまたはHTML）
 * @returns 分析結果
 */
export function analyzeSourceArticle(content: string): SourceAnalysis {
  // HTMLタグを除去してプレーンテキスト化
  const plainText = stripHtml(content);

  const themes = detectThemes(plainText);
  const keywords = extractKeywords(plainText);
  const emotionalTone = detectEmotionalTone(plainText);
  const spiritualConcepts = detectSpiritualConcepts(plainText);

  return {
    themes,
    keywords,
    emotionalTone,
    spiritualConcepts,
  };
}

// ---------------------------------------------------------------------------
// キーワード抽出（bigram + 頻度分析）
// ---------------------------------------------------------------------------

/**
 * テキストからキーワードを抽出する（bigram + 頻度分析）
 * @param text プレーンテキスト
 * @param maxCount 返却するキーワード最大数（デフォルト: 15）
 * @returns キーワード配列（頻度順）
 */
export function extractKeywords(text: string, maxCount: number = 15): string[] {
  const cleaned = text.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();

  // 日本語文字を抽出（ひらがな・カタカナ・漢字）
  const japaneseChars = cleaned.replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '');

  // bigram（2文字組）の頻度を計算
  const bigramFreq = new Map<string, number>();
  for (let i = 0; i < japaneseChars.length - 1; i++) {
    const bigram = japaneseChars.slice(i, i + 2);
    // ひらがなのみのbigramはスキップ（助詞等を除外）
    if (/^[\u3040-\u309F]{2}$/.test(bigram)) continue;
    bigramFreq.set(bigram, (bigramFreq.get(bigram) ?? 0) + 1);
  }

  // trigram（3文字組）の頻度を計算
  const trigramFreq = new Map<string, number>();
  for (let i = 0; i < japaneseChars.length - 2; i++) {
    const trigram = japaneseChars.slice(i, i + 3);
    if (/^[\u3040-\u309F]{3}$/.test(trigram)) continue;
    trigramFreq.set(trigram, (trigramFreq.get(trigram) ?? 0) + 1);
  }

  // カタカナ語を抽出
  const katakanaWords = cleaned.match(/[\u30A0-\u30FF]{2,}/g) ?? [];
  const katakanaFreq = new Map<string, number>();
  for (const word of katakanaWords) {
    katakanaFreq.set(word, (katakanaFreq.get(word) ?? 0) + 1);
  }

  // 全キーワード候補をマージしてスコアリング
  const candidates = new Map<string, number>();

  // trigramを優先（より意味のある単位）
  for (const [gram, freq] of trigramFreq) {
    if (freq >= 2) {
      candidates.set(gram, freq * 1.5);
    }
  }

  // bigramで補完
  for (const [gram, freq] of bigramFreq) {
    if (freq >= 3 && !isSubstringOfAny(gram, candidates)) {
      candidates.set(gram, freq);
    }
  }

  // カタカナ語を追加
  for (const [word, freq] of katakanaFreq) {
    if (freq >= 1) {
      candidates.set(word, freq * 2); // カタカナ語は専門用語の可能性が高いのでブースト
    }
  }

  // スピリチュアルコンセプトが本文中にあれば追加
  for (const concept of SPIRITUAL_CONCEPTS) {
    if (cleaned.includes(concept)) {
      candidates.set(concept, (candidates.get(concept) ?? 0) + 5);
    }
  }

  // スコア順でソートして上位を返す
  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([keyword]) => keyword);
}

// ---------------------------------------------------------------------------
// テーマ自動分類
// ---------------------------------------------------------------------------

/**
 * タイトルとコンテンツからテーマを自動分類する
 * @param title 記事タイトル
 * @param content 記事本文
 * @returns 最もマッチ度の高いテーマ名
 */
export function classifyTheme(title: string, content: string): string {
  const combined = `${title} ${title} ${title} ${stripHtml(content)}`; // タイトルの重みを3倍
  const themes = detectThemes(combined);
  return themes[0] ?? 'healing'; // デフォルトは healing
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/**
 * テキストからテーマを検出し、スコア順に返す
 */
function detectThemes(text: string): string[] {
  const scores: Record<string, number> = {};

  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(escapeRegex(keyword), 'g');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    if (score > 0) {
      scores[theme] = score;
    }
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme);
}

/**
 * テキストの感情トーンを検出する
 */
function detectEmotionalTone(text: string): string {
  let bestTone = 'compassionate'; // デフォルト
  let bestScore = 0;

  for (const [tone, keywords] of Object.entries(EMOTIONAL_TONE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTone = tone;
    }
  }

  return bestTone;
}

/**
 * テキスト中のスピリチュアルコンセプトを検出する
 */
function detectSpiritualConcepts(text: string): string[] {
  return SPIRITUAL_CONCEPTS.filter((concept) => text.includes(concept));
}

/**
 * HTMLタグを除去してプレーンテキストにする
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 正規表現の特殊文字をエスケープする
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 文字列が既存候補のサブ文字列であるかチェック
 */
function isSubstringOfAny(str: string, candidates: Map<string, number>): boolean {
  for (const key of candidates.keys()) {
    if (key !== str && key.includes(str)) {
      return true;
    }
  }
  return false;
}
