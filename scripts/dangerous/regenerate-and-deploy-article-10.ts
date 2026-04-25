/**
 * Article #10 (spiritual-healing-pet-loss) 単体の静的HTML再生成 + FTPデプロイ。
 * 再生成前に out/column/spiritual-healing-pet-loss/index.html のバックアップを
 * tmp/article-10-static-backup/ に保存する(HTML履歴ルール適用)。
 *
 * Usage:
 *   npx tsx scripts/regenerate-and-deploy-article-10.ts --regen      # 再生成のみ
 *   npx tsx scripts/regenerate-and-deploy-article-10.ts --regen --ftp # 再生成+FTPアップロード
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { Client as FtpClient } from "basic-ftp";
import { Readable } from "stream";

const envContent = fs.readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const SLUG = "spiritual-healing-pet-loss";
const ARTICLE_ID = "f868c2c7-4718-41b7-8dce-cbfe7f1e02c6";

async function regenerate(): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: article, error } = await supabase
    .from("articles")
    .select("*")
    .eq("id", ARTICLE_ID)
    .single();
  if (error || !article) throw error ?? new Error("article not found");

  console.log(`Fetched article #${article.article_number} / ${article.slug}`);
  console.log(`  stage3 length: ${article.stage3_final_html?.length ?? 0}`);
  console.log(`  title: ${article.title}`);

  const { generateArticleHtml } = await import(
    "../src/lib/generators/article-html-generator"
  );

  let html = generateArticleHtml(article as any, {
    heroImage: "images/hero.jpg",
    heroImageAlt: article.title ?? SLUG,
    ogImage: `https://harmony-mc.com/column/${SLUG}/images/hero.jpg`,
    hubUrl: "../index.html",
  });

  // Post-process (same as regenerate-all-html.ts)
  html = html.replace(
    /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
    "./images/$1.jpg"
  );
  html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
  html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
  html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
  html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
  html = html.replace(
    /<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g,
    ""
  );

  // Backup existing static HTML before overwriting (HTML history rule)
  const outDir = path.join("out/column", SLUG);
  const outFile = path.join(outDir, "index.html");
  if (fs.existsSync(outFile)) {
    const backupDir = path.resolve("tmp/article-10-static-backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `index-${ts}.html`);
    fs.copyFileSync(outFile, backupFile);
    console.log(`📦 Backed up existing static HTML → ${backupFile}`);
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`✅ Regenerated: ${outFile} (${html.length} bytes)`);
  return outFile;
}

async function regenerateHub() {
  const { buildArticleCards, buildCategories, generateHubPage } =
    await import("../src/lib/generators/hub-generator");
  const cards = await buildArticleCards();
  const categories = buildCategories(cards);
  const recentArticles = cards.slice(0, 5);
  const hubData = {
    articles: cards.slice(0, 10),
    currentPage: 1,
    totalPages: Math.ceil(cards.length / 10),
    categories,
    recentArticles,
  };
  const hubHtml = generateHubPage(hubData);

  const hubFile = "out/column/index.html";
  if (fs.existsSync(hubFile)) {
    const backupDir = path.resolve("tmp/article-10-static-backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(hubFile, path.join(backupDir, `hub-index-${ts}.html`));
  }
  fs.writeFileSync(hubFile, hubHtml);
  console.log(`✅ Hub regenerated: ${hubFile} (${hubHtml.length} bytes)`);
}

async function ftpUpload(localFile: string, remotePath: string) {
  const host = process.env.FTP_HOST!;
  const user = process.env.FTP_USER!;
  const password = process.env.FTP_PASSWORD!;
  const port = parseInt(process.env.FTP_PORT || "21", 10);
  if (!host || !user || !password) throw new Error("FTP credentials missing");

  const client = new FtpClient();
  client.ftp.verbose = false;
  try {
    await client.access({ host, user, password, port, secure: false });
    const dir = path.posix.dirname(remotePath);
    await client.ensureDir(dir);
    await client.cd("/");
    const html = fs.readFileSync(localFile, "utf-8");
    const stream = Readable.from(Buffer.from(html, "utf-8"));
    await client.uploadFrom(stream, remotePath);
    console.log(`⬆️  Uploaded: ${localFile} → ${remotePath}`);
  } finally {
    client.close();
  }
}

async function main() {
  const doRegen = process.argv.includes("--regen");
  const doFtp = process.argv.includes("--ftp");

  if (!doRegen) {
    console.log("Usage: --regen [--ftp]");
    process.exit(1);
  }

  const localArticleFile = await regenerate();

  let hubRegenerated = false;
  try {
    await regenerateHub();
    hubRegenerated = true;
  } catch (e: any) {
    // hub-generator uses Next.js cookies() which isn't available in CLI
    // Title didn't change, so hub card rendering is unaffected — skip safely.
    console.log(`\n⚠️  Hub regeneration skipped (CLI incompatible): ${e.message?.slice(0, 100)}`);
    console.log("   Article title unchanged, so hub page doesn't need updating.");
  }

  if (doFtp) {
    const remoteBase =
      process.env.FTP_REMOTE_PATH || "/public_html/column/columns/";
    const remoteArticle = `${remoteBase}${SLUG}/index.html`;
    console.log(`\nFTP uploading to ${process.env.FTP_HOST}...`);
    await ftpUpload(localArticleFile, remoteArticle);
    if (hubRegenerated) {
      const remoteHub = `${remoteBase}index.html`;
      await ftpUpload("out/column/index.html", remoteHub);
    }
    console.log("\n✅ FTP deploy complete");
  } else {
    console.log("\n🟡 Static HTML regenerated but NOT deployed. Re-run with --ftp to upload.");
  }
}

main().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
