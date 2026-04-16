import { createServiceRoleClient } from '@/lib/supabase/server';

export interface ArticleRevision {
  id: string;
  article_id: string;
  revision_number: number;
  title: string | null;
  body_html: string;
  meta_description: string | null;
  change_type: string;
  changed_by: string | null;
  created_at: string;
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
    title: snapshot.title || null,
    body_html: snapshot.body_html,
    meta_description: snapshot.meta_description || null,
    change_type: changeType,
    changed_by: changedBy || null,
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
  return (data || []) as ArticleRevision[];
}

/**
 * Restore an article from a revision.
 */
export async function restoreRevision(
  articleId: string,
  revisionId: string,
): Promise<ArticleRevision> {
  const supabase = await createServiceRoleClient();

  // Get the revision
  const { data: revision, error } = await supabase
    .from('article_revisions')
    .select('*')
    .eq('id', revisionId)
    .eq('article_id', articleId)
    .single();

  if (error || !revision) throw new Error('Revision not found');

  // Save current state as a new revision before restoring
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

  // Restore the article
  await supabase.from('articles').update({
    title: revision.title,
    stage2_body_html: revision.body_html,
    stage3_final_html: revision.body_html,
    meta_description: revision.meta_description,
  }).eq('id', articleId);

  return revision as ArticleRevision;
}
