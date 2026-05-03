import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
}
const supabase = createClient(envVars["NEXT_PUBLIC_SUPABASE_URL"], envVars["SUPABASE_SERVICE_ROLE_KEY"]);

async function main() {
  // Search for pet loss / grief / ペットロス related articles
  const { data: petArticles } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, theme, updated_at, published_at")
    .or("title.ilike.%ペット%,title.ilike.%grief%,slug.ilike.%grief%,slug.ilike.%pet%,title.ilike.%ロス%")
    .order("article_number");
  console.log("=== PET/GRIEF ARTICLES ===");
  console.log(JSON.stringify(petArticles, null, 2));

  // Also list first 10 by article_number to understand numbering
  const { data: firstTen } = await supabase
    .from("articles")
    .select("article_number, title, slug, status")
    .order("article_number")
    .limit(10);
  console.log("\n=== FIRST 10 BY article_number ===");
  console.log(JSON.stringify(firstTen, null, 2));

  // First 5 published sorted by published_at desc (dashboard default?)
  const { data: pubRecent } = await supabase
    .from("articles")
    .select("article_number, title, slug, status, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5);
  console.log("\n=== 5 MOST RECENT PUBLISHED ===");
  console.log(JSON.stringify(pubRecent, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
