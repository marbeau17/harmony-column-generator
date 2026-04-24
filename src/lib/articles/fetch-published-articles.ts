/**
 * Client-side fetch helper for `/api/articles?status=published`.
 * See docs/specs/hub-rebuild-guarantee.md §4.4.
 */

export type ArticleListItem = {
  id: string;
  title: string;
  slug: string;
  status: string;
  reviewed_at: string | null;
  [key: string]: unknown;
};

export type FetchPublishedArticlesResult =
  | { ok: true; articles: ArticleListItem[] }
  | { ok: false; error: string };

export async function fetchPublishedArticles(limit = 200): Promise<FetchPublishedArticlesResult> {
  let res: Response;
  try {
    res = await fetch(`/api/articles?status=published&limit=${limit}`, {
      credentials: 'same-origin',
    });
  } catch (err) {
    return { ok: false, error: 'ネットワークエラー: ' + String(err) };
  }

  if (!res.ok) {
    return { ok: false, error: `記事一覧の取得に失敗しました (HTTP ${res.status})` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'レスポンス解析失敗' };
  }

  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return { ok: false, error: 'レスポンス形式が不正です' };
  }

  return { ok: true, articles: data as ArticleListItem[] };
}
