// Recovery script: restore article No.1 content after accidental Claude overwrite.
// Follows HTML history rule: saves current HTML to article_revisions BEFORE update.

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

const supabase = createClient(
  envVars["NEXT_PUBLIC_SUPABASE_URL"],
  envVars["SUPABASE_SERVICE_ROLE_KEY"]
);

async function main() {
  const { data, error } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, meta_description, theme, persona, target_word_count, updated_at, published_at, reviewed_at, cta_texts, stage2_body_html, stage3_final_html, published_html")
    .eq("article_number", 1)
    .single();
  if (error) throw error;
  if (!data) throw new Error("Article #1 not found");

  console.log("=== ARTICLE #1 CURRENT STATE ===");
  console.log(`id: ${data.id}`);
  console.log(`slug: ${data.slug}`);
  console.log(`title: ${data.title}`);
  console.log(`status: ${data.status}`);
  console.log(`meta: ${data.meta_description}`);
  console.log(`theme: ${data.theme}`);
  console.log(`persona: ${data.persona}`);
  console.log(`updated_at: ${data.updated_at}`);
  console.log(`published_at: ${data.published_at}`);
  console.log(`reviewed_at: ${data.reviewed_at}`);
  console.log(`stage2_body_html length: ${data.stage2_body_html?.length ?? 0}`);
  console.log(`stage3_final_html length: ${data.stage3_final_html?.length ?? 0}`);
  console.log(`published_html length: ${data.published_html?.length ?? 0}`);
  console.log(`cta_texts: ${JSON.stringify(data.cta_texts)?.slice(0, 200)}`);

  console.log("\n=== stage3_final_html first 800 chars ===");
  console.log((data.stage3_final_html ?? "").slice(0, 800));
  console.log("\n=== stage3_final_html last 400 chars ===");
  console.log((data.stage3_final_html ?? "").slice(-400));

  const { data: rev, error: revErr } = await supabase
    .from("article_revisions")
    .select("id, revision_number, change_type, comment, created_at")
    .eq("article_id", data.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (revErr) throw revErr;
  console.log("\n=== EXISTING REVISIONS ===");
  console.log(JSON.stringify(rev, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
