import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load env vars manually from .env.local
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

const supabaseUrl = envVars["NEXT_PUBLIC_SUPABASE_URL"];
const supabaseKey = envVars["SUPABASE_SERVICE_ROLE_KEY"];
const supabase = createClient(supabaseUrl, supabaseKey);

const OUT_DIR = path.resolve(__dirname, "../out/column");

interface Fix {
  slug: string;
  description: string;
  apply: (html: string) => string;
}

const fixes: Fix[] = [
  {
    slug: "messages-signs-from-deceased",
    description: "Fix truncated CTA link (stage2 ends with &a, stage3 has &amp; encoding)",
    apply: (html) => {
      const ctaReplacement = `<div class="harmony-cta harmony-cta-3" data-cta-position="end" data-cta-key="cta3"><div class="harmony-cta-inner"><div class="harmony-cta-badge">ご予約はこちら</div><p class="harmony-cta-catch">大切な方からのメッセージを受け取る時間を</p><p class="harmony-cta-sub">あなたの心に寄り添うカウンセリングをご提供しています</p><a href="https://harmony-booking.web.app/?utm_source=column&utm_medium=cta&utm_campaign=messages-signs-from-deceased&utm_content=cta3_conversion" class="harmony-cta-btn" target="_blank" rel="noopener">カウンセリングを予約する</a></div></div>`;

      // Pattern 1: stage2_body_html - truncated at &a (content cut off at end)
      // The broken part starts from an incomplete CTA div. Find the last <div class="harmony-cta that has the broken link
      // The actual content ends with: <a href="https://harmony-booking.web.app/?utm_source=column&a
      const truncatedEnd = /\n\s*<a href="https:\/\/harmony-booking\.web\.app\/\?utm_source=column&a$/;
      if (truncatedEnd.test(html)) {
        // Find the start of this broken CTA block
        // It starts with <div class="harmony-cta harmony-cta-3" ...> or similar
        const ctaStartRegex = /<div class="harmony-cta[^"]*"[^>]*data-cta-key="cta3"[^>]*>[\s\S]*?<a href="https:\/\/harmony-booking\.web\.app\/\?utm_source=column&a$/;
        const match = html.match(ctaStartRegex);
        if (match) {
          return html.replace(match[0], ctaReplacement);
        }
        // Fallback: just replace from the broken <a> tag to end
        return html.replace(/\n\s*<a href="https:\/\/harmony-booking\.web\.app\/\?utm_source=column&a$/, "\n" + ctaReplacement);
      }

      // Pattern 2: stage3_final_html or out/ file - might have &amp; encoded version
      // Check for the broken pattern with HTML entities
      const brokenAmpPattern = `<a href="https://harmony-booking.web.app/?utm_source=column&a</div>`;
      if (html.includes(brokenAmpPattern)) {
        return html.replace(brokenAmpPattern, ctaReplacement);
      }

      // Pattern 3: the out/ HTML file might have the full correct link already from stage3
      // but check for any truncated booking link
      const truncatedBooking = /<a href="https:\/\/harmony-booking\.web\.app\/\?utm_source=column&a[^"]*"?/;
      if (truncatedBooking.test(html)) {
        console.log(`  Found truncated booking link via regex`);
        // Replace the entire broken CTA section
        const brokenSection = /<div class="harmony-cta[^"]*"[^>]*data-cta-key="cta3"[^>]*>[\s\S]*?<a href="https:\/\/harmony-booking\.web\.app\/\?utm_source=column&a[^"]*"?[^>]*>[^<]*<\/a>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
        if (brokenSection.test(html)) {
          return html.replace(brokenSection, ctaReplacement);
        }
      }

      console.warn(`  [WARN] No matching broken pattern found`);
      return html;
    },
  },
  {
    slug: "mindfulness-daily-life",
    description: "Fix truncated disclaimer",
    apply: (html) => {
      const truncated = `※心身の不調が続く場合は、無理をせず専門の`;
      const full = `※心身の不調が続く場合は、無理をせず専門の医療機関や心理カウンセラーにご相談されることをお勧めいたします。`;
      if (!html.includes(truncated)) {
        console.warn(`  [WARN] Truncated disclaimer not found. Skipping.`);
        return html;
      }
      return html.replace(truncated, full);
    },
  },
  {
    slug: "new-moon-wish-examples",
    description: "Fix truncated disclaimer",
    apply: (html) => {
      const truncated = `※スピリチュアルカウンセリングは心身の深い不調など、医療的なお悩みは専門の`;
      const full = `※スピリチュアルカウンセリングは心身の深い不調など、医療的なお悩みは専門の医療機関へのご相談をお勧めしております。スピリチュアルな視点からの気づきを大切にしながら、必要に応じて適切な専門家のサポートも受けてください。`;
      if (!html.includes(truncated)) {
        console.warn(`  [WARN] Truncated disclaimer not found. Skipping.`);
        return html;
      }
      return html.replace(truncated, full);
    },
  },
  {
    slug: "self-reiki-beginner-guide",
    description: "Fix truncated FAQ answer",
    apply: (html) => {
      const faqQuestion = `Q. 何も感じない時は、どうすればよいですか？`;
      if (!html.includes(faqQuestion)) {
        console.warn(`  [WARN] Truncated FAQ question not found. Skipping.`);
        return html;
      }
      const idx = html.indexOf(faqQuestion);
      const afterQuestion = html.substring(idx + faqQuestion.length);

      // Check if there's already a proper answer following
      if (afterQuestion.trimStart().startsWith("</h3>") && afterQuestion.includes("A. 何も感じないこと")) {
        console.warn(`  [WARN] FAQ already has answer. Skipping.`);
        return html;
      }

      const answer = `</h3><p>A. 何も感じないことは、決して悪いことではありません。エネルギーの感じ方は人それぞれ。手を当てている間の温かさや、終わった後のほっとした気持ちなど、小さな変化に目を向けてみてください。焦らず、ご自分のペースで続けていくことが大切です。</p></div>`;

      // Match the h3 containing the question - it may be truncated (no closing tag)
      const h3Regex = /<h3[^>]*>Q\. 何も感じない時は、どうすればよいですか？[^]*/;
      const h3Match = html.match(h3Regex);
      if (h3Match) {
        const fullMatch = h3Match[0];
        const h3Open = fullMatch.match(/<h3[^>]*>/)?.[0] || "<h3>";
        // If content after question is very short (truncated), replace everything after question
        const contentAfterQ = fullMatch.substring(h3Open.length + faqQuestion.length);
        if (contentAfterQ.trim().length < 50) {
          // Truncated - replace entire match
          return html.replace(fullMatch, `${h3Open}${faqQuestion}${answer}`);
        }
      }

      // Fallback
      return html.replace(faqQuestion, faqQuestion + answer);
    },
  },
  {
    slug: "life-stage-signs-love-tears",
    description: "Remove empty CTA wrappers (with whitespace inside)",
    apply: (html) => {
      // Match <div class="harmony-cta"> with only whitespace inside </div>
      // The actual pattern in DB/files is: <div class="harmony-cta">\n  \n</div>
      const emptyCtaRegex = /<div class="harmony-cta">\s*<\/div>/g;
      const before = html;
      html = html.replace(emptyCtaRegex, "");
      // Also clean up resulting double blank lines
      html = html.replace(/\n{3,}/g, "\n\n");
      if (html === before) {
        console.warn(`  [WARN] Empty CTA wrappers not found. Skipping.`);
      }
      return html;
    },
  },
];

async function main() {
  console.log("=== Fix Remaining 5 Articles ===\n");

  for (const fix of fixes) {
    console.log(`[${fix.slug}] ${fix.description}`);

    // Fetch article from DB
    const { data: article, error } = await supabase
      .from("articles")
      .select("id, slug, stage2_body_html, stage3_final_html")
      .eq("slug", fix.slug)
      .single();

    if (error || !article) {
      console.error(`  ERROR: Could not fetch article: ${error?.message}`);
      continue;
    }

    // Determine which field(s) to update
    const fieldsToUpdate: Record<string, string> = {};
    let dbChanged = false;

    if (article.stage3_final_html) {
      const fixed = fix.apply(article.stage3_final_html);
      if (fixed !== article.stage3_final_html) {
        fieldsToUpdate["stage3_final_html"] = fixed;
        dbChanged = true;
        console.log(`  DB: stage3_final_html updated`);
      } else {
        console.log(`  DB: stage3_final_html - no change`);
      }
    }

    if (article.stage2_body_html) {
      const fixed = fix.apply(article.stage2_body_html);
      if (fixed !== article.stage2_body_html) {
        fieldsToUpdate["stage2_body_html"] = fixed;
        dbChanged = true;
        console.log(`  DB: stage2_body_html updated`);
      } else {
        console.log(`  DB: stage2_body_html - no change`);
      }
    }

    if (!dbChanged) {
      console.log(`  DB: No changes needed`);
    } else {
      const { error: updateError } = await supabase
        .from("articles")
        .update(fieldsToUpdate)
        .eq("id", article.id);

      if (updateError) {
        console.error(`  DB UPDATE ERROR: ${updateError.message}`);
      } else {
        console.log(`  DB: Updated successfully (${Object.keys(fieldsToUpdate).join(", ")})`);
      }
    }

    // Fix the out/ HTML file
    const htmlPath = path.join(OUT_DIR, fix.slug, "index.html");
    if (fs.existsSync(htmlPath)) {
      const htmlContent = fs.readFileSync(htmlPath, "utf-8");
      const fixedHtml = fix.apply(htmlContent);
      if (fixedHtml !== htmlContent) {
        fs.writeFileSync(htmlPath, fixedHtml, "utf-8");
        console.log(`  FILE: ${htmlPath} updated`);
      } else {
        console.log(`  FILE: No changes needed`);
      }
    } else {
      console.warn(`  FILE: ${htmlPath} not found`);
    }

    console.log();
  }

  console.log("=== Done ===");
}

main().catch(console.error);
