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
// P5-59: 生成モード厳密型は共通 types から import（ローカル alias 廃止）
import type { GenerationMode } from '@/types/article';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface PublishedArticleRow {
  id: string;
  slug: string;
  title: string;
  keyword: string;
  generation_mode: GenerationMode | null;
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
  PublishedArticleRow[]
> {
  const supabase = await createServiceRoleClient();

  // P5-59: generation_mode も取得して呼び出し元でモード一致フィルタを行う
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, keyword, generation_mode')
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
  // P5-59: generation_mode も取得して同一モードのみで関連記事候補を絞る
  const { data: article, error: fetchError } = await supabase
    .from('articles')
    .select('id, slug, title, keyword, generation_mode')
    .eq('id', articleId)
    .single();

  if (fetchError || !article) {
    throw new Error(
      `記事 ${articleId} の取得に失敗しました: ${fetchError?.message ?? '記事が見つかりません'}`,
    );
  }

  // 全公開済み記事を取得
  const allCards = await fetchPublishedArticleCards();

  // P5-59: 対象記事と同じ generation_mode の記事のみを候補にする
  const targetMode = (article as { generation_mode: GenerationMode | null })
    .generation_mode;
  const sameModeCards = allCards.filter(
    (a) => a.generation_mode === targetMode,
  );

  // ArticleCard[] 形式に変換（href を env 駆動の相対パスにマッピング）
  const candidates: ArticleCard[] = sameModeCards.map((a) => ({
    href: getArticleRelativePath(a.slug), // P5-44: env 駆動に置換
    title: a.title,
  }));

  // 自分自身を除外して関連記事を選定（上位3件）
  const selfHref = getArticleRelativePath(article.slug); // P5-44: env 駆動に置換

  // P5-59: 同一モード候補が3件未満なら空配列で保存（足りない時は空欄ルール）
  // selfHref を除いた純粋な候補数で判定する
  const candidatesExcludingSelf = candidates.filter((c) => c.href !== selfHref);
  let relatedEntries: RelatedArticleEntry[];
  if (candidatesExcludingSelf.length < 3) {
    relatedEntries = [];
  } else {
    const related = selectRelatedArticles(
      article.keyword,
      candidates,
      3,
      selfHref,
    );

    // score を除外して保存用データを作成
    relatedEntries = related.map((r) => ({
      href: r.href,
      title: r.title,
    }));
  }

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

  let updated = 0;
  const errors: string[] = [];

  // 各記事について関連記事を計算・保存
  for (const article of allCards) {
    try {
      // P5-59: 各記事の generation_mode と一致する候補のみで関連記事を計算する
      const sameModeCards = allCards.filter(
        (a) => a.generation_mode === article.generation_mode,
      );
      const candidates: ArticleCard[] = sameModeCards.map((a) => ({
        href: getArticleRelativePath(a.slug), // P5-44: env 駆動に置換
        title: a.title,
      }));

      const selfHref = getArticleRelativePath(article.slug); // P5-44: env 駆動に置換

      // P5-59: 自分自身を除いた同一モード候補が3件未満なら空配列で保存
      const candidatesExcludingSelf = candidates.filter(
        (c) => c.href !== selfHref,
      );
      let relatedEntries: RelatedArticleEntry[];
      if (candidatesExcludingSelf.length < 3) {
        relatedEntries = [];
      } else {
        const related = selectRelatedArticles(
          article.keyword,
          candidates,
          3,
          selfHref,
        );
        relatedEntries = related.map((r) => ({
          href: r.href,
          title: r.title,
        }));
      }

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
