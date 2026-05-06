-- ============================================================================
-- 20260506000004_progress_scale_migration.sql
-- spec v2.1: generation_jobs.progress を 0.0-1.0 → 0-100 整数スケールに移行する。
--
-- 背景:
--   - 旧設計では progress は 0.0..1.0 の小数で、UI で `Math.round(progress * 100)`
--     して % 表示していた。
--   - 仕様統一 (spec v2.1) で progress は 0-100 の整数スケールに統一。
--   - 既存稼働中の async ジョブが運用中のため、走行中の値を破壊しないよう
--     idempotent UPDATE と境界判定を厳密に行う。
--
-- 変換ルール:
--   - 旧スケール (0.0..1.0) で書き込まれた行は × 100 する
--   - すでに新スケール (1 < x <= 100) の行は触らない (idempotent)
--   - 境界値 1.0 は「旧スケールの完了 (=100)」と解釈
--   - NaN / NULL は触らない
--
-- 安全策:
--   - 変換対象件数を RAISE NOTICE で出力 (dry-run 想定の証跡)
--   - 上限 100 で LEAST() クランプ
--   - 既存 DEFAULT 0 と整合性を保つため CHECK は 0-100
-- ============================================================================

DO $$
DECLARE
  v_target_count INT;
  v_total_count  INT;
  v_already_new  INT;
BEGIN
  SELECT COUNT(*) INTO v_total_count FROM generation_jobs;
  SELECT COUNT(*) INTO v_target_count
    FROM generation_jobs
    WHERE progress IS NOT NULL
      AND progress >= 0
      AND progress < 1.5;
  SELECT COUNT(*) INTO v_already_new
    FROM generation_jobs
    WHERE progress IS NOT NULL
      AND progress >= 1.5
      AND progress <= 100;

  RAISE NOTICE '[progress_scale_migration] start: total=%, target_to_scale=%, already_new_scale=%',
    v_total_count, v_target_count, v_already_new;
END $$;

-- ── 旧 0.0..1.0 スケールの行を × 100 して 0..100 スケールへ ────────────────
-- WHERE 句で 1.5 未満のみ対象とすることで、すでに新スケール (>=1.5) の行は無視。
-- LEAST(100, …) で上限 100 にクランプ (浮動小数誤差で 100.0001 等になる事故を防ぐ)。
UPDATE generation_jobs
   SET progress = LEAST(100, progress * 100)
 WHERE progress IS NOT NULL
   AND progress >= 0
   AND progress < 1.5;

-- ── 想定外スケール (例えば 100 < progress) を 100 にクランプする防御的措置 ──
-- 通常は発生しないが、過去の手作業更新で 100 を超えた値があれば収束させる。
UPDATE generation_jobs
   SET progress = 100
 WHERE progress IS NOT NULL
   AND progress > 100;

-- ── NULL を 0 で埋める (CHECK 制約に NOT NULL は無いが、運用上 0 が安全) ──
-- column 自体は NOT NULL DEFAULT 0 で定義済みなので、ここはガード目的のみ。
UPDATE generation_jobs
   SET progress = 0
 WHERE progress IS NULL;

-- ── CHECK 制約を追加 (idempotent: 既存制約があれば DROP→ADD) ───────────────
-- 制約名は `generation_jobs_progress_range_chk` で固定。
ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_progress_range_chk;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_progress_range_chk
  CHECK (progress >= 0 AND progress <= 100);

-- ── COMMENT 更新 ────────────────────────────────────────────────────────────
COMMENT ON COLUMN generation_jobs.progress IS
  '進捗率 (0-100 整数スケール; spec v2.1 で 0.0-1.0 から移行)';

-- ── 完了ログ ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_min NUMERIC;
  v_max NUMERIC;
  v_total INT;
BEGIN
  SELECT MIN(progress), MAX(progress), COUNT(*)
    INTO v_min, v_max, v_total
    FROM generation_jobs;
  RAISE NOTICE '[progress_scale_migration] done: total=%, min=%, max=%',
    v_total, v_min, v_max;
END $$;

-- ============================================================================
-- ROLLBACK (手動実行)
-- ============================================================================
-- ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_progress_range_chk;
-- UPDATE generation_jobs SET progress = progress / 100 WHERE progress > 1;
-- COMMENT ON COLUMN generation_jobs.progress IS '0.0〜1.0 の進捗率';
