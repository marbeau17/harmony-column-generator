// ============================================================================
// src/app/api/settings/route.ts
// システム設定の取得 / 更新 API
// settings テーブル: key TEXT PRIMARY KEY, value JSONB, description TEXT, updated_at TIMESTAMPTZ
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  updateSettingsSchema,
  validateSectionData,
  type SettingsSection,
} from '@/lib/validators/settings';
import { logger } from '@/lib/logger';

// ─── GET /api/settings ──────────────────────────────────────────────────────
// settings テーブルの全行を取得し、key をキーとしたオブジェクトに変換して返す
// 例: { basic: {...}, ai: {...}, cta: {...}, seo: {...} }

export async function GET() {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // Service Role で設定取得（全行）
    const serviceClient = await createServiceRoleClient();
    const { data: rows, error } = await serviceClient
      .from('settings')
      .select('key, value');

    if (error) {
      throw new Error(`設定の取得に失敗しました: ${error.message}`);
    }

    // 配列を { key: value } オブジェクトに変換
    const settings: Record<string, unknown> = {};
    if (rows) {
      for (const row of rows) {
        // value は JSONB なので Supabase クライアントが自動的にパースしてくれる
        settings[row.key] = row.value;
      }
    }

    logger.info('api', 'getSettings');

    return NextResponse.json(settings);
  } catch (error) {
    logger.error('api', 'getSettings', undefined, error);
    return NextResponse.json(
      { error: 'システム設定の取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── PUT /api/settings ──────────────────────────────────────────────────────
// { section: "basic"|"ai"|"cta"|"seo", data: {...} } を受け取り
// settings テーブルに upsert する（key = section, value = data）

export async function PUT(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // リクエストボディ取得 & 基本バリデーション
    const body = await request.json();
    const parseResult = updateSettingsSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: parseResult.error.flatten() },
        { status: 400 },
      );
    }

    const { section, data } = parseResult.data;

    // セクション別のデータバリデーション
    const validation = validateSectionData(section as SettingsSection, data);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: validation.error },
        { status: 400 },
      );
    }

    // Service Role で upsert（key が PRIMARY KEY なので ON CONFLICT で更新）
    const serviceClient = await createServiceRoleClient();
    const { data: upserted, error } = await serviceClient
      .from('settings')
      .upsert(
        {
          key: section,
          value: validation.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      .select('key, value')
      .single();

    if (error) {
      throw new Error(`設定の更新に失敗しました: ${error.message}`);
    }

    logger.info('api', 'updateSettings', {
      section,
      updatedFields: Object.keys(validation.data as Record<string, unknown>),
    });

    return NextResponse.json({ data: upserted });
  } catch (error) {
    logger.error('api', 'updateSettings', undefined, error);
    return NextResponse.json(
      { error: 'システム設定の更新に失敗しました' },
      { status: 500 },
    );
  }
}
