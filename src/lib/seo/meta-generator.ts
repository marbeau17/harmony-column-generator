// ============================================================================
// src/lib/seo/meta-generator.ts
// SEO メタデータ自動生成
// ============================================================================

import type { Article } from '@/types/article';

const SITE_URL = 'https://harmony-mc.com';

// ─── メタタイトル生成 ───────────────────────────────────────────────────────

/**
 * SEO に最適化されたメタタイトルを生成する。
 * 28-35 文字に収まるよう調整。キーワードを前方に配置。
 */
export function generateMetaTitle(keyword: string, topic: string): string {
  const suffix = '｜Harmony';
  const suffixLen = suffix.length; // 9文字

  // キーワード + トピックで構成
  const maxBodyLen = 35 - suffixLen; // 26文字
  const minBodyLen = 28 - suffixLen; // 19文字

  // パターン 1: 「{keyword}で{topic}」
  const pattern1 = `${keyword}で${topic}`;
  if (pattern1.length >= minBodyLen && pattern1.length <= maxBodyLen) {
    return `${pattern1}${suffix}`;
  }

  // パターン 2: 「{keyword}|{topic}」（短い場合）
  const pattern2 = `${keyword}｜${topic}`;
  if (pattern2.length >= minBodyLen && pattern2.length <= maxBodyLen) {
    return `${pattern2}${suffix}`;
  }

  // パターン 3: トピックをトリムして調整
  let body = `${keyword}で${topic}`;
  if (body.length > maxBodyLen) {
    body = body.slice(0, maxBodyLen);
  }
  if (body.length < minBodyLen) {
    body = `${keyword}の完全ガイド｜${topic}`.slice(0, maxBodyLen);
  }

  // 最低限キーワードだけでも含める
  if (body.length < minBodyLen) {
    body = `${keyword}とは？スピリチュアルな視点で解説`;
    body = body.slice(0, maxBodyLen);
  }

  return `${body}${suffix}`;
}

// ─── メタディスクリプション生成 ─────────────────────────────────────────────

/**
 * SEO に最適化されたメタディスクリプションを生成する。
 * 80-120 文字に収まるよう調整。
 */
export function generateMetaDescription(
  keyword: string,
  summary: string,
): string {
  const MIN_LEN = 80;
  const MAX_LEN = 120;

  // summary が既に適切な長さならキーワードを含めて返す
  if (summary.includes(keyword)) {
    if (summary.length >= MIN_LEN && summary.length <= MAX_LEN) {
      return summary;
    }
    if (summary.length > MAX_LEN) {
      return summary.slice(0, MAX_LEN - 1) + '…';
    }
  }

  // キーワードを先頭に含む説明文を構成
  let description = `${keyword}について、スピリチュアルカウンセラー小林由起子が解説。${summary}`;

  if (description.length > MAX_LEN) {
    description = description.slice(0, MAX_LEN - 1) + '…';
  }

  // 短すぎる場合は補足を追加
  if (description.length < MIN_LEN) {
    description += '実践的なアドバイスと具体的な方法をお伝えします。';
    if (description.length > MAX_LEN) {
      description = description.slice(0, MAX_LEN - 1) + '…';
    }
  }

  return description;
}

// ─── スラッグ生成 ───────────────────────────────────────────────────────────

/** 日本語 → 英語キーワードの簡易マッピング */
const KEYWORD_MAP: Record<string, string> = {
  霊視: 'psychic-reading',
  前世: 'past-life',
  カルマ: 'karma',
  チャクラ: 'chakra',
  エネルギー: 'energy',
  ヒーリング: 'healing',
  瞑想: 'meditation',
  スピリチュアル: 'spiritual',
  魂: 'soul',
  覚醒: 'awakening',
  浄化: 'purification',
  オーラ: 'aura',
  天使: 'angel',
  守護霊: 'guardian-spirit',
  波動: 'vibration',
  直感: 'intuition',
  潜在意識: 'subconscious',
  引き寄せ: 'law-of-attraction',
  ツインレイ: 'twin-ray',
  ソウルメイト: 'soulmate',
  使命: 'mission',
  人間関係: 'relationships',
  恋愛: 'love',
  仕事: 'career',
  お金: 'money',
  健康: 'health',
  グリーフ: 'grief',
  悲しみ: 'grief',
  自己成長: 'self-growth',
  パワーストーン: 'power-stone',
  タロット: 'tarot',
  リーディング: 'reading',
};

/**
 * 記事タイトルから英語スラッグ（ケバブケース）を生成する。
 * 60 文字以内に収める。
 */
export function generateSlug(title: string): string {
  let slug = title;

  // 日本語キーワードを英語に変換（長いキーワードから順に）
  const sortedKeywords = Object.entries(KEYWORD_MAP).sort(
    ([a], [b]) => b.length - a.length,
  );

  const matchedParts: string[] = [];

  for (const [ja, en] of sortedKeywords) {
    if (slug.includes(ja)) {
      matchedParts.push(en);
      slug = slug.replace(new RegExp(ja, 'g'), '');
    }
  }

  // 英数字が既に含まれていれば抽出
  const asciiParts = slug
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // 結合
  const allParts = [...new Set([...matchedParts, ...asciiParts])];

  if (allParts.length === 0) {
    // フォールバック: タイムスタンプベース
    return `column-${Date.now()}`;
  }

  let result = allParts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // 60 文字以内に切り詰め
  if (result.length > 60) {
    result = result.slice(0, 60).replace(/-$/, '');
  }

  return result || `column-${Date.now()}`;
}

// ─── OGP メタデータ生成 ─────────────────────────────────────────────────────

interface OgpMeta {
  title: string;
  description: string;
  image: string;
  url: string;
  type: string;
}

/**
 * OGP メタデータを生成する。
 * SNS シェア時の表示に使用。
 */
export function generateOgpMeta(article: Article): OgpMeta {
  const slug = article.slug ?? article.id;
  const url = `${SITE_URL}/column/${slug}`;
  const title = article.title ?? 'Harmony コラム';
  const description =
    article.meta_description ??
    generateMetaDescription(article.keyword, article.theme);

  let image = `${SITE_URL}/og-default.jpg`;
  if (article.image_files) {
    try {
      const files = Array.isArray(article.image_files)
        ? article.image_files
        : JSON.parse(String(article.image_files));
      if (Array.isArray(files) && files.length > 0) {
        image =
          (files[0] as Record<string, string>).url ??
          (files[0] as Record<string, string>).src ??
          image;
      }
    } catch {
      // デフォルト画像を使用
    }
  }

  return {
    title,
    description,
    image,
    url,
    type: 'article',
  };
}
