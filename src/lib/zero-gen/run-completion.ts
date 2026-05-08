// ============================================================================
// src/lib/zero-gen/run-completion.ts
//
// P5-24: zero-gen 記事の Stage2 完了後に「公開準備までを自動化」する仕上げ処理。
//
// 役割: zero-generate-async が /zero-generate-full の主要パイプラインを完走させた後、
// この関数を呼ぶことで以下が自動実行される:
//   1. outline.image_prompts → articles.image_prompts へ正規化コピー
//   2. 3 枚の実画像を Gemini Image Model で生成 → Supabase Storage upload
//   3. articles.image_files に URL を書込
//   4. meta_description / seo_filename を計算
//   5. Stage3 final HTML を generateArticleHtml で生成
//   6. articles UPDATE + revision_number=2 snapshot 保存
//
// 安全装置:
//   - generation_mode / is_hub_visible / reviewed_at は触らない
//   - title / slug は触らない (preserve-article-content ルール)
//
// P5-36: validation 通過時のみ status を draft → editing に遷移させる。
//   ゼロ生成は通常の outline → body_generating → body_review フローを
//   bypass するため、完了後 draft のまま残ると公開できない (VALID_TRANSITIONS で
//   draft → published は不許可)。validation passed 時点で editing 相当の品質
//   が保証されるため、editing に置く。validation 失敗時は draft のまま。
//
// 失敗時: throw、async route 側で job.error にメッセージを設定
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateImage, generateText } from '@/lib/ai/gemini-client';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import {
  generateMetaDescription,
  generateSlug,
} from '@/lib/seo/meta-generator';
import { logger } from '@/lib/logger';
// P5-86: 仕上げ後の HTML を「デプロイ用最終形」と同等に組み立てて
// テンプレート整合性チェックにかける。失敗した場合は articles UPDATE
// の前に throw して、壊れた body_html が DB に入らないようにする。
import { buildDeployHtml } from '@/lib/deploy/article-html-builder';
import { runTemplateCheck } from '@/lib/content/html-template-validator';
import type { Article } from '@/types/article';
// P5-69 (Phase A): ローカル実装は P5-55/57/58 で見つかった危険な fallback regex
//   (`{1,200}` 数値範囲、lazy `[\s\S]*?`、`>` を消費する `[^\\s<]*`) を残したまま
//   replace-placeholders.ts への移行が伝播しておらず、本文消失バグや closing `-->`
//   消失バグの再発リスクがあった。安全実装に統一する。
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from './replace-placeholders';

const STORAGE_BUCKET = 'article-images';

interface PromptItem {
  position: string;
  prompt: string;
  alt_text_ja: string;
}

function mimeToExt(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return m[mime] ?? 'webp';
}

function normalizePromptsToArray(raw: unknown, themeName: string): PromptItem[] {
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[])
      .filter((x) => x !== null && typeof x === 'object')
      .map((p, idx) => ({
        position: String(
          (p.position as string) ??
            (p.slot as string) ??
            (p.section_id as string) ??
            ['hero', 'body', 'summary'][idx] ??
            `pos${idx}`,
        ),
        prompt: String(p.prompt ?? ''),
        alt_text_ja: String(
          p.alt_text_ja ??
            p.alt ??
            p.heading_text ??
            `${themeName}のイメージ`,
        ),
      }))
      .filter((p) => p.position && p.prompt);
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, string>;
    return (['hero', 'body', 'summary'] as const)
      .filter((slot) => typeof obj[slot] === 'string' && obj[slot].length > 0)
      .map((slot) => ({
        position: slot,
        prompt: obj[slot],
        alt_text_ja: `${themeName}のイメージ — ${slot}`,
      }));
  }
  return [];
}

export interface CompletionResult {
  imageFilesCount: number;
  stage3HtmlChars: number;
  metaDescriptionChars: number;
  seoFilename: string;
  partial: boolean;
  /** P5-27: post-completion validation で検出した契約違反一覧 */
  validationIssues: string[];
}

/**
 * Post-completion validation — 仕上げ後に「期待される状態」を検証し、
 * 違反があれば issue 一覧を返す。これは reactive bug fix (発覚後修正) から
 * proactive prevention (発生前検出) への転換のため。
 *
 * 検査項目:
 *   - stage2_body_html に IMAGE プレースホルダが残っていないか
 *   - image_files が 1 件以上あるか
 *   - meta_description が空でないか
 *   - seo_filename が空でないか
 *   - stage3_final_html が一定長以上か
 *   - キーワードが本文に出現しているか (loose match)
 *   - X1: 画像 placeholder ミスマッチ (replaceImagePlaceholders の mismatched > 0) を検出
 *   - X1: 不正コメント (`<!--<img ...`) が残っていないか検出
 */
function validateCompletion(args: {
  bodyHtml: string;
  imageFiles: ImageFileRow[];
  metaDescription: string;
  seoFilename: string;
  stage3Html: string;
  keyword: string | null;
  /** X1: replaceImagePlaceholders の戻り値 mismatched (置換失敗 / 不正残骸の数) */
  imagePlaceholderMismatched?: number;
}): string[] {
  const issues: string[] = [];

  // 1. IMAGE placeholder 残存チェック
  const placeholders =
    args.bodyHtml.match(/IMAGE[：:][a-z_]+/gi) ?? [];
  if (placeholders.length > 0) {
    issues.push(
      `本文に未置換 IMAGE プレースホルダが残っています (${placeholders.length} 件): ${placeholders.slice(0, 3).join(', ')}`,
    );
  }

  // 1-bis. X1: replaceImagePlaceholders が報告した mismatched 件数を反映 (新規 issue type)
  //        phase1/phase2 で吸収できなかった placeholder ミスマッチを proactive に通知する。
  if ((args.imagePlaceholderMismatched ?? 0) > 0) {
    issues.push(
      `[image_placeholder_mismatch] 画像 placeholder のミスマッチが ${args.imagePlaceholderMismatched} 件あります (位置名と imageFiles の不一致 / 不正残骸)`,
    );
  }

  // 1-ter. X1: 不正コメント `<!--<img` が残っていないか (Stage2 生成系のバグ残骸)
  const brokenImgComments = args.bodyHtml.match(/<!--\s*<img/gi) ?? [];
  if (brokenImgComments.length > 0) {
    issues.push(
      `[image_broken_comment] 不正な画像コメント "<!--<img" が ${brokenImgComments.length} 件残っています`,
    );
  }

  // 2. 画像ファイル数
  if (args.imageFiles.length === 0) {
    issues.push('image_files が空です (画像生成が完全失敗)');
  } else if (args.imageFiles.length < 3) {
    issues.push(`image_files が ${args.imageFiles.length} 件のみ (期待 3)`);
  }

  // 3. meta_description
  if (!args.metaDescription || args.metaDescription.length < 50) {
    issues.push(
      `meta_description が短すぎます (${args.metaDescription?.length ?? 0} 字)`,
    );
  }

  // 4. seo_filename
  if (!args.seoFilename || args.seoFilename.length === 0) {
    issues.push('seo_filename が未設定です');
  }

  // 5. stage3 length
  if (!args.stage3Html || args.stage3Html.length < 1000) {
    issues.push(
      `stage3_final_html が短すぎます (${args.stage3Html?.length ?? 0} 字)`,
    );
  }

  // 6. キーワード出現 (CSV 形式で、最初のトークンだけ確認)
  if (args.keyword) {
    const kwTokens = args.keyword
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    const firstKw = kwTokens[0];
    if (firstKw && !args.bodyHtml.includes(firstKw)) {
      issues.push(
        `キーワード "${firstKw}" が本文に 1 度も出現していません`,
      );
    }
  }

  return issues;
}

/**
 * 進捗コールバック (オプショナル)。
 * stage = 'image_prompts' | 'image_gen' | 'stage3' | 'persist'
 */
export type CompletionProgress = (stage: string, info?: Record<string, unknown>) => void;

/**
 * P5-90: meta_description フォールバック生成。
 *   Stage1 outline で meta_description が空 / 100 字未満だった場合に
 *   本文 HTML から最終救済として Gemini に SEO 説明文を 100〜140 字で書かせる。
 *   このパスを通すこと自体が異常 (Stage1 prompt 失効) なので、必ず logger.error を残す。
 *   Gemini 呼び出しに失敗した場合はテンプレートベースの fallback を返す
 *   (公開ダイアログを止めない最低限の safety net)。
 */
async function generateMetaDescriptionFromBody(args: {
  articleId: string;
  bodyHtml: string;
  keyword: string;
  leadSummary: string;
  reason: string;
}): Promise<string> {
  const { articleId, bodyHtml, keyword, leadSummary, reason } = args;
  // 本文を text-only に圧縮（先頭 1500 字程度に切り詰めて Gemini に渡す）
  const plain = bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);

  const systemPrompt =
    'あなたはスピリチュアルカウンセラー小林由起子のコラムサイトの SEO 担当です。' +
    '記事本文から検索結果のスニペットに表示される meta_description を生成してください。' +
    '出力は description 本文のみ 1 行（前後の説明文・引用符・コードフェンス等は禁止）。';
  const userPrompt =
    `以下の記事本文から SEO meta_description を **必ず 100〜140 文字** で生成してください。\n` +
    `\n## 制約\n` +
    `- 主要キーワード「${keyword || '(未設定)'}」を自然に 1 回含める\n` +
    `- 由起子さんの優しい語り口（「〜ですね」「〜なんです」等を自然に混ぜる）\n` +
    `- 「いかがでしたでしょうか」「〜について解説します」等の AI 臭フレーズ禁止\n` +
    `- 改行・引用符・コードフェンス・装飾は一切付けず、本文 1 行だけを出力する\n` +
    `\n## リード要約\n${leadSummary || '(未設定)'}\n` +
    `\n## 本文（先頭抜粋）\n${plain}\n`;

  logger.error('ai', 'meta_description.fallback_invoked', {
    article_id: articleId,
    reason,
    keyword,
    body_chars: bodyHtml.length,
  });

  try {
    const res = await generateText(systemPrompt, userPrompt, {
      temperature: 0.5,
      maxOutputTokens: 512,
      timeoutMs: 60_000,
    });
    let text = (res.text ?? '').replace(/^[\s"'`]+|[\s"'`]+$/g, '').trim();
    // 改行・コードフェンスを除去
    text = text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 200) text = text.slice(0, 199) + '…';
    if (text.length < 100) {
      logger.error('ai', 'meta_description.fallback_too_short', {
        article_id: articleId,
        length: text.length,
        text_head: text.slice(0, 60),
      });
      // 最後の救済 — 既存ロジック (generateMetaDescription) で 100 字に padding
      const padded = generateMetaDescription(
        keyword || '記事',
        leadSummary || plain.slice(0, 100),
      );
      if (padded.length > text.length) text = padded;
    }
    logger.info('ai', 'meta_description.fallback_ok', {
      article_id: articleId,
      length: text.length,
    });
    return text;
  } catch (e) {
    logger.error('ai', 'meta_description.fallback_failed', {
      article_id: articleId,
      error_message: (e as Error)?.message ?? String(e),
    });
    // Gemini が落ちても公開ダイアログを止めないため、テンプレートベースで補う。
    return generateMetaDescription(
      keyword || '記事',
      leadSummary || plain.slice(0, 100),
    );
  }
}

/**
 * 既に Stage2 が完了している記事を「公開準備状態」まで進める。
 */
export async function runZeroGenCompletion(args: {
  articleId: string;
  onProgress?: CompletionProgress;
  /** 画像生成を skip する (debug 用) */
  skipImages?: boolean;
}): Promise<CompletionResult> {
  const { articleId, onProgress, skipImages = false } = args;
  const t0 = Date.now();

  // P5-69 (Phase β): 関数入口の transition log。
  //   RCA: ある記事で stage2_body_html が空のまま run-completion に入った疑いが
  //   あったが、entered ログが無いため呼び出し有無の判別が出来なかった。観測点を敷設。
  logger.info('ai', 'run_completion.entered', {
    article_id: articleId,
    skip_images: skipImages,
  });

  try {
  const supabase = await createServiceRoleClient();

  // 1. 記事ロード (zero-gen 用に必要なフィールド)
  const { data: article, error: aErr } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .maybeSingle();
  if (aErr || !article) {
    throw new Error(`runZeroGenCompletion: article not found: ${articleId}`);
  }

  // P5-69 (Phase β): Stage2 入力検査 (silent 進行を禁止する)。
  //   article ロード後に stage2_body_html / outline / image_prompts の有無を
  //   構造化ログとして記録し、空 or 100 文字未満なら logger.error + throw する。
  const outlineRaw = (article.stage1_outline as Record<string, unknown>) ?? {};
  const bodyHtmlRaw = (article.stage2_body_html as string | null) ?? '';
  const imagePromptsRaw = outlineRaw.image_prompts;
  logger.info('ai', 'run_completion.input_check', {
    article_id: articleId,
    body_length: bodyHtmlRaw.length,
    outline_present: !!article.stage1_outline,
    image_prompts_count: Array.isArray(imagePromptsRaw)
      ? imagePromptsRaw.length
      : 0,
  });
  if (!bodyHtmlRaw || bodyHtmlRaw.trim().length < 100) {
    logger.error('ai', 'run_completion.body_invalid', {
      article_id: articleId,
      body_length: bodyHtmlRaw.length,
      body_head: bodyHtmlRaw.slice(0, 100),
    });
    throw new Error(
      `runZeroGenCompletion: bodyHtml が短すぎます (${bodyHtmlRaw.length} chars)`,
    );
  }

  // outline 内の image_prompts を articles 列にコピー (P5-24)
  const outline = outlineRaw;
  const themeName = (article.theme as string) ?? '';
  let prompts = normalizePromptsToArray(article.image_prompts, themeName);
  if (prompts.length === 0) {
    prompts = normalizePromptsToArray(outline.image_prompts, themeName);
  }
  onProgress?.('image_prompts', { count: prompts.length });

  // 2. 画像生成 (skipImages=true なら飛ばす、既に image_files があれば飛ばす)
  let imageFiles: ImageFileRow[] = Array.isArray(article.image_files)
    ? (article.image_files as ImageFileRow[])
    : [];
  let imageGenPartial = false;

  if (skipImages) {
    logger.info('ai', 'images.skipped', { articleId, reason: 'flag' });
  } else if (imageFiles.length === prompts.length && imageFiles.length > 0) {
    logger.info('ai', 'images.skipped', {
      articleId,
      reason: 'already populated',
      count: imageFiles.length,
    });
  } else {
    // P5-69 (Phase β): 画像生成フェーズ start。
    logger.info('ai', 'image.start', {
      article_id: articleId,
      prompts_count: Math.min(prompts.length, 3),
    });
    const tImageStart = Date.now();
    let totalBytes = 0;
    const newImageFiles: ImageFileRow[] = [];
    for (const p of prompts.slice(0, 3)) {
      const tImg = Date.now();
      onProgress?.('image_gen', { position: p.position });
      // P5-29: Gemini Image Model は人物のポートレートを暴走的に生成しがち。
      // プロンプトに静物/風景指定 + 人物禁止 を強化付与する。
      const enhancedPrompt =
        `${p.prompt}\n\n` +
        `Style: still life or peaceful landscape illustration, soft pastel watercolor, ethereal warm lighting. ` +
        `STRICTLY NO: human face, portrait, person, character, woman, man, body parts, eyes, mouth, hands. ` +
        `Focus on objects, nature, scenery only.`;
      try {
        const result = await generateImage(enhancedPrompt, { timeoutMs: 90_000 });
        const path = `articles/${articleId}/${p.position}.${mimeToExt(result.mimeType)}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, result.imageBuffer, {
            contentType: result.mimeType,
            upsert: true,
          });
        if (upErr) throw new Error(`storage upload (${p.position}): ${upErr.message}`);
        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);
        // P5-69 (Phase β): 各画像の bytes を集計して end ログで吐く。
        totalBytes += result.imageBuffer?.byteLength ?? 0;
        newImageFiles.push({
          position: p.position,
          url: urlData.publicUrl,
          alt: p.alt_text_ja,
          filename: `${p.position}.${mimeToExt(result.mimeType)}`,
        });
        logger.info('ai', 'image.ok', {
          articleId,
          position: p.position,
          elapsed_ms: Date.now() - tImg,
        });
      } catch (e) {
        imageGenPartial = true;
        logger.error('ai', 'image.failed', {
          articleId,
          position: p.position,
          error_message: (e as Error).message,
        });
      }
    }
    if (newImageFiles.length > 0) imageFiles = newImageFiles;
    // P5-69 (Phase β): 画像生成フェーズ end (個別の image.ok / image.failed は既存)。
    logger.info('ai', 'image.end', {
      article_id: articleId,
      url_count: newImageFiles.length,
      total_bytes: totalBytes,
      elapsed_ms: Date.now() - tImageStart,
    });
  }

  // 3. P5-26: 画像 placeholder を stage2_body_html 内で <img> タグに置換
  //    (Stage2 では IMAGE:body / IMAGE:summary 等の placeholder が残るため)
  const originalBody = (article.stage2_body_html as string) ?? '';
  // P5-69 (Phase β): placeholder 置換 start。
  logger.info('ai', 'placeholder_replace.start', {
    article_id: articleId,
    body_chars_before: originalBody.length,
    image_files_count: imageFiles.length,
  });
  const replaced = replaceImagePlaceholders(originalBody, imageFiles);
  const updatedBodyHtml = replaced.html;
  logger.info('ai', 'image_placeholders.replaced', {
    articleId,
    phase1: replaced.phase1,
    phase2: replaced.phase2,
    body_chars_before: originalBody.length,
    body_chars_after: updatedBodyHtml.length,
  });
  // P5-69 (Phase β): placeholder 置換 end (上記 image_placeholders.replaced と並行で
  //   B2 マトリクスの命名規約に合わせた end ログを追加。phase1/phase2/mismatched を一括出力)。
  logger.info('ai', 'placeholder_replace.end', {
    article_id: articleId,
    phase1: replaced.phase1,
    phase2: replaced.phase2,
    mismatched: replaced.mismatched,
    body_chars_after: updatedBodyHtml.length,
  });

  // 4. meta_description / seo_filename
  // P5-69 (Phase β): meta start。
  logger.info('ai', 'meta.start', {
    article_id: articleId,
    has_existing_meta: !!article.meta_description,
    has_existing_seo_filename: !!article.seo_filename,
  });
  // P5-90: meta_description ランタイムゲート。
  //   Stage1 outline 由来 / DB 既存値 / generateMetaDescription fallback の順で確定するが、
  //   いずれも空 / 100 字未満なら Gemini フォールバック (本文要約) を必ず通す。
  //   100 字を最小条件とするのは公開ダイアログ側の SEO 品質ゲートと整合させるため。
  const META_MIN_LEN = 100;
  let metaDescription =
    ((article.meta_description as string | null) ?? '').trim() ||
    generateMetaDescription(
      (article.keyword as string) ?? '',
      (article.lead_summary as string) ?? '',
    );
  if (!metaDescription || metaDescription.trim().length < META_MIN_LEN) {
    logger.error('ai', 'meta_description.runtime_gate_failed', {
      article_id: articleId,
      length: metaDescription?.length ?? 0,
      head: (metaDescription ?? '').slice(0, 60),
      source: article.meta_description ? 'db_existing' : 'template_fallback',
    });
    metaDescription = await generateMetaDescriptionFromBody({
      articleId,
      bodyHtml: updatedBodyHtml,
      keyword: (article.keyword as string) ?? '',
      leadSummary: (article.lead_summary as string) ?? '',
      reason: !article.meta_description
        ? 'meta_description_missing'
        : 'meta_description_too_short',
    });
  }
  const seoFilename =
    (article.seo_filename as string | null) ??
    generateSlug((article.title as string) ?? '');
  // P5-69 (Phase β): meta end。
  logger.info('ai', 'meta.end', {
    article_id: articleId,
    meta_description_length: metaDescription?.length ?? 0,
    seo_filename: seoFilename,
  });

  // 5. Stage3 final HTML — placeholder 置換済 body で生成
  onProgress?.('stage3');
  // P5-69 (Phase β): stage3 start。
  logger.info('ai', 'stage3.start', {
    article_id: articleId,
    body_chars: updatedBodyHtml.length,
    image_files_count: imageFiles.length,
  });
  const tStage3 = Date.now();
  const articleForHtml = {
    ...article,
    stage2_body_html: updatedBodyHtml, // ← 置換済を使用
    image_files: imageFiles,
    image_prompts: prompts,
    meta_description: metaDescription,
    seo_filename: seoFilename,
  } as never;
  const stage3Html = generateArticleHtml(articleForHtml, {
    heroImage: imageFiles.find((f) => f.position === 'hero')?.url,
    heroImageAlt: imageFiles.find((f) => f.position === 'hero')?.alt,
  });
  // P5-69 (Phase β): stage3 end。
  logger.info('ai', 'stage3.end', {
    article_id: articleId,
    length: stage3Html?.length ?? 0,
    elapsed_ms: Date.now() - tStage3,
  });

  // P5-86: ランタイム整合性ゲート — body_html を DB に書き込む直前に
  //   「デプロイ用最終形」と同じ HTML を組み立てて runTemplateCheck() に通す。
  //   失敗した場合は articles UPDATE 自体に到達させず、上位 (zero-generate-async)
  //   で stage='failed' に倒れる既存パスに任せる。
  //   理由: 過去 (P5-49 / P5-57 / P5-69) で 壊れた HTML がそのまま DB → デプロイへ
  //   流出した silent failure を、最終ステージで物理的に遮断するため。
  //   source-mode 記事はそもそも本ヘルパで仕上げ→自動デプロイされない (P5-85) ので
  //   zero-mode に限定する。
  const generationMode = (article.generation_mode as string | null | undefined) ?? null;
  if (generationMode === 'zero') {
    logger.info('ai', 'template_check.start', {
      article_id: articleId,
      stage3_chars: stage3Html?.length ?? 0,
    });
    // articleForHtml は `as never` 型で固定されているため、Record 経由で広げる。
    const previewArticle = {
      ...(articleForHtml as unknown as Record<string, unknown>),
      // buildDeployHtml は Article shape を要求する。slug が無いケースで
      // も escapeRegex に渡されないように、最低限のフィールドを保証する。
      slug: (article.slug as string | null) ?? articleId,
      title: (article.title as string | null) ?? '',
    } as unknown as Article;
    let previewHtml: string;
    try {
      previewHtml = buildDeployHtml(previewArticle).html;
    } catch (e) {
      logger.error('ai', 'template_check.build_failed', {
        article_id: articleId,
        error_message: (e as Error)?.message ?? String(e),
      });
      throw new Error(
        `Template integrity build failed: ${(e as Error)?.message ?? String(e)}`,
      );
    }
    // P5-90: CTA カウント明示チェック (runTemplateCheck の cta_structure と二重ガード)。
    //   stage2_body_html には CTA が含まれないため、deploy 用最終 HTML を組んだ後に
    //   harmony-cta-inner ブロックが 2 つ以上あるかを直接数える。
    //   2 未満なら publish 後に CTA 動線が機能しないため、明示的に logger.error。
    //   実際の throw は下の runTemplateCheck (cta_structure) に任せ、本ログは
    //   調査時の原因切り分けに使う。
    const ctaInnerCount = (
      previewHtml.match(/harmony-cta-inner/g) || []
    ).length;
    if (ctaInnerCount < 2) {
      logger.error('ai', 'run_completion.cta_count_low', {
        article_id: articleId,
        slug: (article.slug as string | null) ?? null,
        cta_inner_count: ctaInnerCount,
        expected_min: 2,
        deploy_html_chars: previewHtml.length,
      });
    } else {
      logger.info('ai', 'run_completion.cta_count_ok', {
        article_id: articleId,
        cta_inner_count: ctaInnerCount,
      });
    }
    const tplCheck = runTemplateCheck(previewHtml);
    logger.info('ai', 'template_check.end', {
      article_id: articleId,
      passed: tplCheck.passed,
      failure_count: tplCheck.failures.length,
    });
    if (!tplCheck.passed) {
      // category は LogCategory union に縛られているため 'ai' を使用 (zero-gen 系
      // の既存ログとも整合)。action 名にコンポーネント名を含めて検索容易性を確保。
      logger.error('ai', 'run_completion.template_check.failed', {
        article_id: articleId,
        slug: (article.slug as string | null) ?? null,
        failures: tplCheck.failures,
        body_chars: updatedBodyHtml.length,
        stage3_chars: stage3Html?.length ?? 0,
      });
      // 上位 (zero-generate-async route) の catch が stage='failed' に倒すパスに任せる。
      // ここでは絶対に articles UPDATE / revision INSERT に進ませない。
      throw new Error(
        `Template integrity failed (${tplCheck.failures.join(', ')})`,
      );
    }
  } else {
    logger.info('ai', 'template_check.skipped', {
      article_id: articleId,
      reason: 'non_zero_generation_mode',
      generation_mode: generationMode,
    });
  }

  // 6. articles UPDATE — stage2 も更新 (placeholder 解決済 body)
  onProgress?.('persist');
  // P5-69 (Phase β): articles.update.start。
  logger.info('ai', 'articles.update.start', {
    article_id: articleId,
    stage2_chars: updatedBodyHtml.length,
    stage3_chars: stage3Html?.length ?? 0,
    image_files_count: imageFiles.length,
  });
  const { error: updErr } = await supabase
    .from('articles')
    .update({
      stage2_body_html: updatedBodyHtml, // ← 置換済を保存
      image_files: imageFiles,
      image_prompts: prompts,
      meta_description: metaDescription,
      seo_filename: seoFilename,
      stage3_final_html: stage3Html,
      reviewed_at: null, // ← 承認ゲートは触らない (人間判断)
    })
    .eq('id', articleId);
  if (updErr) {
    // P5-69 (Phase β): articles.update.failed。
    logger.error('ai', 'articles.update.failed', {
      article_id: articleId,
      error_message: updErr.message,
    });
    throw new Error(`articles UPDATE failed: ${updErr.message}`);
  }
  // P5-69 (Phase β): articles.update.end。
  logger.info('ai', 'articles.update.end', {
    article_id: articleId,
  });

  // 6. revision snapshot (revision_number=2、Stage3 完成版)
  try {
    await supabase.from('article_revisions').insert({
      article_id: articleId,
      revision_number: 2,
      html_snapshot: stage3Html,
      change_type: 'auto_snapshot',
      changed_by: null,
      comment: JSON.stringify({
        source: 'run-completion',
        stage: 'stage3',
        partial: imageGenPartial,
      }),
    });
  } catch (e) {
    // 履歴失敗は warning のみ (本体 UPDATE は成功させる)
    logger.warn('ai', 'revision_snapshot_failed', {
      articleId,
      error_message: (e as Error).message,
    });
  }

  // 7. P5-27: Post-completion validation — 契約違反を即時検出
  // P5-69 (Phase β): validation.start。
  logger.info('ai', 'validation.start', {
    article_id: articleId,
  });
  const validationIssues = validateCompletion({
    bodyHtml: updatedBodyHtml,
    imageFiles,
    metaDescription,
    seoFilename,
    stage3Html,
    keyword: (article.keyword as string) ?? null,
    imagePlaceholderMismatched: replaced.mismatched, // X1: 画像 placeholder ミスマッチ件数
  });
  // P5-69 (Phase β): validation.end (issue 件数を必ず吐く)。
  logger.info('ai', 'validation.end', {
    article_id: articleId,
    issues_count: validationIssues.length,
  });
  if (validationIssues.length > 0) {
    // P5-69 (Phase β): validation.issues_found (既存 completion.validation_failed と
    //   並行で B2 マトリクスの命名規約に合わせた transition log を追加)。
    logger.info('ai', 'validation.issues_found', {
      article_id: articleId,
      issues_count: validationIssues.length,
      issues: validationIssues,
    });
    logger.error('ai', 'completion.validation_failed', {
      articleId,
      issues: validationIssues,
    });
  } else {
    // P5-36: validation 通過 → draft の場合のみ editing に遷移させる。
    // 既に editing 以降にユーザが進めていた場合 (再生成シナリオ) は触らない。
    const { data: cur } = await supabase
      .from('articles')
      .select('status')
      .eq('id', articleId)
      .maybeSingle();
    if (cur?.status === 'draft') {
      // P5-37: settings.workflow.zero_gen_auto_approve = true ならば
      //        reviewed_at も同時にセットして由起子さん確認ゲートを通過させる。
      //        false (デフォルト) の場合は editing 遷移のみで reviewed_at は null のまま、
      //        由起子さんが UI から手動で確認する。
      const { data: wf } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'workflow')
        .maybeSingle();
      const autoApprove = Boolean(
        (wf?.value as { zero_gen_auto_approve?: boolean } | null)?.zero_gen_auto_approve,
      );
      // P5-43 Step 3: writers migration に伴う visibility_state 遷移。
      //   autoApprove=true  → visibility_state='idle' (公開可能 / デプロイ未) + reviewed_at=now() (audit のみ)
      //   autoApprove=false → visibility_state='pending_review' (由起子さん確認待ち、reviewed_at は touch しない)
      const update: Record<string, unknown> = { status: 'editing' };
      if (autoApprove) {
        update.visibility_state = 'idle';
        update.reviewed_at = new Date().toISOString(); // audit のみ
      } else {
        update.visibility_state = 'pending_review';
        // reviewed_at は touch しない (まだ未審査)
      }
      const { error: stErr } = await supabase
        .from('articles')
        .update(update)
        .eq('id', articleId);
      if (stErr) {
        logger.warn('ai', 'completion.status_advance_failed', {
          articleId,
          error_message: stErr.message,
        });
      } else {
        logger.info('ai', 'completion.status_advanced', {
          articleId,
          from: 'draft',
          to: 'editing',
          auto_approved: autoApprove,
        });
      }
    }
  }

  logger.info('ai', 'done', {
    articleId,
    images_count: imageFiles.length,
    stage3_chars: stage3Html.length,
    meta_chars: metaDescription.length,
    seo_filename: seoFilename,
    partial: imageGenPartial,
    validation_issues_count: validationIssues.length,
    total_elapsed_ms: Date.now() - t0,
  });
  // P5-69 (Phase β): run_completion.success — 最終出口の transition log。
  logger.info('ai', 'run_completion.success', {
    article_id: articleId,
    images_count: imageFiles.length,
    stage3_chars: stage3Html.length,
    meta_chars: metaDescription.length,
    seo_filename: seoFilename,
    partial: imageGenPartial,
    validation_issues_count: validationIssues.length,
    total_elapsed_ms: Date.now() - t0,
  });

  return {
    imageFilesCount: imageFiles.length,
    stage3HtmlChars: stage3Html.length,
    metaDescriptionChars: metaDescription.length,
    seoFilename,
    partial: imageGenPartial || validationIssues.length > 0,
    validationIssues,
  };
  } catch (e) {
    // P5-69 (Phase β): run_completion.failed — 例外時の最終 transition log。
    //   silent に異常終了させない (上位 async route 側でも catch するが二重に観測点を残す)。
    logger.error('ai', 'run_completion.failed', {
      article_id: articleId,
      error_message: (e as Error)?.message ?? String(e),
      total_elapsed_ms: Date.now() - t0,
    });
    throw e;
  }
}
