import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
const envPath = path.resolve(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i === -1) continue;
  envVars[t.slice(0, i)] = t.slice(i + 1);
}
const supabase = createClient(envVars["NEXT_PUBLIC_SUPABASE_URL"], envVars["SUPABASE_SERVICE_ROLE_KEY"]);
(async () => {
  // OLD title: "人生の転換期の過ごし方。魂が愛と感謝に気づく物語"
  const { data: byTitle } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, theme, updated_at, published_at")
    .or("title.ilike.%転換期の過ごし方%,title.ilike.%魂が愛と感謝に気づく%,title.ilike.%転換期%")
    .order("article_number");
  console.log("=== candidates by OLD title ===");
  console.log(JSON.stringify(byTitle, null, 2));

  // Also: by new title keywords in case there's a dupe
  const { data: byNew } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, theme, updated_at")
    .or("title.ilike.%不安が続く時は人生の転換期%,title.ilike.%心の揺れが教えてくれる%")
    .order("article_number");
  console.log("\n=== candidates by NEW title ===");
  console.log(JSON.stringify(byNew, null, 2));

  // Check article_number=5 specifically (in case the leading "5." in user message = article_number=5)
  const { data: n5 } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, theme, updated_at")
    .eq("article_number", 5).single();
  console.log("\n=== article_number=5 ===");
  console.log(JSON.stringify(n5, null, 2));
})();
