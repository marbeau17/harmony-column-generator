/**
 * 最新 zero-gen 記事の画像状態確認 (read-only)
 *  - stage2_body_html 内の <img> タグ数
 *  - image_files (JSON 配列) 件数
 *  - position (hero/body/summary) 分布
 *  - stage2 に <img> が無いのに image_files に URL がある = run-completion が画像置換できなかった
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const env = fs.readFileSync(
  "/Users/yasudaosamu/Desktop/codes/blogauto/.env.local",
  "utf-8",
);
const v: Record<string, string> = {};
for (const l of env.split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  v[t.slice(0, i)] = t.slice(i + 1);
}
const sb = createClient(
  v["NEXT_PUBLIC_SUPABASE_URL"],
  v["SUPABASE_SERVICE_ROLE_KEY"],
);

(async () => {
  const { data: arts, error } = await sb
    .from("articles")
    .select(
      "id, article_number, slug, title, status, generation_mode, stage2_body_html, image_files, created_at",
    )
    .eq("generation_mode", "zero")
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    console.error("ERR:", error);
    process.exit(1);
  }
  if (!arts || arts.length === 0) {
    console.log("No zero-gen articles found");
    process.exit(0);
  }

  console.log(`zero-gen 直近 ${arts.length} 件\n`);

  console.log("| slug | id | stage2 <img> | image_files | positions | 置換状態 |");
  console.log("|---|---|---|---|---|---|");

  type Row = {
    slug: string;
    id: string;
    title: string;
    imgCount: number;
    fileCount: number;
    positions: string[];
    status: string;
    created: string;
    suspicious: boolean;
  };
  const rows: Row[] = [];

  for (const a of arts) {
    const slug = a.slug || `id-${a.id.slice(0, 8)}`;
    const stage2 = a.stage2_body_html || "";
    const imgMatches = stage2.match(/<img\b[^>]*>/gi) || [];
    const imgCount = imgMatches.length;

    let fileCount = 0;
    let positions: string[] = [];
    try {
      const raw = (a as { image_files?: unknown }).image_files;
      const parsed = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
      if (Array.isArray(parsed)) {
        fileCount = parsed.length;
        positions = parsed.map((x: unknown) => {
          if (typeof x === "object" && x !== null) {
            const o = x as Record<string, unknown>;
            return String(o.position ?? o.kind ?? o.role ?? "?");
          }
          return "?";
        });
      }
    } catch {
      // ignore
    }

    let state: string;
    if (fileCount > 0 && imgCount === 0) state = "未置換 (異常)";
    else if (fileCount === imgCount && fileCount > 0) state = "OK";
    else if (fileCount === 0 && imgCount === 0) state = "画像未生成";
    else state = `不一致(file=${fileCount}, img=${imgCount})`;

    const suspicious = fileCount > 0 && imgCount === 0;

    rows.push({
      slug,
      id: a.id,
      title: a.title || "",
      imgCount,
      fileCount,
      positions,
      status: a.status,
      created: a.created_at,
      suspicious,
    });

    console.log(
      `| ${slug} | ${a.id} | ${imgCount} | ${fileCount} | ${positions.join(",") || "-"} | ${state} |`,
    );
  }

  console.log("\n=== detail ===");
  for (const r of rows) {
    console.log(
      `- id=${r.id} slug=${r.slug} title="${r.title}" status=${r.status} created=${r.created}`,
    );
    if (r.suspicious) {
      console.log(`  ★ SUSPICIOUS: stage2 に <img> 0 だが image_files=${r.fileCount}`);
    }
  }

  console.log("\n=== SUSPICIOUS ids ===");
  const susp = rows.filter((r) => r.suspicious);
  if (susp.length === 0) console.log("(なし)");
  else for (const r of susp) console.log(r.id);
})();
