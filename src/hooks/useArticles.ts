'use client';

import { useState, useEffect, useCallback } from 'react';

interface Article {
  id: string;
  article_number: number;
  title: string | null;
  keyword: string | null;
  status: string;
  slug: string | null;
  meta_description: string | null;
  theme: string | null;
  persona: string | null;
  target_word_count: number;
  stage1_outline: any;
  stage2_body_html: string | null;
  stage3_final_html: string | null;
  published_url: string | null;
  published_at: string | null;
  updated_at: string;
  created_at: string;
}

interface UseArticlesReturn {
  articles: Article[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseArticleReturn {
  article: Article | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useArticles(filter?: {
  status?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
}): UseArticlesReturn {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', filter.status);
      if (filter?.keyword) params.set('keyword', filter.keyword);
      if (filter?.limit) params.set('limit', String(filter.limit));
      if (filter?.offset) params.set('offset', String(filter.offset));

      const res = await fetch(`/api/articles?${params}`);
      if (!res.ok) throw new Error('記事の取得に失敗しました');
      const data = await res.json();
      setArticles(data.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter?.status, filter?.keyword, filter?.limit, filter?.offset]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  return { articles, loading, error, refetch: fetchArticles };
}

export function useArticle(id: string): UseArticleReturn {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticle = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${id}`);
      if (!res.ok) throw new Error('記事の取得に失敗しました');
      const data = await res.json();
      setArticle(data.data || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  return { article, loading, error, refetch: fetchArticle };
}

// API操作関数
export async function createArticle(body: Record<string, any>) {
  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('記事の作成に失敗しました');
  return res.json();
}

export async function updateArticle(id: string, body: Record<string, any>) {
  const res = await fetch(`/api/articles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('記事の更新に失敗しました');
  return res.json();
}

export async function generateOutline(articleId: string) {
  const res = await fetch('/api/ai/generate-outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleId }),
  });
  if (!res.ok) throw new Error('アウトライン生成に失敗しました');
  return res.json();
}

export async function generateBody(articleId: string) {
  const res = await fetch('/api/ai/generate-body', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleId }),
  });
  if (!res.ok) throw new Error('本文生成に失敗しました');
  return res.json();
}

export async function publishArticle(id: string) {
  const res = await fetch(`/api/articles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published' }),
  });
  if (!res.ok) throw new Error('公開に失敗しました');
  return res.json();
}
