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

async function inspect(id: string, label: string) {
  const { data, error } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, meta_description, theme, updated_at, published_at, stage2_body_html, stage3_final_html, published_html")
    .eq("id", id).single();
  if (error || !data) { console.error(error); return; }
  console.log(`\n========== ${label} (#${data.article_number} / ${data.slug}) ==========`);
  console.log(`status: ${data.status}  updated: ${data.updated_at}  published: ${data.published_at}`);
  console.log(`meta: ${data.meta_description?.slice(0, 120)}`);
  console.log(`stage2 len: ${data.stage2_body_html?.length ?? 0}`);
  console.log(`stage3 len: ${data.stage3_final_html?.length ?? 0}`);
  console.log(`published len: ${data.published_html?.length ?? 0}`);
  console.log(`--- stage3 first 1200 chars ---`);
  console.log((data.stage3_final_html ?? "").slice(0, 1200));
  console.log(`\n--- stage3 last 600 chars ---`);
  console.log((data.stage3_final_html ?? "").slice(-600));

  const { data: rev } = await supabase
    .from("article_revisions")
    .select("id, revision_number, change_type, comment, created_at")
    .eq("article_id", id)
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(`--- revisions (${rev?.length ?? 0}) ---`);
  console.log(JSON.stringify(rev, null, 2));
}

(async () => {
  await inspect("f868c2c7-4718-41b7-8dce-cbfe7f1e02c6", "Candidate A: #10 spiritual-healing-pet-loss");
  await inspect("ffbcbf7b-dc8f-43fb-890c-34d61b67f21b", "Candidate B: #36 pet-loss-spiritual-meaning");
})();
