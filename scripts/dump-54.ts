import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const e = fs.readFileSync(".env.local","utf-8");
const v: Record<string,string> = {};
for (const l of e.split("\n")) { const t = l.trim(); if (!t||t.startsWith("#")) continue; const i = t.indexOf("="); if (i===-1) continue; v[t.slice(0,i)] = t.slice(i+1); }
const sb = createClient(v["NEXT_PUBLIC_SUPABASE_URL"], v["SUPABASE_SERVICE_ROLE_KEY"]);
(async () => {
  const { data } = await sb.from("articles").select("*").eq("id", "9d736012-8004-4d76-a482-a3616dfcff7f").single();
  console.log("article_number:", data?.article_number);
  console.log("title:", data?.title);
  console.log("slug:", data?.slug);
  console.log("status:", data?.status);
  console.log("theme:", data?.theme);
  console.log("persona:", data?.persona);
  console.log("meta:", data?.meta_description);
  console.log("keyword:", data?.keyword);
  console.log("stage2 len:", data?.stage2_body_html?.length);
  console.log("stage3 len:", data?.stage3_final_html?.length);
  console.log("published len:", data?.published_html?.length);
  console.log("reviewed_at:", data?.reviewed_at);
  console.log("updated_at:", data?.updated_at);
  console.log("\n=== stage3 first 1800 ===\n", data?.stage3_final_html?.slice(0, 1800));
  console.log("\n=== stage3 last 600 ===\n", data?.stage3_final_html?.slice(-600));
})();
