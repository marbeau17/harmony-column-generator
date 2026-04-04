// ============================================================================
// src/app/column/[slug]/page.tsx
// 公開コラムページ（SSG 対応サーバーコンポーネント）
// ============================================================================

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateFullSchema } from '@/lib/seo/structured-data';
import { generateOgpMeta } from '@/lib/seo/meta-generator';
import type { Article } from '@/types/article';
import ScrollDepthTracker from '@/components/common/ScrollDepthTracker';
import CtaTracker from '@/components/common/CtaTracker';

// ─── 定数 ───────────────────────────────────────────────────────────────────

const SITE_URL = 'https://harmony-mc.com';

// ─── データ取得 ─────────────────────────────────────────────────────────────

async function getArticleBySlug(slug: string): Promise<Article | null> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error || !data) return null;
  return data as Article;
}

async function getRelatedArticles(
  article: Article,
  limit = 3,
): Promise<Pick<Article, 'id' | 'title' | 'slug' | 'keyword' | 'theme'>[]> {
  const supabase = await createServiceRoleClient();

  const { data } = await supabase
    .from('articles')
    .select('id, title, slug, keyword, theme')
    .eq('status', 'published')
    .neq('id', article.id)
    .eq('theme', article.theme)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) {
    // テーマが一致する記事がなければ最新記事を取得
    const { data: fallback } = await supabase
      .from('articles')
      .select('id, title, slug, keyword, theme')
      .eq('status', 'published')
        .neq('id', article.id)
      .order('published_at', { ascending: false })
      .limit(limit);

    return (fallback ?? []) as Pick<
      Article,
      'id' | 'title' | 'slug' | 'keyword' | 'theme'
    >[];
  }

  return data as Pick<
    Article,
    'id' | 'title' | 'slug' | 'keyword' | 'theme'
  >[];
}

// ─── SSG: generateStaticParams ──────────────────────────────────────────────

export async function generateStaticParams() {
  // ビルド時はSupabase未接続の可能性があるため空配列を返す（ISRで動的生成）
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  try {
    const supabase = await createServiceRoleClient();

    const { data } = await supabase
      .from('articles')
      .select('slug')
      .eq('status', 'published')
        .not('slug', 'is', null);

    return (data ?? []).map((row) => ({
    slug: row.slug as string,
  }));
  } catch {
    return [];
  }
}

export const dynamicParams = true;

// ─── generateMetadata ───────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    return {
      title: '記事が見つかりません | Harmony',
    };
  }

  const ogp = generateOgpMeta(article);

  return {
    title: article.title ?? 'Harmony コラム',
    description: ogp.description,
    openGraph: {
      title: ogp.title,
      description: ogp.description,
      url: ogp.url,
      type: 'article',
      images: [
        {
          url: ogp.image,
          width: 1200,
          height: 630,
          alt: ogp.title,
        },
      ],
      siteName: 'Harmony スピリチュアルコラム',
      locale: 'ja_JP',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogp.title,
      description: ogp.description,
      images: [ogp.image],
    },
    alternates: {
      canonical: ogp.url,
    },
  };
}

// ─── CTA コンポーネント ─────────────────────────────────────────────────────

type CtaType = 'counseling' | 'system' | 'booking';

const CTA_CONFIG: Record<CtaType, { title: string; description: string; buttonText: string; href: string }> = {
  counseling: {
    title: 'スピリチュアルカウンセリングのご案内',
    description: '霊視・前世リーディングで、あなたの魂の目的や人生の課題を読み解きます。',
    buttonText: 'カウンセリング詳細を見る',
    href: `${SITE_URL}/counseling`,
  },
  system: {
    title: 'カウンセリングの流れ・料金',
    description: 'オンライン・対面カウンセリングの詳細、料金、所要時間をご案内します。',
    buttonText: '料金・システムを見る',
    href: `${SITE_URL}/system`,
  },
  booking: {
    title: 'ご予約はこちら',
    description: 'お気軽にお問い合わせください。あなたに合ったカウンセリングをご提案します。',
    buttonText: '予約する',
    href: `${SITE_URL}/booking`,
  },
};

function CtaBlock({ type, position }: { type: CtaType; position: string }) {
  const cta = CTA_CONFIG[type];
  return (
    <aside
      className="harmony-cta my-10 rounded-xl border border-[var(--color-gold)]/30 bg-gradient-to-r from-white to-[var(--color-gold)]/5 p-6 shadow-sm"
      data-cta-position={position}
    >
      <h3 className="mb-2 text-lg font-bold text-[var(--color-dark)]">
        {cta.title}
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-[var(--color-primary)]">
        {cta.description}
      </p>
      <a
        href={cta.href}
        className="inline-block rounded-full bg-[var(--color-dark)] px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        {cta.buttonText}
      </a>
    </aside>
  );
}

// ─── ページコンポーネント ───────────────────────────────────────────────────

export default async function ColumnArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  const relatedArticles = await getRelatedArticles(article);
  const jsonLd = generateFullSchema(article);
  const htmlContent =
    article.published_html ??
    article.stage3_final_html ??
    article.stage2_body_html ??
    '';

  const publishedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <>
      {/* JSON-LD 構造化データ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      {/* トラッキング */}
      <ScrollDepthTracker />
      <CtaTracker />

      <div className="min-h-screen bg-[var(--color-bg)]">
        {/* パンくずリスト */}
        <nav
          className="mx-auto max-w-3xl px-4 pt-6 text-sm text-[var(--color-primary)]"
          aria-label="パンくずリスト"
        >
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <a href={SITE_URL} className="hover:underline">
                ホーム
              </a>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <a href={`${SITE_URL}/column`} className="hover:underline">
                コラム
              </a>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-[var(--color-dark)]" aria-current="page">
              {article.title}
            </li>
          </ol>
        </nav>

        {/* メインコンテンツ */}
        <main className="mx-auto max-w-3xl px-4 py-8">
          <article>
            {/* 記事ヘッダー */}
            <header className="mb-8">
              {article.keyword && (
                <span className="mb-3 inline-block rounded-full bg-[var(--color-gold)]/20 px-3 py-1 text-xs font-medium text-[var(--color-dark)]">
                  {article.keyword}
                </span>
              )}
              <h1 className="mb-4 text-2xl font-bold leading-relaxed text-[var(--color-dark)] sm:text-3xl">
                {article.title}
              </h1>
              {publishedDate && (
                <time
                  dateTime={article.published_at ?? undefined}
                  className="text-sm text-[var(--color-primary)]"
                >
                  {publishedDate}
                </time>
              )}
            </header>

            {/* CTA 1: カウンセリング案内 */}
            <CtaBlock type="counseling" position="top" />

            {/* 記事本文 */}
            <div
              className="prose prose-lg max-w-none
                prose-headings:text-[var(--color-dark)]
                prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-[var(--color-gold)]/30 prose-h2:pb-2 prose-h2:text-xl prose-h2:font-bold sm:prose-h2:text-2xl
                prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-lg prose-h3:font-semibold
                prose-p:leading-8 prose-p:text-[var(--color-dark)]
                prose-a:text-[var(--color-primary)] prose-a:underline hover:prose-a:text-[var(--color-gold)]
                prose-strong:text-[var(--color-dark)]
                prose-ul:my-4 prose-ol:my-4
                prose-li:leading-7
                prose-img:rounded-lg prose-img:shadow-md
                prose-blockquote:border-l-[var(--color-gold)] prose-blockquote:bg-white/50 prose-blockquote:py-1 prose-blockquote:italic"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </article>

          {/* CTA 2: 料金・システム */}
          <CtaBlock type="system" position="middle" />

          {/* 著者プロフィールカード */}
          <aside className="mt-12 rounded-xl border border-[var(--color-gold)]/30 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-gold)]/20 text-2xl">
                <span role="img" aria-label="著者アイコン">
                  &#x2728;
                </span>
              </div>
              <div>
                <p className="text-sm text-[var(--color-primary)]">著者</p>
                <h3 className="text-lg font-bold text-[var(--color-dark)]">
                  小林由起子
                </h3>
                <p className="mb-2 text-sm text-[var(--color-primary)]">
                  スピリチュアルカウンセラー
                </p>
                <p className="text-sm leading-6 text-[var(--color-dark)]">
                  霊視・前世リーディングを通じて、魂の目的や人生の課題を読み解くカウンセリングを行っています。
                  カルマ、チャクラ、エネルギーワークなど、スピリチュアルな視点から
                  あなたの人生をサポートします。
                </p>
                <a
                  href={`${SITE_URL}/profile`}
                  className="mt-2 inline-block text-sm text-[var(--color-primary)] underline hover:text-[var(--color-gold)]"
                >
                  プロフィール詳細
                </a>
              </div>
            </div>
          </aside>

          {/* CTA 3: 予約 */}
          <CtaBlock type="booking" position="bottom" />

          {/* 関連記事 */}
          {relatedArticles.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-6 text-xl font-bold text-[var(--color-dark)]">
                関連コラム
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {relatedArticles.map((related) => (
                  <a
                    key={related.id}
                    href={`/column/${related.slug ?? related.id}`}
                    className="group block rounded-lg border border-[var(--color-gold)]/20 bg-white p-4 shadow-sm transition hover:shadow-md"
                  >
                    <span className="mb-2 inline-block text-xs text-[var(--color-primary)]">
                      {related.keyword}
                    </span>
                    <h3 className="text-sm font-semibold leading-snug text-[var(--color-dark)] group-hover:text-[var(--color-primary)]">
                      {related.title}
                    </h3>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* 免責事項 */}
          <aside className="mt-12 rounded-lg bg-white/60 p-5 text-xs leading-5 text-[var(--color-primary)]">
            <p className="mb-1 font-semibold">免責事項</p>
            <p>
              本コラムの内容はスピリチュアルな観点からの情報提供を目的としており、
              医学的・心理学的な診断や治療に代わるものではありません。
              心身の不調がある場合は、必ず専門の医療機関にご相談ください。
              また、個人の体験や感じ方には個人差があり、
              本コラムに記載された内容の効果を保証するものではありません。
            </p>
          </aside>
        </main>

        {/* フッター */}
        <footer className="mt-8 border-t border-[var(--color-gold)]/20 py-8 text-center text-xs text-[var(--color-primary)]">
          <p>&copy; Harmony スピリチュアルコラム. All rights reserved.</p>
        </footer>
      </div>
    </>
  );
}
