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
  const { data } = await supabase.from("articles")
    .select("article_number, title, slug, updated_at, stage2_body_html, stage3_final_html, meta_description")
    .eq("id", "f868c2c7-4718-41b7-8dce-cbfe7f1e02c6").single();
  console.log("stage2 length:", data?.stage2_body_html?.length);
  console.log("stage3 length:", data?.stage3_final_html?.length);
  console.log("updated_at:", data?.updated_at);
  console.log("title:", data?.title);
  console.log("meta:", data?.meta_description?.slice(0, 120) + "...");

  const { data: revs } = await supabase.from("article_revisions")
    .select("revision_number, change_type, changed_by, html_snapshot, comment, created_at")
    .eq("article_id", "f868c2c7-4718-41b7-8dce-cbfe7f1e02c6")
    .order("revision_number", { ascending: false });
  console.log("\nrevisions:", revs?.length);
  for (const r of revs || []) {
    console.log(`  rev#${r.revision_number}  ${r.change_type}  by=${r.changed_by}  len=${r.html_snapshot?.length}  comment=${r.comment?.slice(0,100)}`);
  }
})();
