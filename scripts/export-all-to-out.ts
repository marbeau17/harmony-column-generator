import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://khsorerqojgwbmtiqrac.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtoc29yZXJxb2pnd2JtdGlxcmFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0NjUxNSwiZXhwIjoyMDkwODIyNTE1fQ.san11urNK7w4GxqDWtJj4Ka3iPYmwxflPlzvsScW9ZY';

const THEME: Record<string, string> = {
  soul_mission: '魂の使命', relationships: '人間関係', grief_care: 'グリーフケア',
  self_growth: '自己成長', healing: 'ヒーリング', daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

function esc(s: string) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildRelatedHtml(article: any, allArticles: any[]): string {
  const related = article.related_articles;
  if (!related || !Array.isArray(related) || related.length === 0) return '';

  const cards = related.slice(0, 3).map((r: { href: string; title: string }) => {
    // Extract slug from href like /column/slug/
    const slug = r.href.replace(/^\/column\//, '').replace(/\/$/, '');
    const imgExt = fs.existsSync(path.join(process.cwd(), 'out', 'column', slug, 'images', 'hero.svg')) ? 'svg' : 'jpg';
    return `<a href="../${slug}/index.html" style="display:flex;gap:1rem;padding:1rem;background:#fff;border-radius:0.75rem;box-shadow:0 1px 3px rgba(0,0,0,0.06);text-decoration:none;color:inherit">
      <img src="../${slug}/images/hero.${imgExt}" alt="" style="width:100px;height:67px;object-fit:cover;border-radius:0.5rem;flex-shrink:0" loading="lazy">
      <span style="font-size:0.9rem;color:#53352b;font-weight:500;line-height:1.5">${esc(r.title)}</span>
    </a>`;
  }).join('\n');

  return `<section style="margin:2.5rem 0">
  <h2 style="font-size:1.25rem;font-weight:700;color:#53352b;margin-bottom:1rem">合わせて読みたい記事</h2>
  <div style="display:grid;grid-template-columns:1fr;gap:1rem">
    ${cards}
  </div>
</section>`;
}

async function downloadImage(url: string, dest: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

async function main() {
  const sb = createClient(SUPABASE_URL, KEY);
  const { data: articles } = await sb.from('articles').select('*').eq('status', 'published').order('published_at', { ascending: false });

  if (!articles || articles.length === 0) { console.log('No published articles'); return; }
  console.log(`Exporting ${articles.length} published articles to out/...`);

  const outDir = path.join(process.cwd(), 'out');
  let count = 0;

  for (const a of articles) {
    const slug = a.slug || a.id;
    const dir = path.join(outDir, 'column', slug);
    const imgDir = path.join(dir, 'images');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

    const body = a.stage2_body_html || a.stage3_final_html || a.published_html || '';
    const title = a.title || '';
    const kw = a.keyword || '';
    const theme = a.theme || '';
    const meta = a.meta_description || '';
    const dt = a.published_at ? new Date(a.published_at) : new Date();
    const dateStr = `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
    const cat = THEME[theme] || theme;

    // Remove duplicate hero from body
    let cleanBody = body.replace(/<img[^>]*hero\.(jpg|svg)[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
    cleanBody = cleanBody.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

    const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Harmony スピリチュアルコラム</title>
<meta name="description" content="${esc(meta)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(meta)}">
<meta property="og:image" content="https://harmony-mc.com/column/${slug}/images/hero.jpg">
<meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../css/style.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"${esc(title)}","datePublished":"${a.published_at || ''}","author":{"@type":"Person","name":"小林由起子"}}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TH2XJ24V3T"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-TH2XJ24V3T');</script>
<style>
:root{--color-primary:#b39578;--color-dark:#53352b;--color-gold:#d4a574;--color-bg:#faf3ed}
.harmony-cta{margin:2.5rem auto;max-width:520px;border-radius:12px;padding:1.5rem 2rem;text-align:center}
.harmony-cta-inner{max-width:520px;margin:0 auto}.harmony-cta-badge{display:inline-block;font-size:.7rem;font-weight:600;padding:.15rem .75rem;border-radius:99px;margin-bottom:.5rem}
.harmony-cta-catch{font-size:.95rem;font-weight:600;margin:0 0 .25rem;line-height:1.6}.harmony-cta-sub{font-size:.82rem;margin:0 0 .7rem;opacity:.85}
.harmony-cta-btn{display:inline-block;padding:.55rem 1.8rem;border-radius:99px;font-size:.82rem;font-weight:600;text-decoration:none}
.harmony-cta[data-cta-key="cta1"]{background:linear-gradient(135deg,#f5ebe0,#e8ddd0);border-left:4px solid #b39578}
.harmony-cta[data-cta-key="cta1"] .harmony-cta-badge{background:rgba(179,149,120,.15);color:#b39578}
.harmony-cta[data-cta-key="cta1"] .harmony-cta-catch,.harmony-cta[data-cta-key="cta1"] .harmony-cta-sub{color:#53352b}
.harmony-cta[data-cta-key="cta1"] .harmony-cta-btn{background:#b39578;color:#fff}
.harmony-cta[data-cta-key="cta2"]{background:linear-gradient(135deg,#ede7f0,#ddd5e4);border-left:4px solid #9b8bb4}
.harmony-cta[data-cta-key="cta2"] .harmony-cta-badge{background:rgba(155,139,180,.15);color:#9b8bb4}
.harmony-cta[data-cta-key="cta2"] .harmony-cta-catch,.harmony-cta[data-cta-key="cta2"] .harmony-cta-sub{color:#53352b}
.harmony-cta[data-cta-key="cta2"] .harmony-cta-btn{background:#9b8bb4;color:#fff}
.harmony-cta[data-cta-key="cta3"]{background:linear-gradient(135deg,#53352b,#7a5c4f)}
.harmony-cta[data-cta-key="cta3"] .harmony-cta-badge{background:rgba(255,255,255,.15);color:rgba(255,255,255,.9)}
.harmony-cta[data-cta-key="cta3"] .harmony-cta-catch{color:#fff}.harmony-cta[data-cta-key="cta3"] .harmony-cta-sub{color:rgba(255,255,255,.85)}
.harmony-cta[data-cta-key="cta3"] .harmony-cta-btn{background:linear-gradient(135deg,#d4a574,#c4856e);color:#fff;padding:.65rem 2rem}
.marker-yellow{background:linear-gradient(transparent 60%,#fff3b0 60%);padding:0 2px}
.marker-pink{background:linear-gradient(transparent 60%,#ffd6e0 60%);padding:0 2px}
.article-toc{margin:1.5rem 0;background:#fff;border:1px solid #e8ddd4;border-radius:.75rem;padding:0}
.article-toc details{padding:1rem 1.25rem}.article-toc details summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;font-weight:600;color:#53352b}
.article-toc-title{font-size:.95rem;margin:0}.article-toc-list{margin:.75rem 0 0;padding-left:1.5rem;font-size:.88rem;line-height:2}
.article-toc-list a{color:#53352b;text-decoration:none}.article-toc-list a:hover{color:#b39578;text-decoration:underline}
.article-toc-list ol{list-style:none;padding-left:1.2rem;margin:.2rem 0 0}
.sticky-cta-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(250,243,237,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(179,149,120,0.3);padding:10px 12px;display:flex;justify-content:center;gap:8px}
.sticky-cta-bar a{display:inline-flex;align-items:center;gap:4px;padding:8px 14px;border-radius:99px;font-size:.78rem;font-weight:600;font-family:'Noto Sans JP',sans-serif;text-decoration:none;white-space:nowrap;transition:transform .15s,box-shadow .2s;line-height:1}
.sticky-cta-bar .cta-booking{background:linear-gradient(135deg,#d4a574,#c4856e);color:#fff;box-shadow:0 2px 8px rgba(212,165,116,0.4)}
.sticky-cta-bar .cta-counseling{background:#53352b;color:#fff;box-shadow:0 2px 8px rgba(83,53,43,0.3)}
.sticky-cta-bar .cta-contact{background:#fff;color:#53352b;border:1.5px solid #b39578}
@media(max-width:359px){.sticky-cta-bar{gap:5px;padding:8px}.sticky-cta-bar a{padding:7px 10px;font-size:.72rem;gap:2px}}
</style></head>
<body style="min-height:100vh;background-color:var(--color-bg);font-family:'Noto Sans JP',sans-serif;margin:0;color:#333;padding-bottom:72px">
<nav style="max-width:48rem;margin:0 auto;padding:1rem 1rem 0;font-size:0.85rem;color:#888">
<a href="https://harmony-mc.com/" style="color:var(--color-primary);text-decoration:none">ホーム</a>
<span style="margin:0 0.4rem">&gt;</span>
<a href="../index.html" style="color:var(--color-primary);text-decoration:none">コラム</a>
<span style="margin:0 0.4rem">&gt;</span><span>${esc(title)}</span></nav>
<main style="max-width:48rem;margin:0 auto;padding:1rem 1rem 2rem">
<span style="display:inline-block;background:rgba(212,165,116,0.2);color:var(--color-dark);font-size:0.75rem;padding:0.2rem 0.8rem;border-radius:9999px;margin-bottom:0.75rem">${esc(kw)}</span>
<h1 style="font-size:1.75rem;font-weight:700;color:var(--color-dark);line-height:1.4;margin:0 0 0.5rem">${esc(title)}</h1>
<time style="display:block;font-size:0.85rem;color:#999;margin-bottom:2rem">${dateStr}</time>
<img src="./images/hero.jpg" alt="${esc(title)}" style="width:100%;border-radius:0.75rem;margin-bottom:2rem;aspect-ratio:16/9;object-fit:cover">
<div style="line-height:1.85;font-size:1rem">${cleanBody}</div>
<div style="margin:2rem 0;padding:1.5rem;border:1px solid #e8ddd4;border-radius:0.75rem;display:flex;gap:1rem;align-items:center">
<img src="https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/profile/author-sketch.jpg" alt="小林由起子" width="80" height="80" style="border-radius:50%;flex-shrink:0">
<div><p style="font-weight:700;color:var(--color-dark);margin:0">小林由起子</p><p style="font-size:0.85rem;color:var(--color-primary);margin:0.25rem 0">スピリチュアルカウンセラー</p><p style="font-size:0.8rem;color:#666;margin:0;line-height:1.6">あなたの魂が本来持つ輝きを取り戻すお手伝いをしています。</p></div></div>
${buildRelatedHtml(a, articles)}
<div style="margin:2rem 0;padding:1rem;background:rgba(255,255,255,0.6);border:1px solid #e8ddd4;border-radius:0.5rem;font-size:0.75rem;color:#999;line-height:1.6"><p style="margin:0">※ 本コラムの内容はスピリチュアルカウンセラーの経験と知見に基づく情報提供を目的としています。</p></div>
<footer style="border-top:1px solid #e8ddd4;margin-top:2rem;padding:1.5rem 0;text-align:center;font-size:0.8rem;color:#a09080"><p>Copyright &copy; スピリチュアルハーモニー All Rights Reserved.</p></footer>
</main>
<div class="sticky-cta-bar">
  <a href="https://harmony-booking.web.app/" class="cta-booking" target="_blank" rel="noopener">📅 予約する</a>
  <a href="https://harmony-mc.com/counseling/" class="cta-counseling">✨ カウンセリング</a>
  <a href="https://harmony-mc.com/contact/" class="cta-contact">💬 お問い合わせ</a>
</div>
</body></html>`;

    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');

    // Download images
    const imgs = Array.isArray(a.image_files) ? a.image_files : [];
    for (const img of imgs) {
      if (!img.url) continue;
      const pos = img.position || (['hero', 'body', 'summary'][imgs.indexOf(img)] ?? 'image');
      const fn = `${pos}.jpg`;
      const dest = path.join(imgDir, fn);
      if (!fs.existsSync(dest)) await downloadImage(img.url, dest);
    }

    count++;
    process.stdout.write(`\r${count}/${articles.length} ${slug}                         `);
  }

  // Build category filter tabs
  const themeCounts: Record<string, number> = {};
  for (const a of articles) {
    const t = a.theme || 'other';
    themeCounts[t] = (themeCounts[t] || 0) + 1;
  }

  const filterTabs = Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => {
      const label = THEME[theme] || theme;
      return `<button class="filter-tab" data-filter="${theme}" onclick="filterArticles('${theme}')">${esc(label)} (${count})</button>`;
    })
    .join('\n');

  // Add data-theme to cards
  const cardsWithTheme = articles.map(a => {
    const s = a.slug || a.id;
    const t = a.theme || 'other';
    const c = THEME[t] || t;
    const pd = a.published_at ? new Date(a.published_at) : new Date();
    const ds = `${pd.getFullYear()}.${String(pd.getMonth() + 1).padStart(2, '0')}.${String(pd.getDate()).padStart(2, '0')}`;
    const bdy = (a.stage3_final_html || a.stage2_body_html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const ex = bdy.length > 120 ? bdy.slice(0, 117) + '...' : bdy;
    const imgDir2 = path.join(outDir, 'column', s, 'images');
    const ext = fs.existsSync(path.join(imgDir2, 'hero.svg')) ? 'svg' : 'jpg';
    return `<a href="./${s}/index.html" class="article-card" data-theme="${t}"><div class="card-thumb"><img src="./${s}/images/hero.${ext}" alt="${esc(a.title || '')}" loading="lazy"></div><div class="card-body"><h2>${esc(a.title || '')}</h2><div class="card-meta"><span class="badge">${esc(c)}</span><span class="card-date">${ds}</span></div><p class="card-excerpt">${esc(ex)}</p></div></a>`;
  }).join('\n');

  const hub = `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>魂の気づきコラム | Harmony スピリチュアルコラム</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
:root{--color-primary:#b39578;--color-dark:#53352b;--color-gold:#d4a574;--color-bg:#faf3ed}
*{margin:0;padding:0;box-sizing:border-box}
body{background-color:var(--color-bg);font-family:"Noto Sans JP",sans-serif;color:#333;line-height:1.8}
a{text-decoration:none;color:inherit}
.page-header{text-align:center;padding:64px 16px 32px}
.page-header h1{font-size:2rem;font-weight:700;color:var(--color-dark);letter-spacing:0.08em}
.page-header .subtitle{font-size:1rem;color:var(--color-gold);margin-top:8px;font-weight:500}
.page-header p{font-size:.95rem;color:#7a6a5e;max-width:560px;margin:16px auto 0}
.filter-bar{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:900px;margin:0 auto 32px;padding:0 16px}
.filter-tab{padding:6px 16px;border-radius:99px;border:1px solid var(--color-primary);background:transparent;color:var(--color-primary);font-size:.8rem;font-weight:500;cursor:pointer;transition:all .2s;font-family:inherit}
.filter-tab:hover,.filter-tab.active{background:var(--color-primary);color:#fff}
.article-grid{display:grid;grid-template-columns:1fr;gap:24px;max-width:1152px;margin:0 auto;padding:0 16px 64px}
@media(min-width:640px){.article-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.article-grid{grid-template-columns:repeat(3,1fr)}}
.article-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden;transition:transform .2s,opacity .3s;display:flex;flex-direction:column}
.article-card:hover{transform:translateY(-4px)}
.article-card.hidden{display:none}
.card-body{padding:20px 20px 24px;flex:1;display:flex;flex-direction:column}
.card-body h2{font-size:1.05rem;font-weight:500;color:var(--color-dark);line-height:1.6;margin-bottom:10px}
.card-meta{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.badge{display:inline-block;font-size:.72rem;font-weight:500;padding:2px 10px;border-radius:99px;background:var(--color-bg);color:var(--color-primary);border:1px solid var(--color-primary)}
.card-date{font-size:.78rem;color:#a09080}
.card-excerpt{font-size:.88rem;color:#6b5e54;line-height:1.7;margin-top:auto;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-thumb{aspect-ratio:16/9;overflow:hidden}
.card-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.article-card:hover .card-thumb img{transform:scale(1.05)}
.site-footer{text-align:center;padding:32px 16px;border-top:1px solid #e8ddd4;font-size:.8rem;color:#a09080}
.sticky-cta-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(250,243,237,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(179,149,120,0.3);padding:10px 12px;display:flex;justify-content:center;gap:8px}
.sticky-cta-bar a{display:inline-flex;align-items:center;gap:4px;padding:8px 14px;border-radius:99px;font-size:.78rem;font-weight:600;font-family:'Noto Sans JP',sans-serif;text-decoration:none;white-space:nowrap;transition:transform .15s,box-shadow .2s;line-height:1}
.sticky-cta-bar .cta-booking{background:linear-gradient(135deg,#d4a574,#c4856e);color:#fff;box-shadow:0 2px 8px rgba(212,165,116,0.4)}
.sticky-cta-bar .cta-counseling{background:#53352b;color:#fff;box-shadow:0 2px 8px rgba(83,53,43,0.3)}
.sticky-cta-bar .cta-contact{background:#fff;color:#53352b;border:1.5px solid #b39578}
@media(max-width:359px){.sticky-cta-bar{gap:5px;padding:8px}.sticky-cta-bar a{padding:7px 10px;font-size:.72rem;gap:2px}}
</style></head><body style="padding-bottom:72px">
<header class="page-header">
<p style="margin-bottom:12px"><a href="https://harmony-mc.com/" style="color:var(--color-primary);font-size:.85rem;text-decoration:none">← ホームへ戻る</a></p>
<h1>魂の気づきコラム</h1>
<p class="subtitle">「今を生きるヒント」</p>
<p>スピリチュアルカウンセラー小林由起子が、魂の成長やヒーリング、人間関係など日々の気づきを綴るコラムです。</p>
</header>
<nav class="filter-bar">
<button class="filter-tab active" onclick="filterArticles('all')">すべて (${articles.length})</button>
${filterTabs}
</nav>
<main class="article-grid">
${cardsWithTheme}
</main>
<footer class="site-footer">
<p>Copyright &copy; ${new Date().getFullYear()} スピリチュアルハーモニー All Rights Reserved.</p>
</footer>
<script>
function filterArticles(theme) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.article-card').forEach(card => {
    if (theme === 'all' || card.dataset.theme === theme) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}
</script>
<div class="sticky-cta-bar">
  <a href="https://harmony-booking.web.app/" class="cta-booking" target="_blank" rel="noopener">📅 予約する</a>
  <a href="https://harmony-mc.com/counseling/" class="cta-counseling">✨ カウンセリング</a>
  <a href="https://harmony-mc.com/contact/" class="cta-contact">💬 お問い合わせ</a>
</div>
</body></html>`;

  fs.writeFileSync(path.join(outDir, 'column', 'index.html'), hub, 'utf-8');
  console.log(`\n\nDone! ${count} articles → out/column/`);
  console.log('Hub: out/column/index.html');
}

main().catch(console.error);
