import { createServiceRoleClient } from '@/lib/supabase/server';
import { THEME_CATEGORIES } from '@/types/article';
import { applyPubliclyVisibleFilter } from '@/lib/publish-control/state-readers-sql';
// P5-44: 公開 URL は env 駆動の単一ソースから取得
import { getSiteUrl, getArticleUrl } from '@/lib/config/public-urls';

const SITE_URL = getSiteUrl();

type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
};

export default async function sitemap(): Promise<SitemapEntry[]> {
  const staticPages: SitemapEntry[] = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${SITE_URL}/column`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
  ];

  const categoryPages: SitemapEntry[] = THEME_CATEGORIES.map((theme) => ({
    url: `${SITE_URL}/column?theme=${theme}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [...staticPages, ...categoryPages];
  }

  try {
    const supabase = await createServiceRoleClient();
    // P5-43 Step 2: reviewed_at から visibility_state ベース判定に統一 (§4.2)
    const baseQuery = supabase
      .from('articles')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .not('slug', 'is', null);
    const { data, error } = await applyPubliclyVisibleFilter(baseQuery)
      .order('published_at', { ascending: false });

    if (error || !data) return [...staticPages, ...categoryPages];

    const articlePages: SitemapEntry[] = data.map((row) => ({
      // P5-44: 旧 ${SITE_URL}/column/${slug} → env 駆動の getArticleUrl(slug)
      // (= ${SITE_URL}${HUB_PATH}/${slug}/、現状デフォルトで /spiritual/column/{slug}/)
      url: getArticleUrl(row.slug as string),
      lastModified: new Date(row.updated_at ?? row.published_at ?? new Date()),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...categoryPages, ...articlePages];
  } catch {
    return [...staticPages, ...categoryPages];
  }
}
