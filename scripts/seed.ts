import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const settings = [
  { key: 'target_word_count', value: '2000' },
  { key: 'gemini_model', value: 'gemini-pro-3.1' },
  { key: 'default_persona', value: '美咲' },
  { key: 'cta_url', value: 'https://harmony-booking.web.app/' },
  { key: 'site_name', value: 'Spiritual Harmony' },
  { key: 'author_name', value: '小林由起子' },
];

const personas = [
  {
    name: '美咲',
    description: '30代女性。都会で働くキャリアウーマン。ストレス解消にスピリチュアルに興味を持ち始めた。',
    tone: '親しみやすく、少しカジュアル',
    age_range: '30-39',
    interests: 'ヨガ、瞑想、アロマテラピー、自己啓発',
  },
  {
    name: '裕子',
    description: '40代女性。子育てが一段落し、自分の時間を取り戻したいと感じている主婦。',
    tone: '優しく包み込むような語り口',
    age_range: '40-49',
    interests: 'ハーブティー、パワーストーン、占い、ガーデニング',
  },
  {
    name: '恵理',
    description: '50代女性。更年期を迎え、心身の不調をスピリチュアルな視点で改善したいと考えている。',
    tone: '落ち着いた大人の語り口',
    age_range: '50-59',
    interests: '温泉、気功、東洋医学、瞑想リトリート',
  },
  {
    name: '彩花',
    description: '20代女性。SNSでスピリチュアル系インフルエンサーをフォローしている。直感で動くタイプ。',
    tone: '明るくポップ、共感を重視',
    age_range: '20-29',
    interests: 'タロット、オラクルカード、月のリズム、マインドフルネス',
  },
  {
    name: '和子',
    description: '60代女性。人生の後半戦を豊かに過ごしたいと願うシニア世代。',
    tone: '穏やかで慈愛に満ちた語り口',
    age_range: '60-69',
    interests: '写経、神社仏閣巡り、座禅、読書',
  },
  {
    name: '真由美',
    description: '45歳女性。離婚を経験し、自分自身を見つめ直す旅の途中。',
    tone: '寄り添うような温かい語り口',
    age_range: '40-49',
    interests: 'カウンセリング、インナーチャイルド、ヒーリング、旅行',
  },
  {
    name: '奈々',
    description: '35歳女性。スピリチュアルビジネスに興味があり、自分でもサービスを始めたいと思っている。',
    tone: '前向きでエネルギッシュ',
    age_range: '30-39',
    interests: '起業、コーチング、エネルギーワーク、ブランディング',
  },
];

const themes = [
  {
    name: 'スピリチュアルな目覚め',
    description: '魂の成長、覚醒、自己発見に関するテーマ',
    keywords: '目覚め,覚醒,気づき,魂の成長,ハイヤーセルフ',
  },
  {
    name: 'ヒーリングと癒し',
    description: '心身の癒し、エネルギーヒーリング、セルフケアに関するテーマ',
    keywords: 'ヒーリング,癒し,浄化,エネルギー,レイキ,セルフケア',
  },
  {
    name: '引き寄せの法則',
    description: '願望実現、アファメーション、ポジティブシンキングに関するテーマ',
    keywords: '引き寄せ,願望実現,アファメーション,波動,豊かさ',
  },
  {
    name: '人間関係とソウルメイト',
    description: '魂のつながり、ツインレイ、人間関係の浄化に関するテーマ',
    keywords: 'ソウルメイト,ツインレイ,人間関係,ご縁,カルマ',
  },
  {
    name: '自然とつながる暮らし',
    description: '自然のリズム、月の満ち欠け、季節の行事に関するテーマ',
    keywords: '自然,月,季節,グラウンディング,アーシング',
  },
  {
    name: '直感とサイキック能力',
    description: '直感力の開発、第六感、チャネリングに関するテーマ',
    keywords: '直感,第六感,チャクラ,サードアイ,チャネリング',
  },
  {
    name: '日本の精神文化',
    description: '神道、仏教、和の心、日本古来のスピリチュアリティに関するテーマ',
    keywords: '神社,仏閣,禅,お祓い,言霊,和の心',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Seeding settings...');
  for (const s of settings) {
    const { error } = await supabase
      .from('settings')
      .upsert(s, { onConflict: 'key' });

    if (error) {
      console.error(`  Failed to upsert setting "${s.key}":`, error.message);
    } else {
      console.log(`  ${s.key} = ${s.value}`);
    }
  }

  console.log('\nSeeding personas...');
  const { error: personaErr } = await supabase
    .from('personas')
    .upsert(personas, { onConflict: 'name' });

  if (personaErr) {
    console.error('  Failed to upsert personas:', personaErr.message);
  } else {
    console.log(`  ${personas.length} personas upserted.`);
  }

  console.log('\nSeeding themes...');
  const { error: themeErr } = await supabase
    .from('themes')
    .upsert(themes, { onConflict: 'name' });

  if (themeErr) {
    console.error('  Failed to upsert themes:', themeErr.message);
  } else {
    console.log(`  ${themes.length} themes upserted.`);
  }

  console.log('\nSeed complete!');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
