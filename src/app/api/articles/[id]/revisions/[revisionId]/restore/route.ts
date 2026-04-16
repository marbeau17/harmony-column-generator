// POST /api/articles/[id]/revisions/[revisionId]/restore - Restore a revision
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { restoreRevision } from '@/lib/db/article-revisions';

type RouteParams = { params: { id: string; revisionId: string } };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const revision = await restoreRevision(params.id, params.revisionId);
    return NextResponse.json({
      message: `リビジョン #${revision.revision_number} に復元しました`,
      revision,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
