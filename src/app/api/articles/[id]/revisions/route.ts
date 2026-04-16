// GET /api/articles/[id]/revisions - List revision history (max 3)
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRevisions } from '@/lib/db/article-revisions';

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const revisions = await getRevisions(params.id);
    return NextResponse.json({ data: revisions });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
