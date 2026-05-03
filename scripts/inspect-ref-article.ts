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
  // Reference: pick a recently published grief_care article OTHER than #10
  const { data } = await supabase
    .from("articles")
    .select("id, article_number, title, slug, status, theme, meta_description, cta_texts, stage2_body_html, stage3_final_html")
    .eq("article_number", 4).single();
  console.log("=== REFERENCE: #4 pet-loss-recovery-spiritual ===");
  console.log(`title: ${data?.title}`);
  console.log(`meta: ${data?.meta_description}`);
  console.log(`cta_texts:`, JSON.stringify(data?.cta_texts, null, 2));
  console.log(`\n--- stage3 full ---\n${data?.stage3_final_html}`);
})();
