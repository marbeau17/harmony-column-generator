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
  { key: 'ga_id', value: 'G-TH2XJ24V3T' },
  { key: 'gtm_id', value: 'GT-W6KD34W3' },
  {
    key: 'cta',
    value: JSON.stringify({
      cta1: {
        url: 'https://harmony-mc.com/counseling/',
        buttonText: 'カウンセリングについて詳しく見る',
        catchText: '',
        subText: '',
        bannerUrl: '',
        bannerAlt: 'スピリチュアルカウンセリングのご案内',
      },
      cta2: {
        url: 'https://harmony-mc.com/system/',
        buttonText: 'ご予約の流れを確認する',
        catchText: '',
        subText: '',
        bannerUrl: '',
        bannerAlt: 'カウンセリングご予約の流れ',
      },
      cta3: {
        url: 'https://harmony-booking.web.app/',
        buttonText: 'カウンセリングを予約する',
        catchText: '',
        subText: '',
        bannerUrl: '',
        bannerAlt: 'カウンセリングのご予約',
      },
    }),
  },
];

const personas = [
  { name: '美咲', description: '30代女性。都会で働くキャリアウーマン。', tone_guide: '親しみやすく、少しカジュアル', age_range: '30-39', search_patterns: ['ヨガ', '瞑想', 'アロマ'] },
  { name: '裕子', description: '40代女性。子育てが一段落した主婦。', tone_guide: '優しく包み込むような語り口', age_range: '40-49', search_patterns: ['パワーストーン', '占い'] },
  { name: '恵理', description: '50代女性。心身の不調を改善したい。', tone_guide: '落ち着いた大人の語り口', age_range: '50-59', search_patterns: ['気功', '東洋医学', '瞑想'] },
  { name: '彩花', description: '20代女性。SNSでスピリチュアル系をフォロー。', tone_guide: '明るくポップ、共感を重視', age_range: '20-29', search_patterns: ['タロット', 'オラクルカード'] },
  { name: '和子', description: '60代女性。人生の後半を豊かに過ごしたい。', tone_guide: '穏やかで慈愛に満ちた語り口', age_range: '60-69', search_patterns: ['写経', '神社仏閣'] },
  { name: '真由美', description: '45歳女性。離婚を経験し自分を見つめ直す。', tone_guide: '寄り添うような温かい語り口', age_range: '40-49', search_patterns: ['カウンセリング', 'ヒーリング'] },
  { name: '奈々', description: '35歳女性。スピリチュアルビジネスに興味。', tone_guide: '前向きでエネルギッシュ', age_range: '30-39', search_patterns: ['起業', 'コーチング'] },
];

const themes = [
  { name: 'スピリチュアルな目覚め', slug: 'soul-mission', category: 'spiritual', energy_method: '光', description: '魂の成長、覚醒、自己発見に関するテーマ' },
  { name: 'ヒーリングと癒し', slug: 'healing', category: 'healing', energy_method: '水', description: '心身の癒し、エネルギーヒーリング、セルフケアに関するテーマ' },
  { name: '引き寄せの法則', slug: 'self-growth', category: 'self_growth', energy_method: '火', description: '願望実現、アファメーション、ポジティブシンキングに関するテーマ' },
  { name: '人間関係とソウルメイト', slug: 'relationships', category: 'relationships', energy_method: '風', description: '魂のつながり、ツインレイ、人間関係の浄化に関するテーマ' },
  { name: '自然とつながる暮らし', slug: 'daily-awareness', category: 'daily', energy_method: '地', description: '自然のリズム、月の満ち欠け、季節の行事に関するテーマ' },
  { name: '直感とサイキック能力', slug: 'spiritual-intro', category: 'spiritual', energy_method: '空', description: '直感力の開発、第六感、チャネリングに関するテーマ' },
  { name: '日本の精神文化', slug: 'grief-care', category: 'grief_care', energy_method: '地', description: '神道、仏教、和の心、日本古来のスピリチュアリティに関するテーマ' },
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
