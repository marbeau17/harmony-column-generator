// Quick textual diff: #54 stage3 vs user's provided new text
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const e = fs.readFileSync(".env.local","utf-8");
const v: Record<string,string> = {};
for (const l of e.split("\n")) { const t = l.trim(); if (!t||t.startsWith("#")) continue; const i = t.indexOf("="); if (i===-1) continue; v[t.slice(0,i)] = t.slice(i+1); }
const sb = createClient(v["NEXT_PUBLIC_SUPABASE_URL"], v["SUPABASE_SERVICE_ROLE_KEY"]);

// User's provided text — stripped to pure sentences for comparison
const USER_TEXT_SENTENCES = [
  "仕事、人間関係、お金、家庭。",
  "どれか一つでも負担になる出来事なのに、それが重なる時期というのがありますよね。",
  "環境が急に変わって、気持ちの整理が追いつかないまま夜を迎えてしまう。",
  "これまでうまくいっていたやり方が、急に通用しなくなることがあります。",
  "不安定な時期は、心の奥にあった感情が表に出てきやすくなります。",
  "水に触れたときの温度を感じる",
  "お茶の香りに気づいてみる",
  "Q. 不安やトラブルが続く時、最初に何をすればいいですか",
  "Q. マインドフルネスは忙しくてもできますか",
  "今の揺れも、そのまま次の方向へつながっていく途中かもしれません。",
];

(async () => {
  const { data } = await sb.from("articles").select("stage3_final_html, stage2_body_html").eq("id", "9d736012-8004-4d76-a482-a3616dfcff7f").single();
  // Strip HTML tags for comparison
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  const plain3 = stripHtml(data?.stage3_final_html ?? "");
  const plain2 = stripHtml(data?.stage2_body_html ?? "");

  console.log("=== Does #54 stage3 contain each user sentence? ===");
  for (const s of USER_TEXT_SENTENCES) {
    console.log(`  [${plain3.includes(s) ? "YES" : "NO "}] ${s.slice(0, 40)}`);
  }
  console.log("\n=== Does #54 stage2 contain each user sentence? ===");
  for (const s of USER_TEXT_SENTENCES) {
    console.log(`  [${plain2.includes(s) ? "YES" : "NO "}] ${s.slice(0, 40)}`);
  }

  // Same check against #23
  const { data: d23 } = await sb.from("articles").select("stage2_body_html, stage3_final_html").eq("id", "bbce2dc3-41d5-4fe8-9448-02dac77f060a").single();
  const plain23 = stripHtml((d23?.stage3_final_html ?? "") + " " + (d23?.stage2_body_html ?? ""));
  console.log("\n=== Does #23 stage2+stage3 contain each user sentence? ===");
  for (const s of USER_TEXT_SENTENCES) {
    console.log(`  [${plain23.includes(s) ? "YES" : "NO "}] ${s.slice(0, 40)}`);
  }
})();
