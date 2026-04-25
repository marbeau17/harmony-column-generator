/**
 * Recovery script for article #10 (spiritual-healing-pet-loss) after accidental
 * overwrite by Claude. Follows HTML history rule:
 *   1. Saves current stage3_final_html to article_revisions (change_type='overwrite_recovery')
 *   2. Only if revision INSERT succeeds, UPDATEs article with corrected HTML
 *
 * Usage:
 *   npx tsx scripts/recover-article-10.ts --dry-run   (default: prints new HTML, no writes)
 *   npx tsx scripts/recover-article-10.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { insertTocIntoHtml } from "../src/lib/content/toc-generator";
import { insertCtasIntoHtml, selectCtaTexts } from "../src/lib/content/cta-generator";

const envPath = path.resolve(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  envVars[t.slice(0, i)] = t.slice(i + 1);
}
const supabase = createClient(
  envVars["NEXT_PUBLIC_SUPABASE_URL"],
  envVars["SUPABASE_SERVICE_ROLE_KEY"]
);

const ARTICLE_ID = "f868c2c7-4718-41b7-8dce-cbfe7f1e02c6"; // #10
const NEW_TITLE = "ペットロスのスピリチュアルな意味｜深い悲しみの中にある魂からのメッセージ";
const NEW_META =
  "愛したからこそ深くなるペットロスの悲しみ。スピリチュアルな視点から、最期にあの子の魂に残るのは愛された記憶であること、肉体を離れても絆は終わらないことをお伝えします。涙を我慢しなくていい理由と、残された愛と共に歩き出すためのやさしい道しるべ。";

// ─── 本文セクション定義 ──────────────────────────────────────────────────────
// paragraphs[i] は 1つの <p> 内に入る行配列（行間は <br> で結合）

interface Section {
  heading: string | null; // null = intro (no H2)
  paragraphs: string[][];
}

const INTRO_BLOCK: Section = {
  heading: null,
  paragraphs: [
    ["大切な家族との突然の別れ。", "その喪失は、言葉では言い表せないほど深い悲しみをもたらします。"],
    [
      "いつもいた場所に、もう姿がない。",
      "名前を呼んでも返事はない。",
      "そんな現実に、心が追いつかない日もあるでしょう。",
    ],
    [
      "けれど、ペットロスのスピリチュアルな意味を知ることで、",
      "この別れの見え方は少しずつ変わっていきます。",
    ],
    [
      "今はただ苦しいだけに感じるこの時間も、",
      "やがて愛を受け取り直す大切な時間へと変わっていくのです。",
    ],
  ],
};

const SECTIONS: Section[] = [
  {
    heading: "止まらない涙には意味があります",
    paragraphs: [
      ["涙が止まらないのは、弱いからではありません。"],
      ["それほどまでに深く愛していた証です。"],
      ["大切な存在を失ったとき、", "心が痛むのは自然なことです。"],
      [
        "無理に元気になろうとしなくて大丈夫です。",
        "早く立ち直らなければと思わなくて大丈夫です。",
      ],
      ["その涙は、", "あの子との時間が本物だった証でもあります。"],
    ],
  },
  {
    heading: "愛したからこそ、喪失は深くなる",
    paragraphs: [
      ["どうしてこんなにも苦しいのでしょうか。"],
      [
        "それは、あの子がただのペットではなく、",
        "心の一部になっていた存在だからです。",
      ],
      [
        "毎日を共に過ごし、",
        "言葉がなくても通じ合い、",
        "そばにいるだけで安心できた。",
      ],
      ["そんな存在を失えば、", "心に大きな穴が空くのは当然です。"],
      ["悲しみの大きさは、", "愛の大きさでもあります。"],
    ],
  },
  {
    heading: "最期の時間にあの子が感じていたこと",
    paragraphs: [
      [
        "もっと何かできたのではないか。",
        "あのとき違う選択をしていればよかったのではないか。",
      ],
      ["そうした後悔に苦しむ方は少なくありません。"],
      ["けれど、どうか自分を責めないでください。"],
      [
        "スピリチュアルな視点では、",
        "動物たちの魂に最後まで残るのは、苦しみよりも愛された記憶だと考えられています。",
      ],
      [
        "抱きしめてもらったぬくもり。",
        "優しく名前を呼んでもらった声。",
        "一緒に過ごした安心できる日々。",
      ],
      ["あの子の中に残っているのは、", "そうしたあたたかな愛の記憶です。"],
    ],
  },
  {
    heading: "ペットロスのスピリチュアルな意味とは",
    paragraphs: [
      [
        "ペットロスのスピリチュアルな意味は、",
        "愛の終わりではなく、愛の形が変わることに気づくプロセスです。",
      ],
      ["姿が見えなくなっても、", "絆まで消えるわけではありません。"],
      ["この別れを通して私たちは、"],
      ["愛するとはどういうことか"],
      ["命とは何か"],
      ["本当に大切なものは何か"],
      ["を深く学ぶことになります。"],
      ["その学びもまた、", "魂の成長のひとつなのです。"],
    ],
  },
  {
    heading: "出会いには魂の約束があるという考え方",
    paragraphs: [
      ["スピリチュアルでは、", "大切な出会いには意味があると考えられています。"],
      ["あの子があなたの元へ来たこと。", "共に過ごした時間。", "深く愛し合えたこと。"],
      ["それは偶然ではなく、", "魂の約束だったという捉え方があります。"],
      ["もしそうだとしたら、", "別れは失敗ではありません。"],
      ["その約束を果たし終えたからこその旅立ちです。"],
      [
        "あの子は、",
        "あなたに愛を教えるという役目を終え、",
        "誇りを持って次の場所へ進んだのかもしれません。",
      ],
    ],
  },
  {
    heading: "肉体を離れても絆は終わらない",
    paragraphs: [
      ["姿が見えなくなっても、", "絆が消えることはありません。"],
      [
        "ふと気配を感じる。",
        "夢に出てくる。",
        "思い出した瞬間に、悲しみよりもあたたかさを感じる。",
      ],
      ["そうした体験をする方は少なくありません。"],
      ["目には見えなくても、", "愛のつながりは形を変えて続いていきます。"],
      ["あの子との絆は、", "これからもあなたの中で生き続けていくのです。"],
    ],
  },
  {
    heading: "悲しみとともに生きるという癒しの形",
    paragraphs: [
      ["癒しとは、忘れることではありません。"],
      ["思い出しても平気になることでもありません。"],
      [
        "本当の癒しとは、",
        "悲しみを抱えたままでも生きていけるようになることです。",
      ],
      ["会いたいと思ってもいい。", "思い出して泣いてもいい。"],
      ["その感情を否定しないことが、", "少しずつ心を整えていきます。"],
    ],
  },
  {
    heading: "涙を我慢しなくていい理由",
    paragraphs: [
      ["泣いてばかりでは前に進めない。", "泣くとあの子が心配するかもしれない。"],
      ["そう思う方もいます。"],
      ["けれど、涙は愛の証です。"],
      ["悲しみを抑え込んでも、", "心から消えるわけではありません。"],
      ["涙は、", "心の奥に溜まった痛みを洗い流してくれるものです。"],
      ["泣けるうちは、", "思いきり泣いて大丈夫です。"],
    ],
  },
  {
    heading: "残された愛はこれからもあなたを支える",
    paragraphs: [
      ["あの子は姿を変えても、", "残した愛は消えていません。"],
      ["その愛はこれからも、", "何度でもあなたを支えてくれます。"],
      ["苦しいとき。", "寂しいとき。", "立ち止まりそうなとき。"],
      [
        "思い出すだけで心があたたかくなるなら、",
        "それは今もなお生き続けている愛です。",
      ],
      ["別れは終わりではありません。"],
      ["愛した時間は、", "これからもずっとあなたの中で生き続けます。"],
    ],
  },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────

interface Faq {
  q: string;
  a: string[]; // lines joined with <br>
}

const FAQS: Faq[] = [
  {
    q: "Q. ペットは最期、苦しかったのでしょうか。幸せだったのか不安です。",
    a: [
      "A.",
      "スピリチュアルな視点では、最期に魂に残るのは苦しみよりも愛された記憶だと考えられています。",
      "あなたと過ごした安心できる日々、注がれた愛情、それこそがあの子にとっての宝物です。",
      "どうか、その愛はしっかり届いていたと信じてください。",
    ],
  },
  {
    q: "Q. いつまでも泣いていたら成仏できないのではと心配です。",
    a: [
      "A.",
      "涙は愛の証であり、悪いものではありません。",
      "悲しみを感じることと、相手を縛ることは別です。",
      "無理に抑え込むより、しっかり悲しみ切ることが心を整えることにつながります。",
    ],
  },
  {
    q: "Q. もう一度あの子とつながることはできますか。",
    a: [
      "A.",
      "姿は見えなくても、絆がなくなるわけではありません。",
      "夢の中、ふとした気配、思い出した瞬間のあたたかさ。",
      "そうした日常の中に、あの子からの愛を感じることはあります。",
    ],
  },
];

// ─── クロージング ────────────────────────────────────────────────────────────

const CLOSING: string[][] = [
  ["悲しみがすぐに消えることはありません。"],
  [
    "けれど、",
    "涙の奥にある愛に気づけたとき、",
    "その悲しみは少しずつやさしいぬくもりへと変わっていきます。",
  ],
  ["あの子がくれた愛は、", "これからもずっとあなたの中に生き続けます。"],
  [
    "その愛とともに、",
    "少しずつ、また歩き出していけますように。",
  ],
];

// ─── HTML builders ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderParagraph(lines: string[]): string {
  return `<p>${lines.map(escapeHtml).join("<br>\n")}</p>`;
}

function renderSection(sec: Section): string {
  const parts: string[] = [];
  if (sec.heading) {
    parts.push(`<h2>${escapeHtml(sec.heading)}</h2>`);
  }
  for (const para of sec.paragraphs) {
    parts.push(renderParagraph(para));
  }
  return parts.join("\n\n");
}

function renderFaq(f: Faq): string {
  return `<div class="harmony-faq">\n<h3>${escapeHtml(f.q)}</h3>\n<p>${f.a
    .map(escapeHtml)
    .join("<br>\n")}</p>\n</div>`;
}

function buildBodyHtml(): string {
  const parts: string[] = [];

  // Intro (no heading, before first H2)
  for (const para of INTRO_BLOCK.paragraphs) {
    parts.push(renderParagraph(para));
  }

  // Main H2 sections
  for (const sec of SECTIONS) {
    parts.push(renderSection(sec));
  }

  // Q&A H2
  parts.push(`<h2>Q&amp;A</h2>`);
  for (const f of FAQS) {
    parts.push(renderFaq(f));
  }

  // Closing paragraphs
  for (const para of CLOSING) {
    parts.push(renderParagraph(para));
  }

  return parts.join("\n\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function fetchCurrent() {
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id, article_number, title, slug, theme, meta_description, stage2_body_html, stage3_final_html, published_html"
    )
    .eq("id", ARTICLE_ID)
    .single();
  if (error || !data) throw error ?? new Error("not found");
  return data;
}

async function saveRevision(current: any): Promise<void> {
  const { data: existingRevs } = await supabase
    .from("article_revisions")
    .select("revision_number")
    .eq("article_id", ARTICLE_ID)
    .order("revision_number", { ascending: false })
    .limit(1);
  const nextRev =
    existingRevs && existingRevs.length > 0
      ? (existingRevs[0].revision_number ?? 0) + 1
      : 1;

  const bodyToSave =
    current.stage3_final_html || current.stage2_body_html || "";
  if (!bodyToSave) {
    console.warn(
      "⚠️  Current body is empty — saving empty revision to preserve the fact that it was empty"
    );
  }

  // Existing DB schema uses html_snapshot + comment(JSON-packed meta), not body_html
  const comment = JSON.stringify({
    title: current.title,
    meta_description: current.meta_description,
  });
  const { error } = await supabase.from("article_revisions").insert({
    article_id: ARTICLE_ID,
    revision_number: nextRev,
    html_snapshot: bodyToSave,
    change_type: "overwrite_recovery",
    changed_by: "script:recover-article-10",
    comment,
  });
  if (error) throw error;
  console.log(
    `✅ Revision #${nextRev} saved (change_type=overwrite_recovery, html_snapshot length=${bodyToSave.length})`
  );
}

async function applyUpdate(newStage3: string, newBodyOnly: string) {
  const { error } = await supabase
    .from("articles")
    .update({
      title: NEW_TITLE,
      meta_description: NEW_META,
      stage2_body_html: newBodyOnly,
      stage3_final_html: newStage3,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ARTICLE_ID);
  if (error) throw error;
  console.log(`✅ Article #10 updated (title, meta, stage2, stage3)`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`Mode: ${mode}\n`);

  const current = await fetchCurrent();
  console.log(`Current article:`);
  console.log(`  article_number: ${current.article_number}`);
  console.log(`  slug: ${current.slug}`);
  console.log(`  title: ${current.title}`);
  console.log(`  theme: ${current.theme}`);
  console.log(`  stage3 length: ${current.stage3_final_html?.length ?? 0}\n`);

  // Build new body
  const bodyOnly = buildBodyHtml();
  console.log(`Body (pre-TOC/CTA) length: ${bodyOnly.length}`);

  // Add TOC
  const withToc = insertTocIntoHtml(bodyOnly);
  console.log(`With TOC length: ${withToc.length}`);

  // Add CTAs (CTA2 mid, CTA3 end) — theme=grief_care
  const ctaTexts = selectCtaTexts(current.theme || "grief_care", ARTICLE_ID);
  console.log(`CTA texts: cta2="${ctaTexts.cta2.catch}", cta3="${ctaTexts.cta3.catch}"`);
  const withCta = insertCtasIntoHtml(withToc, ctaTexts, current.slug || "spiritual-healing-pet-loss");
  console.log(`Final stage3 length: ${withCta.length}\n`);

  // Dry-run: dump output files for inspection
  const outDir = path.resolve(__dirname, "../tmp/article-10-preview");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "body-only.html"), bodyOnly);
  fs.writeFileSync(path.join(outDir, "stage3-final.html"), withCta);
  console.log(`📄 Preview written to: ${outDir}/`);
  console.log(`   - body-only.html (before TOC/CTA)`);
  console.log(`   - stage3-final.html (with TOC + CTA2 + CTA3)\n`);

  if (!apply) {
    console.log("🟡 DRY-RUN: no DB writes performed. Re-run with --apply to commit.");
    return;
  }

  // APPLY: save revision FIRST, then update
  console.log("Saving revision history…");
  await saveRevision(current);

  console.log("Updating article…");
  await applyUpdate(withCta, bodyOnly);

  console.log(`\n✅ Done. Article #10 replaced. Revision history preserved.`);
  console.log(`Next step: regenerate static HTML (scripts/regenerate-all-html.ts or similar) then redeploy via FTP (with your approval).`);
}

main().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
