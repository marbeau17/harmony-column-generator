-- =============================================================================
-- Zero-Generation E2E shadow seed (spec §13.4)
--
-- 構成:
--   - source_articles: 100 件 (mock data)
--   - personas:        5 件
--   - themes:          8 件
--
-- 命名規約:
--   - すべてのレコードは `zg_` プレフィックスで名前空間分離
--   - 既存 1,499 件のアメブロソース / 45 件の生成記事 / monkey-* には触れない
--
-- 冪等性:
--   - 再実行時は ON CONFLICT (name) / (slug) で no-op
--   - cleanup は test/e2e/helpers/zero-generation-fixtures.ts:cleanupZeroFixtures()
--
-- 適用方法 (shadow DB のみ):
--   psql "$MONKEY_SUPABASE_URL" -f test/e2e/fixtures/zero-generation-seed.sql
--
-- ⚠ 本番 DB には絶対適用しないこと。MONKEY_SUPABASE_URL 経由でのみ流す。
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. themes 8 件
-- -----------------------------------------------------------------------------
INSERT INTO themes (name, slug, category, energy_method, description, is_active, sort_order) VALUES
  ('zg_self_love',        'zg-self-love',        'spiritual', 'energy_clearing', 'ZG: 自己愛と自己受容',          TRUE, 1),
  ('zg_grief_healing',    'zg-grief-healing',    'spiritual', 'energy_clearing', 'ZG: 喪失とグリーフケア',         TRUE, 2),
  ('zg_inner_child',      'zg-inner-child',      'spiritual', 'inner_child',     'ZG: インナーチャイルドの癒し',    TRUE, 3),
  ('zg_relationship',     'zg-relationship',     'spiritual', 'energy_clearing', 'ZG: 人間関係の調和',             TRUE, 4),
  ('zg_career_purpose',   'zg-career-purpose',   'spiritual', 'inner_child',     'ZG: 天職と魂の目的',             TRUE, 5),
  ('zg_intuition',        'zg-intuition',        'spiritual', 'energy_clearing', 'ZG: 直感と内なる声',             TRUE, 6),
  ('zg_abundance',        'zg-abundance',        'spiritual', 'energy_clearing', 'ZG: 豊かさと循環',               TRUE, 7),
  ('zg_transition',       'zg-transition',       'spiritual', 'inner_child',     'ZG: 人生の転機と変容',           TRUE, 8)
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. personas 5 件
-- -----------------------------------------------------------------------------
INSERT INTO personas (name, age_range, description, search_patterns, tone_guide, cta_approach, is_active, sort_order) VALUES
  ('zg_persona_a_seeker',
   '30-40',
   'ZG: 自己探求中の30代女性。スピリチュアルに関心はあるが懐疑的な部分も持つ。',
   ARRAY['自分らしさ','本当の私','心の声'],
   '優しく、断定せず、共感を中心に。比喩を多めに。',
   'empathy',
   TRUE, 1),

  ('zg_persona_b_pragmatic',
   '40-55',
   'ZG: 現実的な40-50代女性。具体的な解決策を求めるタイプ。',
   ARRAY['解決','方法','変えたい'],
   '簡潔・実践的、断定は避けるが行動指針は明確に。',
   'action',
   TRUE, 2),

  ('zg_persona_c_grieving',
   '35-60',
   'ZG: 大切なものを失った直後の方。深いグリーフ状態。',
   ARRAY['喪失','悲しみ','立ち直れない'],
   '極めて優しく、寄り添いを最優先。沈黙を許す表現。',
   'empathy',
   TRUE, 3),

  ('zg_persona_d_transitioning',
   '25-45',
   'ZG: 人生の転機にいる方。退職・離婚・引越しなど。',
   ARRAY['転職','変化','決断'],
   '希望と不安の両方を肯定する語り。橋渡しの比喩。',
   'transition',
   TRUE, 4),

  ('zg_persona_e_introspective',
   '40-60',
   'ZG: 静かに内省を深めたい方。瞑想や日記の習慣あり。',
   ARRAY['内省','瞑想','本質'],
   '詩的で余白を残す。問いかけ多め、答えは委ねる。',
   'introspect',
   TRUE, 5)
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. source_articles 100 件 (mock data)
--
-- generate_series で機械的に作るが、すべて `zg_` プレフィックスで識別可能。
-- content は 200 字程度のダミー文。retrieval テストで実際の embedding が
-- 走る前に固定 chunk として使う想定。
-- -----------------------------------------------------------------------------
INSERT INTO source_articles (title, content, original_url, published_at, word_count, themes, keywords, emotional_tone, spiritual_concepts, is_processed)
SELECT
  'zg_source_' || LPAD(i::text, 3, '0') || '_自己受容についての一考察',
  '本当の自分を受け入れるとは、欠点も含めて全部抱きしめることだと思うのです。' ||
  '誰かと比べる必要はありません。あなたはあなたのままで、十分に光を放っています。' ||
  '今日はそんなお話を、私自身の体験を交えてお伝えしますね。 [ZG mock chunk #' || i || ']',
  'https://ameblo.example/zg/' || i,
  NOW() - (i || ' days')::interval,
  200 + (i % 50),
  CASE (i % 8)
    WHEN 0 THEN ARRAY['zg_self_love']
    WHEN 1 THEN ARRAY['zg_grief_healing']
    WHEN 2 THEN ARRAY['zg_inner_child']
    WHEN 3 THEN ARRAY['zg_relationship']
    WHEN 4 THEN ARRAY['zg_career_purpose']
    WHEN 5 THEN ARRAY['zg_intuition']
    WHEN 6 THEN ARRAY['zg_abundance']
    ELSE        ARRAY['zg_transition']
  END,
  ARRAY['zg_keyword_' || (i % 10)],
  CASE (i % 4)
    WHEN 0 THEN 'gentle'
    WHEN 1 THEN 'reflective'
    WHEN 2 THEN 'hopeful'
    ELSE 'tender'
  END,
  ARRAY['zg_concept_inner_voice','zg_concept_acceptance'],
  FALSE
FROM generate_series(1, 100) AS i
ON CONFLICT DO NOTHING;

COMMIT;
