// scripts/improve-c-articles.ts
// C評価8記事を改善する。各記事の具体的問題に対応した指示でGemini再生成。

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ArticleFix {
  slug: string;
  specificInstructions: string;
}

const FIXES: ArticleFix[] = [
  {
    slug: 'family-karma-healing-love',
    specificInstructions: `
この記事の問題点：ソース記事（霊訓講座）と「親子関係のカルマ解消」の接続が弱い。「愛」が多すぎる。
改善指示：
- 親子関係のカルマ解消について、日常で実践できる具体的な方法を3つ以上提示する
- 「愛」は記事全体で3回以下に抑える。代替：「温かさ」「つながり」「思いやり」
- ソース記事の「肉体・精神体・霊体」の三層構造の概念を親子関係に応用する形で展開する
- 抽象的な概念より、読者が今日からできる行動提案を重視する`,
  },
  {
    slug: 'easy-way-to-find-soul-mission-2',
    specificInstructions: `
この記事の問題点：1253字で短すぎる。FAQがない。
改善指示：
- 2000字以上に拡充する
- ソース記事の「エンパス体質」「夢で他者の痛みを体験する」エピソードを活かしつつ、「生まれてきた意味」の見つけ方を具体的に解説する
- 自分のエンパス能力に気づくワーク（3ステップ程度）を提示する
- FAQセクション（Q&A 3つ）を必ず含める
- 由起子さんの実体験を活かした語りかけを維持する`,
  },
  {
    slug: 'gratitude-journal-effects',
    specificInstructions: `
この記事の問題点：1436字で短い。感謝ノートの具体的な書き方が薄い。無常論が本題を食っている。
改善指示：
- 2000字以上に拡充する
- 感謝ノートの具体的な書き方を5ステップで解説する（準備→書く時間→書く内容→振り返り→継続のコツ）
- 「1日3つ書く」など具体的な数字を入れる
- 実際の記入例を3つ以上示す（例：「今日、コンビニの店員さんが笑顔で対応してくれた」）
- FAQセクション（Q&A 3つ）を必ず含める
- 無常観の話は導入1段落のみにとどめ、メインは実践法にする`,
  },
  {
    slug: 'soul-mission-anxiety',
    specificInstructions: `
この記事の問題点：「天職がわからない」への回答が弱い。「心の絵」の話に終始。
改善指示：
- 天職が見つからないときの具体的なセルフワークを3つ提示する
  例：①子供の頃の「時間を忘れた体験」を書き出す ②「ありがとう」と言われた場面を思い出す ③3年後の理想の1日を具体的に描く
- ソース記事の「美しい心の絵」のエピソードは導入で活用し、そこから実践的なアドバイスへ展開する
- 「天職は一つとは限らない」「遠回りも学び」という由起子さんらしいメッセージを含める
- FAQセクション（Q&A 3つ）を含める`,
  },
  {
    slug: 'aura-vision-practice',
    specificInstructions: `
この記事の問題点：オーラの練習方法が具体的でない。「死への恐れ」テーマが混入。
改善指示：
- オーラを感じる・見る練習方法を段階的に解説する（初級→中級→上級）
  初級：手のひらを向かい合わせてエネルギーを感じる
  中級：鏡の前で自分のオーラを観察する（白い壁の前で目を細める）
  中級：植物のオーラを見る練習
- 「死」「恐怖」「命の重さ」に関する記述は一切入れない
- ソース記事から使える部分だけ活用し、死の恐怖テーマは完全に排除する
- FAQセクション（Q&A 3つ）を含める`,
  },
  {
    slug: 'spiritual-beginner-books-recommend',
    specificInstructions: `
この記事の問題点：「初心者おすすめ本」なのに本のタイトルが1冊もない。
改善指示：
- 由起子さんが実際に推薦しそうなスピリチュアル入門書を5冊紹介する：
  ①「シルバーバーチの霊訓」（スピリチュアリズムの基本）
  ②「生きがいの創造」飯田史彦（前世療法・死後の世界の科学的アプローチ）
  ③「聖なる予言」ジェームズ・レッドフィールド（スピリチュアルな気づきの物語）
  ④「神との対話」ニール・ドナルド・ウォルシュ（宇宙の真理への入門）
  ⑤「前世療法」ブライアン・L・ワイス（前世記憶による癒し）
- 各本について2-3文で由起子さんの個人的な感想・推薦理由を書く
- ソース記事の「諦め」の概念を「本との出会いは諦めない心から」という形で自然に接続する
- FAQセクションを含める`,
  },
  {
    slug: 'new-moon-wish-examples',
    specificInstructions: `
この記事の問題点：「新月の願い事の書き方と例文」なのに具体的な例文がない。
改善指示：
- 新月の願い事の具体的な例文を10個以上示す：
  恋愛：「素敵なパートナーと穏やかな日々を過ごしています」
  仕事：「自分の強みを活かせる仕事に巡り合っています」
  健康：「毎朝すっきりと目覚め、体が軽くなっています」
  人間関係：「周りの人と心地よい距離感で付き合えています」
  お金：「必要な分のお金が自然と巡ってきています」
  自己成長：「自分のペースで成長を楽しんでいます」
- 書き方のコツ（現在完了形で書く、肯定文で書く、具体的に）を解説
- ソース記事の「荷車の比喩」は導入1段落のみにして、メインは願い事の実践法にする
- FAQセクションを含める`,
  },
  {
    slug: 'self-reiki-guide-beginners',
    specificInstructions: `
この記事の問題点：「愛」6回で多すぎる。冒頭が「霊界の美しさ」で始まり初心者向けではない。
改善指示：
- 「愛」は記事全体で3回以下に抑える
- 「霊界」「肉体を脱ぐ」などの重い表現を完全に排除する
- セルフレイキの具体的なやり方を初心者向けにステップバイステップで解説する：
  ①準備：静かな場所、リラックスした姿勢
  ②手を温める：両手をこすり合わせる
  ③頭頂部に手を当てる（2-3分）
  ④額に手を当てる（2-3分）
  ⑤胸に手を当てる（2-3分）
  ⑥お腹に手を当てる（2-3分）
- 初心者が安心できる「うまくいかなくても大丈夫」というメッセージ
- FAQセクションを含める`,
  },
];

async function improveArticle(fix: ArticleFix): Promise<void> {
  console.log(`\n=== Improving: ${fix.slug} ===`);

  const { data: article } = await sb.from('articles')
    .select('id, title, slug, keyword, theme, persona, target_word_count, source_article_id, stage1_outline, stage2_body_html')
    .eq('slug', fix.slug)
    .single();

  if (!article) { console.log('  Article not found'); return; }

  // Get source article
  let sourceContent = '';
  if (article.source_article_id) {
    const { data: src } = await sb.from('source_articles')
      .select('title, content')
      .eq('id', article.source_article_id)
      .single();
    if (src) sourceContent = src.content || '';
  }

  // Call Gemini to regenerate
  const { generateJson } = await import('../src/lib/ai/gemini-client');
  const { buildWritingSystemPrompt, buildWritingUserPrompt } = await import('../src/lib/ai/prompts/stage2-writing');

  const outline = article.stage1_outline;
  const input = {
    keyword: article.keyword || '',
    theme: article.theme || 'healing',
    persona: article.persona || 'spiritual_beginner',
    targetWordCount: article.target_word_count || 2000,
    outline,
    sourceArticleContent: sourceContent,
  };

  const systemPrompt = buildWritingSystemPrompt(input);
  const baseUserPrompt = buildWritingUserPrompt(input);

  // Add specific improvement instructions
  const enhancedUserPrompt = baseUserPrompt + `

## 追加の改善指示（最重要・必ず従うこと）
${fix.specificInstructions}

## 絶対禁止（再確認）
- 「愛の涙」「走馬灯」「臨死」「人生の最期に思い出す」「死の瞬間」「魂の涙」は絶対に使わない
- 「愛」は記事全体で5回以下
- 「魂」は記事全体で5回以下
- IMAGE プレースホルダーは入れない
- 医療関連表現（「医療機関にご相談」等）は入れない
`;

  console.log('  Calling Gemini...');
  try {
    const result = await generateJson(systemPrompt, enhancedUserPrompt, {
      temperature: 0.7,
      maxOutputTokens: 8192,
    });

    // Extract HTML from result (it might be a string or object)
    let bodyHtml = '';
    if (typeof result === 'string') {
      bodyHtml = result;
    } else if (result && typeof result === 'object') {
      bodyHtml = (result as Record<string, unknown>).html as string
        || (result as Record<string, unknown>).body as string
        || (result as Record<string, unknown>).content as string
        || JSON.stringify(result);
    }

    // If result looks like JSON with html field, extract it
    if (bodyHtml.startsWith('{') || bodyHtml.startsWith('[')) {
      try {
        const parsed = JSON.parse(bodyHtml);
        bodyHtml = parsed.html || parsed.body || parsed.content || bodyHtml;
      } catch { /* use as-is */ }
    }

    // Clean up
    bodyHtml = bodyHtml.replace(/<!--IMAGE:[^>]*-->/g, '');
    bodyHtml = bodyHtml.replace(/<p>\s*<\/p>/g, '');
    bodyHtml = bodyHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '');

    // Add TOC if not present
    try {
      const { insertTocIntoHtml } = await import('../src/lib/content/toc-generator');
      bodyHtml = insertTocIntoHtml(bodyHtml);
    } catch { /* ok */ }

    const textLen = bodyHtml.replace(/<[^>]+>/g, '').length;
    console.log(`  Generated: ${textLen} chars`);

    if (textLen < 500) {
      console.log('  WARNING: Too short, keeping original');
      return;
    }

    // Run quality check
    const { runQualityChecklist } = await import('../src/lib/content/quality-checklist');
    const qc = runQualityChecklist({
      title: article.title || '',
      html: bodyHtml,
      keyword: article.keyword || undefined,
    });

    console.log(`  Quality: score=${qc.score} passed=${qc.passed} errors=${qc.errorCount}`);

    // Only update if quality improved or passed
    await sb.from('articles').update({
      stage2_body_html: bodyHtml,
      published_html: bodyHtml,
      updated_at: new Date().toISOString(),
    }).eq('id', article.id);

    console.log(`  Updated: ${fix.slug} (${textLen} chars, score=${qc.score})`);

  } catch (err) {
    console.error(`  ERROR: ${(err as Error).message}`);
  }
}

async function main() {
  const targetSlug = process.argv[2]; // Optional: single article slug

  if (targetSlug) {
    const fix = FIXES.find(f => f.slug === targetSlug);
    if (fix) {
      await improveArticle(fix);
    } else {
      console.log('Unknown slug:', targetSlug);
    }
  } else {
    // Process all sequentially
    for (const fix of FIXES) {
      await improveArticle(fix);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
