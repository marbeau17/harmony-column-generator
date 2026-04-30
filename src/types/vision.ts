// ============================================================================
// src/types/vision.ts
// 画像ハルシネーション Vision 検査の型定義
// G6: Gemini Vision API による生成画像の検証結果
// ============================================================================

/**
 * 画像 Vision 検査の結果。
 *
 * Gemini Vision (gemini-2.5-flash 等) で生成画像を検査し、
 * テキスト混入・ロゴ混入・人体構造の破綻・テーマ整合性を判定する。
 *
 * - has_text:        画像内に文字（日本語・英数字・記号）が描画されていれば true
 * - has_logo:        画像内にロゴ・透かし・ブランドマークが描画されていれば true
 * - anatomy_ok:      人物が描かれている場合、指本数・関節・顔のパーツが破綻していなければ true
 *                    （人物が描かれていない場合も true）
 * - theme_alignment: 画像とテーマ／ペルソナとの整合性（0.0〜1.0）
 * - score:           総合スコア（0〜100）。70 未満で flagged 扱い
 * - flagged:         再生成推奨フラグ。score < 70 で true
 * - notes:           判定理由（人が読む短い説明）
 */
export interface VisionCheckResult {
  has_text: boolean;
  has_logo: boolean;
  anatomy_ok: boolean;
  theme_alignment: number;
  score: number;
  flagged: boolean;
  notes: string;
}
