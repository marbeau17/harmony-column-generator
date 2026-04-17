import { createServiceRoleClient } from '@/lib/supabase/server';

// ─── 既存テーブル構造に準拠 ─────────────────────────────────────────────
// article_revisions: id, article_id, revision_number, html_snapshot, change_type, changed_by, comment, created_at
// title/meta_descriptionはcommentフィールドにJSON形式で保持

export interface ArticleRevision {
  id: string;
  article_id: string;
  revision_number: number;
  html_snapshot: string;
  change_type: string;
  changed_by: string | null;
  comment: string | null;
  created_at: string;
  // commentからパース
  title?: string;
  meta_description?: string;
}

interface RevisionMeta {
  title?: string;
  meta_description?: string;
}

function packComment(meta: RevisionMeta): string {
  return JSON.stringify(meta);
}

function unpackComment(comment: string | null): RevisionMeta {
  if (!comment) return {};
  try { return JSON.parse(comment); } catch { return {}; }
}

/**
 * Save a snapshot of the current article before update.
 * Keeps only the last 3 revisions per article.
 */
export async function saveRevision(
  articleId: string,
  snapshot: { title?: string; body_html: string; meta_description?: string },
  changeType: string = 'manual_save',
  changedBy?: string,
): Promise<void> {
  const supabase = await createServiceRoleClient();

  // Get next revision number
  const { data: latest } = await supabase
    .from('article_revisions')
    .select('revision_number')
    .eq('article_id', articleId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextRevision = (latest?.revision_number ?? 0) + 1;

  // Insert new revision
  await supabase.from('article_revisions').insert({
    article_id: articleId,
    revision_number: nextRevision,
    html_snapshot: snapshot.body_html,
    change_type: changeType,
    changed_by: changedBy || null,
    comment: packComment({ title: snapshot.title, meta_description: snapshot.meta_description }),
  });

  // Delete old revisions (keep only last 3)
  const { data: all } = await supabase
    .from('article_revisions')
    .select('id')
    .eq('article_id', articleId)
    .order('created_at', { ascending: false });

  if (all && all.length > 3) {
    const toDelete = all.slice(3).map(r => r.id);
    await supabase.from('article_revisions').delete().in('id', toDelete);
  }
}

/**
 * Get revision history for an article (max 3).
 */
export async function getRevisions(articleId: string): Promise<ArticleRevision[]> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('article_revisions')
    .select('*')
    .eq('article_id', articleId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) throw new Error(`getRevisions failed: ${error.message}`);

  return (data || []).map(r => {
    const meta = unpackComment(r.comment);
    return { ...r, title: meta.title, meta_description: meta.meta_description } as ArticleRevision;
  });
}

/**
 * Restore an article from a revision.
 */
export async function restoreRevision(
  articleId: string,
  revisionId: string,
): Promise<ArticleRevision> {
  const supabase = await createServiceRoleClient();

  const { data: revision, error } = await supabase
    .from('article_revisions')
    .select('*')
    .eq('id', revisionId)
    .eq('article_id', articleId)
    .single();

  if (error || !revision) throw new Error('Revision not found');

  // Save current state before restoring
  const { data: current } = await supabase
    .from('articles')
    .select('title, stage2_body_html, stage3_final_html, meta_description')
    .eq('id', articleId)
    .single();

  if (current) {
    await saveRevision(articleId, {
      title: current.title,
      body_html: current.stage3_final_html || current.stage2_body_html || '',
      meta_description: current.meta_description,
    }, 'restore_backup');
  }

  // Restore
  const meta = unpackComment(revision.comment);
  const updateData: Record<string, unknown> = {
    stage2_body_html: revision.html_snapshot,
    stage3_final_html: revision.html_snapshot,
  };
  if (meta.title) updateData.title = meta.title;
  if (meta.meta_description) updateData.meta_description = meta.meta_description;

  await supabase.from('articles').update(updateData).eq('id', articleId);

  return { ...revision, title: meta.title, meta_description: meta.meta_description } as ArticleRevision;
}
