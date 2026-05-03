import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const e = fs.readFileSync(".env.local","utf-8");
const v: Record<string,string> = {};
for (const l of e.split("\n")) { const t = l.trim(); if (!t||t.startsWith("#")) continue; const i = t.indexOf("="); if (i===-1) continue; v[t.slice(0,i)] = t.slice(i+1); }
const sb = createClient(v["NEXT_PUBLIC_SUPABASE_URL"], v["SUPABASE_SERVICE_ROLE_KEY"]);
(async () => {
  for (const [label, id] of [["#23", "bbce2dc3-41d5-4fe8-9448-02dac77f060a"], ["#54", "9d736012-8004-4d76-a482-a3616dfcff7f"]] as const) {
    const { data: a } = await sb.from("articles").select("source_article_id, perspective_type").eq("id", id).single();
    console.log(`${label} source_article_id: ${a?.source_article_id} perspective: ${a?.perspective_type}`);
    if (a?.source_article_id) {
      const { data: src } = await sb.from("source_articles").select("id, title, themes, usage_count").eq("id", a.source_article_id).single();
      console.log(`  → source: "${src?.title}" themes=${src?.themes} usage_count=${src?.usage_count}`);
    }
  }
})();
