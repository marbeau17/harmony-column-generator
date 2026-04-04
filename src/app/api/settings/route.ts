// ============================================================================
// src/app/api/settings/route.ts
// システム設定の取得 / 更新 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { updateSettingsSchema } from '@/lib/validators/settings';
import { logger } from '@/lib/logger';

// ─── GET /api/settings ──────────────────────────────────────────────────────

export async function GET() {
  try {
    // 認証チェック
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // Service Role で設定取得
    const serviceClient = createServiceRoleClient();
    const { data, error } = await serviceClient
      .from('settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`設定の取得に失敗しました: ${error.message}`);
    }

    logger.info('api', 'getSettings');

    return NextResponse.json({ data: data ?? {} });
  } catch (error) {
    logger.error('api', 'getSettings', undefined, error);
    return NextResponse.json(
      { error: 'システム設定の取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── PUT /api/settings ──────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // リクエストボディ取得 & バリデーション
    const body = await request.json();
    const result = updateSettingsSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: result.error.flatten() },
        { status: 400 },
      );
    }

    // Service Role で設定更新
    const serviceClient = createServiceRoleClient();

    // 既存の設定があるかチェック
    const { data: existing } = await serviceClient
      .from('settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    let data;
    let error;

    if (existing) {
      // 既存レコードを更新
      const res = await serviceClient
        .from('settings')
        .update({
          ...result.data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      data = res.data;
      error = res.error;
    } else {
      // 新規作成
      const res = await serviceClient
        .from('settings')
        .insert({
          ...result.data,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      data = res.data;
      error = res.error;
    }

    if (error) {
      throw new Error(`設定の更新に失敗しました: ${error.message}`);
    }

    logger.info('api', 'updateSettings', {
      updatedFields: Object.keys(result.data),
    });

    return NextResponse.json({ data });
  } catch (error) {
    logger.error('api', 'updateSettings', undefined, error);
    return NextResponse.json(
      { error: 'システム設定の更新に失敗しました' },
      { status: 500 },
    );
  }
}
