import { createServiceRoleClient } from '@/lib/supabase/server';
import { THEME_CATEGORIES } from '@/types/article';

const SITE_URL = 'https://harmony-mc.com';

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
    const { data, error } = await supabase
      .from('articles')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .not('reviewed_at', 'is', null)  // 由起子さん確認済みのみ
      .order('published_at', { ascending: false });

    if (error || !data) return [...staticPages, ...categoryPages];

    const articlePages: SitemapEntry[] = data.map((row) => ({
      url: `${SITE_URL}/column/${row.slug}`,
      lastModified: new Date(row.updated_at ?? row.published_at ?? new Date()),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...categoryPages, ...articlePages];
  } catch {
    return [...staticPages, ...categoryPages];
  }
}
