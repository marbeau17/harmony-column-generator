// ============================================================================
// src/lib/publish/auto-related.ts
// 関連記事自動計算・保存モジュール
//
// 記事公開時に TF-IDF ベースの関連記事を計算し、Supabase に保存する。
// ============================================================================

import { getArticleRelativePath } from '@/lib/config/public-urls';
import {
  selectRelatedArticles,
  type ArticleCard,
} from '@/lib/generators/related-articles';
import { createServiceRoleClient } from '@/lib/supabase/server';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface PublishedArticleRow {
  id: string;
  slug: string;
  title: string;
  keyword: string;
}

interface RelatedArticleEntry {
  href: string;
  title: string;
}

// ─── 公開済み記事の取得 ─────────────────────────────────────────────────────

/**
 * 公開済み記事の一覧を Supabase から取得し、ArticleCard[] 形式で返す
 */
export async function fetchPublishedArticleCards(): Promise<
  { id: string; slug: string; title: string; keyword: string }[]
> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, keyword')
    .eq('status', 'published');

  if (error) {
    throw new Error(`公開済み記事の取得に失敗しました: ${error.message}`);
  }

  return (data ?? []) as PublishedArticleRow[];
}

// ─── 単一記事の関連記事計算・保存 ──────────────────────────────────────────

/**
 * 指定記事の関連記事を計算し、DB に保存する
 */
export async function computeAndSaveRelatedArticles(
  articleId: string,
): Promise<void> {
  const supabase = await createServiceRoleClient();

  // 対象記事を取得
  const { data: article, error: fetchError } = await supabase
    .from('articles')
    .select('id, slug, title, keyword')
    .eq('id', articleId)
    .single();

  if (fetchError || !article) {
    throw new Error(
      `記事 ${articleId} の取得に失敗しました: ${fetchError?.message ?? '記事が見つかりません'}`,
    );
  }

  // 全公開済み記事を取得
  const allCards = await fetchPublishedArticleCards();

  // ArticleCard[] 形式に変換（href を env 駆動の相対パスにマッピング）
  const candidates: ArticleCard[] = allCards.map((a) => ({
    href: getArticleRelativePath(a.slug), // P5-44: env 駆動に置換
    title: a.title,
  }));

  // 自分自身を除外して関連記事を選定（上位3件）
  const selfHref = getArticleRelativePath(article.slug); // P5-44: env 駆動に置換
  const related = selectRelatedArticles(
    article.keyword,
    candidates,
    3,
    selfHref,
  );

  // score を除外して保存用データを作成
  const relatedEntries: RelatedArticleEntry[] = related.map((r) => ({
    href: r.href,
    title: r.title,
  }));

  // DB に保存
  const { error: updateError } = await supabase
    .from('articles')
    .update({ related_articles: relatedEntries })
    .eq('id', articleId);

  if (updateError) {
    throw new Error(
      `記事 ${articleId} の関連記事保存に失敗しました: ${updateError.message}`,
    );
  }
}

// ─── 全記事の関連記事一括再計算 ────────────────────────────────────────────

/**
 * 全公開済み記事の関連記事を再計算し、DB に一括保存する。
 * 新記事追加時に既存記事の関連記事も更新するために使用。
 */
export async function updateAllRelatedArticles(): Promise<{
  updated: number;
  errors: string[];
}> {
  const supabase = await createServiceRoleClient();

  // 全公開済み記事を取得
  const allCards = await fetchPublishedArticleCards();

  if (allCards.length === 0) {
    return { updated: 0, errors: [] };
  }

  // ArticleCard[] 形式に変換
  const candidates: ArticleCard[] = allCards.map((a) => ({
    href: getArticleRelativePath(a.slug), // P5-44: env 駆動に置換
    title: a.title,
  }));

  let updated = 0;
  const errors: string[] = [];

  // 各記事について関連記事を計算・保存
  for (const article of allCards) {
    try {
      const selfHref = getArticleRelativePath(article.slug); // P5-44: env 駆動に置換
      const related = selectRelatedArticles(
        article.keyword,
        candidates,
        3,
        selfHref,
      );

      const relatedEntries: RelatedArticleEntry[] = related.map((r) => ({
        href: r.href,
        title: r.title,
      }));

      const { error: updateError } = await supabase
        .from('articles')
        .update({ related_articles: relatedEntries })
        .eq('id', article.id);

      if (updateError) {
        errors.push(
          `記事 "${article.title}" (${article.id}): ${updateError.message}`,
        );
      } else {
        updated++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`記事 "${article.title}" (${article.id}): ${message}`);
    }
  }

  return { updated, errors };
}
