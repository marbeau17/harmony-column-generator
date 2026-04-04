// ============================================================================
// src/types/plan.ts
// コンテンツプラン & 生成キューの型定義
// ============================================================================

// ─── Content Plan ─────────────────────────────────────────────────────────

export type PlanStatus = 'draft' | 'approved' | 'rejected' | 'processing' | 'completed';

export interface ContentPlan {
  id: string;
  batch_id: string;
  keyword: string;
  theme: string;
  persona: string;
  perspective_type: string;
  target_word_count: number;
  status: PlanStatus;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  keyword: string;
  theme?: string;
  persona?: string;
  perspective_type?: string;
  target_word_count?: number;
  batch_id?: string;
}

// ─── Generation Queue ─────────────────────────────────────────────────────

export type QueueStep =
  | 'pending'
  | 'outline'
  | 'body'
  | 'images'
  | 'seo_check'
  | 'completed'
  | 'failed';

export interface GenerationQueueItem {
  id: string;
  plan_id: string;
  article_id: string | null;
  step: QueueStep;
  priority: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  /** Joined data */
  content_plan?: ContentPlan;
}
