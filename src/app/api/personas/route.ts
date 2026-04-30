// ============================================================================
// src/app/api/personas/route.ts
// GET /api/personas — ペルソナ一覧取得（ゼロ生成フォームの persona_id bind 用）
//
// 仕様:
//   - 認証必須
//   - query param: is_active (true/false、default true)
//   - service role 経由で personas テーブルから SELECT
//   - name 昇順ソート
//   - GET のみ（write 系メソッドは未実装）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

interface PersonaResponse {
  id: string;
  name: string;
  age_range: string | null;
  description: string | null;
  search_patterns: string[];
  tone_guide: string | null;
  cta_approach: string | null;
  preferred_words: string[];
  avoided_words: string[];
  image_style: Record<string, unknown> | null;
  cta_default_stage: string | null;
  is_active: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // クエリパラメータ取得（is_active のデフォルトは true）
    const { searchParams } = request.nextUrl;
    const isActiveParam = searchParams.get('is_active');
    const isActive =
      isActiveParam === null ? true : isActiveParam.toLowerCase() === 'true';

    // service role 経由で personas SELECT
    const serviceClient = await createServiceRoleClient();
    const { data, error } = await serviceClient
      .from('personas')
      .select(
        'id, name, age_range, description, search_patterns, tone_guide, cta_approach, preferred_words, avoided_words, image_style, cta_default_stage, is_active',
      )
      .eq('is_active', isActive)
      .order('name', { ascending: true });

    if (error) {
      logger.error('api', 'listPersonas', undefined, error);
      return NextResponse.json(
        { error: 'ペルソナ一覧の取得に失敗しました' },
        { status: 500 },
      );
    }

    // レスポンス整形（null/配列のデフォルトを保証）
    const personas: PersonaResponse[] = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      age_range: row.age_range ?? null,
      description: row.description ?? null,
      search_patterns: row.search_patterns ?? [],
      tone_guide: row.tone_guide ?? null,
      cta_approach: row.cta_approach ?? null,
      preferred_words: row.preferred_words ?? [],
      avoided_words: row.avoided_words ?? [],
      image_style: row.image_style ?? null,
      cta_default_stage: row.cta_default_stage ?? null,
      is_active: row.is_active ?? true,
    }));

    logger.info('api', 'listPersonas', {
      isActive,
      count: personas.length,
    });

    return NextResponse.json({ personas });
  } catch (error) {
    logger.error('api', 'listPersonas', undefined, error);
    return NextResponse.json(
      { error: 'ペルソナ一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}
