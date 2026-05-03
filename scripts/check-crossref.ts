import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const e = fs.readFileSync(".env.local","utf-8");
const v: Record<string,string> = {};
for (const l of e.split("\n")) { const t = l.trim(); if (!t||t.startsWith("#")) continue; const i = t.indexOf("="); if (i===-1) continue; v[t.slice(0,i)] = t.slice(i+1); }
const sb = createClient(v["NEXT_PUBLIC_SUPABASE_URL"], v["SUPABASE_SERVICE_ROLE_KEY"]);
(async () => {
  // Find any article whose related_articles references #23 or #54 slugs
  const { data: all } = await sb.from("articles").select("id, article_number, title, slug, related_articles").eq("status","published");
  const targetSlugs = ["life-stage-signs-love-tears", "mindfulness-daily-life"];
  for (const a of all ?? []) {
    if (!a.related_articles) continue;
    const txt = JSON.stringify(a.related_articles);
    for (const ts of targetSlugs) {
      if (txt.includes(ts)) {
        console.log(`#${a.article_number} (${a.slug}) → related includes ${ts}`);
      }
    }
  }
  // Also check if #23/#54 themselves reference each other or have related
  for (const id of ["bbce2dc3-41d5-4fe8-9448-02dac77f060a", "9d736012-8004-4d76-a482-a3616dfcff7f"]) {
    const { data } = await sb.from("articles").select("article_number, slug, related_articles").eq("id", id).single();
    console.log(`\n#${data?.article_number} (${data?.slug}) related_articles:`, JSON.stringify(data?.related_articles));
  }
})();
