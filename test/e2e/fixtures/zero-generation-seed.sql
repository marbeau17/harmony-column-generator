-- =============================================================================
-- Zero-Generation E2E shadow seed (spec §13.4)
--
-- 構成:
--   - themes:          8 件 (visual_mood 付き)
--   - personas:        5 件 (preferred_words / avoided_words / image_style / cta_default_stage 付き)
--   - source_articles: 100 件 (mock data, zg_ プレフィックス)
--   - source_chunks:   50 件 (random embedding vector(768))
--
-- 命名規約:
--   - すべてのレコードは `zg_` プレフィックスで名前空間分離
--   - 既存 1,499 件のアメブロソース / 45 件の生成記事 / monkey-* には触れない
--
-- 冪等性:
--   - INSERT は ON CONFLICT (name)/(slug) DO NOTHING で no-op
--   - UPDATE は WHERE name LIKE 'zg\_%' で範囲限定
--   - source_chunks は WHERE NOT EXISTS で重複防止
--   - cleanup は test/e2e/helpers/zero-generation-fixtures.ts:cleanupZeroFixtures()
--
-- 適用方法 (shadow DB のみ):
--   psql "$MONKEY_SUPABASE_URL" -f test/e2e/fixtures/zero-generation-seed.sql
--
-- 警告 本番 DB には絶対適用しないこと。MONKEY_SUPABASE_URL 経由でのみ流す。
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. themes 8 件
--    spec H15: grief_care / soul_mission / relationships / self_growth /
--              self_acceptance / inner_child / spiritual_awakening / daily_mindfulness
--    既存 seed の 8 件 (zg_self_love 等) は意味的にカバーされているため再利用し、
--    UPDATE で visual_mood (motif / color_hsl / lighting) を付与する。
-- -----------------------------------------------------------------------------
INSERT INTO themes (name, slug, category, energy_method, description, is_active, sort_order) VALUES
  ('zg_self_love',        'zg-self-love',        'spiritual', 'energy_clearing', 'ZG: 自己愛と自己受容 (self_acceptance)',          TRUE, 1),
  ('zg_grief_healing',    'zg-grief-healing',    'spiritual', 'energy_clearing', 'ZG: 喪失とグリーフケア (grief_care)',              TRUE, 2),
  ('zg_inner_child',      'zg-inner-child',      'spiritual', 'inner_child',     'ZG: インナーチャイルドの癒し (inner_child)',        TRUE, 3),
  ('zg_relationship',     'zg-relationship',     'spiritual', 'energy_clearing', 'ZG: 人間関係の調和 (relationships)',               TRUE, 4),
  ('zg_career_purpose',   'zg-career-purpose',   'spiritual', 'inner_child',     'ZG: 天職と魂の目的 (soul_mission)',                 TRUE, 5),
  ('zg_intuition',        'zg-intuition',        'spiritual', 'energy_clearing', 'ZG: 直感と内なる声 (spiritual_awakening)',          TRUE, 6),
  ('zg_abundance',        'zg-abundance',        'spiritual', 'energy_clearing', 'ZG: 豊かさと循環 (daily_mindfulness)',              TRUE, 7),
  ('zg_transition',       'zg-transition',       'spiritual', 'inner_child',     'ZG: 人生の転機と変容 (self_growth)',                TRUE, 8)
ON CONFLICT (name) DO NOTHING;

-- visual_mood 付与 (idempotent: zg_ 範囲のみ)
UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'soft_petal_open',
  'color_hsl', jsonb_build_array(28, 35, 70),
  'lighting',  'morning_warm'
) WHERE name = 'zg_self_love';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'still_water_drop',
  'color_hsl', jsonb_build_array(210, 25, 55),
  'lighting',  'overcast_gentle'
) WHERE name = 'zg_grief_healing';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'small_hand_in_light',
  'color_hsl', jsonb_build_array(45, 50, 75),
  'lighting',  'afternoon_window'
) WHERE name = 'zg_inner_child';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'two_paths_braided',
  'color_hsl', jsonb_build_array(140, 30, 60),
  'lighting',  'soft_diffused'
) WHERE name = 'zg_relationship';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'distant_summit_dawn',
  'color_hsl', jsonb_build_array(15, 45, 65),
  'lighting',  'sunrise_glow'
) WHERE name = 'zg_career_purpose';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'inner_flame_calm',
  'color_hsl', jsonb_build_array(280, 35, 60),
  'lighting',  'twilight_quiet'
) WHERE name = 'zg_intuition';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'overflowing_cup',
  'color_hsl', jsonb_build_array(50, 55, 70),
  'lighting',  'golden_hour'
) WHERE name = 'zg_abundance';

UPDATE themes SET visual_mood = jsonb_build_object(
  'motif',     'butterfly_emerging',
  'color_hsl', jsonb_build_array(190, 40, 65),
  'lighting',  'breaking_clouds'
) WHERE name = 'zg_transition';

-- -----------------------------------------------------------------------------
-- 2. personas 5 件
--    spec H15: 30代主婦 / 40代キャリア / 50代女性 / 20代独身 / 60代以上
--    既存 seed の 5 件は属性的に近似マッピング:
--      zg_persona_a_seeker        ≒ 30代主婦 (不安期, 家族関係)
--      zg_persona_b_pragmatic     ≒ 40代キャリア (自己探求, 転換期)
--      zg_persona_c_grieving      ≒ 50代女性 (人生再編, グリーフ)
--      zg_persona_d_transitioning ≒ 20代独身 (恋愛/自己肯定の転換)
--      zg_persona_e_introspective ≒ 60代以上 (人生振返り)
-- -----------------------------------------------------------------------------
INSERT INTO personas (name, age_range, description, search_patterns, tone_guide, cta_approach, is_active, sort_order) VALUES
  ('zg_persona_a_seeker',
   '30-40',
   'ZG: 30代主婦。不安期にあり、家族関係に悩みつつ自分らしさを探している。',
   ARRAY['自分らしさ','本当の私','心の声','家族','不安'],
   '優しく、断定せず、共感を中心に。比喩を多めに。',
   'empathy',
   TRUE, 1),

  ('zg_persona_b_pragmatic',
   '40-55',
   'ZG: 40代キャリア女性。自己探求の転換期にあり、具体的な道筋を求める。',
   ARRAY['解決','方法','変えたい','キャリア','転機'],
   '簡潔・実践的、断定は避けるが行動指針は明確に。',
   'action',
   TRUE, 2),

  ('zg_persona_c_grieving',
   '50-65',
   'ZG: 50代女性。人生再編の只中で、深いグリーフ (家族との別離等) を抱える。',
   ARRAY['喪失','悲しみ','立ち直れない','人生再編','空虚'],
   '極めて優しく、寄り添いを最優先。沈黙を許す表現。',
   'empathy',
   TRUE, 3),

  ('zg_persona_d_transitioning',
   '20-35',
   'ZG: 20代独身。恋愛と自己肯定の揺らぎ。人生の方向性を模索中。',
   ARRAY['恋愛','自己肯定','変化','決断','私らしく'],
   '希望と不安の両方を肯定する語り。橋渡しの比喩。',
   'transition',
   TRUE, 4),

  ('zg_persona_e_introspective',
   '60-80',
   'ZG: 60代以上。人生を振り返り、静かに内省を深めたい方。',
   ARRAY['内省','瞑想','本質','人生振返り','余生'],
   '詩的で余白を残す。問いかけ多め、答えは委ねる。',
   'introspect',
   TRUE, 5)
ON CONFLICT (name) DO NOTHING;

-- preferred_words / avoided_words / image_style / cta_default_stage 付与
UPDATE personas SET
  preferred_words   = ARRAY['寄り添う','そっと','ゆっくり','大丈夫','あなた'],
  avoided_words     = ARRAY['絶対','治る','正解','間違い','〜すべき'],
  image_style       = jsonb_build_object('palette','warm_pastel','subject','window_with_curtain','mood','tender'),
  cta_default_stage = 'empathy'
WHERE name = 'zg_persona_a_seeker';

UPDATE personas SET
  preferred_words   = ARRAY['一歩','選ぶ','整える','視点','流れ'],
  avoided_words     = ARRAY['必ず','絶対','成功保証','即効'],
  image_style       = jsonb_build_object('palette','clear_morning','subject','open_path','mood','clarifying'),
  cta_default_stage = 'action'
WHERE name = 'zg_persona_b_pragmatic';

UPDATE personas SET
  preferred_words   = ARRAY['そのままで','許す','抱きしめる','涙','静けさ'],
  avoided_words     = ARRAY['乗り越える','早く','忘れる','前向きに'],
  image_style       = jsonb_build_object('palette','dusk_mauve','subject','still_lake','mood','holding_silence'),
  cta_default_stage = 'empathy'
WHERE name = 'zg_persona_c_grieving';

UPDATE personas SET
  preferred_words   = ARRAY['揺れて良い','私らしく','一緒に','問いかけ','余白'],
  avoided_words     = ARRAY['正解','勝ち組','他人と比べて','失敗'],
  image_style       = jsonb_build_object('palette','soft_coral','subject','crossroad_dawn','mood','hopeful_wavering'),
  cta_default_stage = 'transition'
WHERE name = 'zg_persona_d_transitioning';

UPDATE personas SET
  preferred_words   = ARRAY['味わう','静か','澄んだ','記憶','光'],
  avoided_words     = ARRAY['若返り','遅すぎる','まだ間に合う','焦り'],
  image_style       = jsonb_build_object('palette','quiet_indigo','subject','candle_by_window','mood','contemplative'),
  cta_default_stage = 'introspect'
WHERE name = 'zg_persona_e_introspective';

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

-- -----------------------------------------------------------------------------
-- 4. source_chunks 50 件 (random vector(768) embedding)
--
-- - retrieval smoke test 用のダミーチャンク。
-- - 上記 source_articles 100 件のうち先頭 50 件 (zg_source_001..050) に紐付ける。
-- - embedding は random_normal 風の擬似ベクトル ([-1,1] 一様 → L2 正規化なし)。
--   pgvector の cosine 検索が走ることだけを確認する目的。
-- - content_hash で冪等性を確保 (同 article_id × chunk_index の重複を排除)。
-- -----------------------------------------------------------------------------
INSERT INTO source_chunks (
  source_article_id,
  chunk_index,
  chunk_text,
  embedding,
  themes,
  emotional_tone,
  spiritual_concepts,
  content_hash
)
SELECT
  sa.id,
  0 AS chunk_index,
  'ZG mock chunk for ' || sa.title || ' / 自分の心の声に耳を傾けることが、すべての始まりだと感じています。' AS chunk_text,
  -- random vector(768): array_agg で 768 個の random() 値を [-1, 1] にスケール
  (
    SELECT ('[' || string_agg(((random() * 2 - 1))::text, ',') || ']')::vector(768)
    FROM generate_series(1, 768)
  ) AS embedding,
  sa.themes,
  sa.emotional_tone,
  sa.spiritual_concepts,
  'zg_chunk_hash_' || LPAD(idx::text, 3, '0') AS content_hash
FROM (
  SELECT
    id,
    title,
    themes,
    emotional_tone,
    spiritual_concepts,
    ROW_NUMBER() OVER (ORDER BY title) AS idx
  FROM source_articles
  WHERE title LIKE 'zg\_source\_%' ESCAPE '\'
  ORDER BY title
  LIMIT 50
) AS sa
WHERE NOT EXISTS (
  SELECT 1 FROM source_chunks sc
  WHERE sc.source_article_id = sa.id AND sc.chunk_index = 0
);

COMMIT;
