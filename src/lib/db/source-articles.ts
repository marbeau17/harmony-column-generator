import { createServiceRoleClient } from '@/lib/supabase/server';

// ---------- 型定義 ----------

export interface SourceArticleRow {
  id: string;
  title: string;
  content: string;
  original_url: string | null;
  published_at: string | null;
  word_count: number;
  themes: string[];
  keywords: string[];
  emotional_tone: string | null;
  spiritual_concepts: string[];
  is_processed: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface ListSourceArticlesFilter {
  keyword?: string;
  theme?: string;
  theme_category?: string;
  limit?: number;
  offset?: number;
}

export interface ImportSourceArticleInput {
  title: string;
  content: string;
  original_url?: string;
  published_at?: string;
}

// ---------- CRUD ----------

/**
 * 元記事一覧をページネーション付きで取得する。
 */
export async function listSourceArticles(
  filter: ListSourceArticlesFilter = {},
): Promise<{ data: SourceArticleRow[]; count: number }> {
  const supabase = await createServiceRoleClient();
  const { keyword, theme, theme_category, limit = 20, offset = 0 } = filter;

  let query = supabase
    .from('source_articles')
    .select('*', { count: 'exact' })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (keyword) {
    query = query.or(
      `title.ilike.%${keyword}%,content.ilike.%${keyword}%`,
    );
  }

  if (theme) {
    query = query.contains('themes', [theme]);
  }

  if (theme_category) {
    query = query.eq('theme_category', theme_category);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`listSourceArticles failed: ${error.message}`);
  }

  return {
    data: (data ?? []) as SourceArticleRow[],
    count: count ?? 0,
  };
}

/**
 * 元記事を ID で取得する。
 */
export async function getSourceArticleById(
  id: string,
): Promise<SourceArticleRow | null> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('source_articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`getSourceArticleById failed: ${error.message}`);
  }

  return data as SourceArticleRow | null;
}

/**
 * 元記事をバッチインポートする。
 */
export async function importSourceArticles(
  articles: ImportSourceArticleInput[],
): Promise<{ inserted: number; total: number }> {
  if (articles.length === 0) {
    return { inserted: 0, total: 0 };
  }

  const supabase = await createServiceRoleClient();

  const rows = articles.map((a) => ({
    title: a.title,
    content: a.content,
    original_url: a.original_url ?? null,
    published_at: a.published_at ?? null,
    is_processed: false,
  }));

  // original_url / title ともにUNIQUE制約がないため、単純な insert を使用する。
  const { data, error } = await supabase
    .from('source_articles')
    .insert(rows)
    .select('id');

  if (error) {
    throw new Error(`importSourceArticles failed: ${error.message}`);
  }

  return {
    inserted: data?.length ?? 0,
    total: articles.length,
  };
}

/**
 * まだ使用されていない元記事をランダムに 1 件取得する。
 * theme が指定されている場合はタイトルまたは本文にキーワードを含む記事から選ぶ。
 */
export async function getRandomUnusedSource(
  theme?: string,
): Promise<SourceArticleRow | null> {
  const supabase = await createServiceRoleClient();

  let query = supabase
    .from('source_articles')
    .select('*')
    .eq('is_processed', false);

  if (theme) {
    query = query.or(
      `title.ilike.%${theme}%,content.ilike.%${theme}%`,
    );
  }

  // ランダム取得: まず件数を取得し、ランダムオフセットで 1 件取得
  const countQuery = supabase
    .from('source_articles')
    .select('id', { count: 'exact', head: true })
    .eq('is_processed', false);

  if (theme) {
    countQuery.or(
      `title.ilike.%${theme}%,content.ilike.%${theme}%`,
    );
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    throw new Error(`getRandomUnusedSource count failed: ${countError.message}`);
  }

  if (!count || count === 0) {
    return null;
  }

  const randomOffset = Math.floor(Math.random() * count);

  const { data, error } = await query
    .range(randomOffset, randomOffset)
    .limit(1)
    .single();

  if (error) {
    throw new Error(`getRandomUnusedSource failed: ${error.message}`);
  }

  return data as SourceArticleRow | null;
}
