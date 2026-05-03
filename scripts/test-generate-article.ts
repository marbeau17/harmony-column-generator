/**
 * 新プロンプトで1記事テスト生成するスクリプト
 * Usage: npx tsx scripts/test-generate-article.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Load .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

async function main() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const { buildWritingSystemPrompt, buildWritingUserPrompt } = await import('../src/lib/ai/prompts/stage2-writing');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20' });

  // Pick a source article to base the test on
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Get one source article
  const { data: source } = await supabase
    .from('source_articles')
    .select('*')
    .limit(1)
    .single();

  if (!source) {
    console.error('No source article found');
    process.exit(1);
  }

  console.log(`Source: ${source.title}\n`);

  // Build a minimal stage2 input
  const input = {
    articleId: 'test-001',
    keyword: 'スピリチュアル 日常 気づき',
    theme: 'daily',
    targetPersona: '30代女性、日常に疲れを感じている',
    perspectiveType: 'empathy_reframe',
    targetWordCount: 2000,
    outline: {
      title_proposal: '毎日の暮らしの中に宿る、小さなスピリチュアルの種',
      headings: [
        { level: 'H2' as const, text: '忙しい毎日の中で、ふと立ち止まるとき', estimated_words: 500, children: [] },
        { level: 'H2' as const, text: 'スピリチュアルは特別なものではないということ', estimated_words: 500, children: [
          { level: 'H3' as const, text: '朝のコーヒーに宿る、小さな祈り', estimated_words: 250 },
          { level: 'H3' as const, text: '通勤電車の中で気づく、心の声', estimated_words: 250 },
        ]},
        { level: 'H2' as const, text: '心が少し軽くなる、3つの小さな習慣', estimated_words: 500, children: [] },
        { level: 'H2' as const, text: 'あなたの毎日は、すでに満たされている', estimated_words: 500, children: [] },
      ],
      faq: [
        { question: 'スピリチュアルに興味があるけれど、何から始めればいいですか？', answer: '特別なことは必要ありません。まずは日常の小さな気づきに目を向けることから始めてみてください。' },
        { question: '忙しくて心の余裕がないのですが、それでもスピリチュアルを感じられますか？', answer: 'はい。忙しいからこそ、ほんの一瞬の静けさが大切になります。' },
      ],
      image_prompts: [
        { section_id: 'body', suggested_filename: 'spiritual-daily-practice.webp' },
        { section_id: 'summary', suggested_filename: 'peaceful-morning-light.webp' },
      ],
      cta_texts: [
        { catch: 'あなたの心の声を聴く時間をつくりませんか', sub: '由起子がお一人おひとりに寄り添います' },
        { catch: '日常の気づきを、もっと深く。カウンセリングのご案内', sub: 'オンラインでもお受けいただけます' },
      ],
      cta_positions: ['section-2', 'section-4'],
    },
    sourceArticleContent: source.content?.substring(0, 2000) || '',
  };

  const systemPrompt = buildWritingSystemPrompt(input as any);
  const userPrompt = buildWritingUserPrompt(input as any);

  console.log('Generating article with new prompts...\n');

  const result = await model.generateContent({
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  });

  const text = result.response.text();

  // Save the output
  fs.writeFileSync('test-results/test-article-output.html', text);
  console.log(`Generated ${text.length} characters`);
  console.log('Saved to test-results/test-article-output.html');

  // Quick quality checks
  const hasDoubleQuotes = text.includes('\u201C') || text.includes('\u201D');
  const softEndings = (text.match(/ですよね|ですね|なんです/g) || []).length;
  const metaphors = (text.match(/たとえば|まるで|のように|みたいに/g) || []).length;
  const abstractWords = ['宇宙のエネルギー', '高い波動', 'アセンション'].filter(w => text.includes(w));

  console.log('\n=== Quick Check ===');
  console.log(`"" usage: ${hasDoubleQuotes ? 'FAIL' : 'PASS'}`);
  console.log(`Soft endings (ですよね等): ${softEndings}個`);
  console.log(`Metaphor signals: ${metaphors}個`);
  console.log(`Abstract words: ${abstractWords.length > 0 ? abstractWords.join(', ') : 'NONE (PASS)'}`);
}

main().catch(console.error);
