-- P5-103: AIプランナー生成キュー進捗可視化のためのカラム追加
-- ============================================================
-- 対象テーブル: generation_queue (20260404200000_content_planner.sql で定義)
-- 目的: ステップごとの所要時間計測 (step_started_at) と
--       現在動作中の AI エージェント識別 (current_agent) を可視化
-- 制約: ADD COLUMN のみ。既存データ破壊禁止 (DROP / RENAME / ALTER COLUMN 一切なし)
-- RLS: generation_queue の既存 RLS ポリシー ("Authenticated access") をそのまま継承
-- 冪等性: IF NOT EXISTS を用いて再適用可能
-- ============================================================

ALTER TABLE generation_queue ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ;
ALTER TABLE generation_queue ADD COLUMN IF NOT EXISTS current_agent TEXT;

COMMENT ON COLUMN generation_queue.step_started_at IS 'P5-103: ステップごとの開始時刻（per-step duration 計測用）';
COMMENT ON COLUMN generation_queue.current_agent IS 'P5-103: 現在動作中の AI エージェント識別子（Planner/Generator/Evaluator/Publisher）';
