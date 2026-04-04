// ============================================================================
// src/app/api/ai/test-connection/route.ts
// POST /api/ai/test-connection
// Gemini API 接続テスト（スピリチュアルコラム向け・Supabase使用）
//
// 環境変数の GEMINI_API_KEY を使い、簡単なテストプロンプトを送信して応答を確認。
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function POST(): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. APIキー取得（環境変数から）
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'GEMINI_API_KEY が設定されていません。環境変数を確認してください。' },
      { status: 400 },
    );
  }

  const model = process.env.GEMINI_MODEL || 'gemini-pro';
  const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;

  // 3. テストリクエスト送信
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'テスト接続です。「OK」とだけ返してください。' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 32,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      return NextResponse.json({
        success: false,
        error: `Gemini API エラー (${response.status}): ${errorBody.substring(0, 200)}`,
        model,
      });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokenUsage = data.usageMetadata || {};

    return NextResponse.json({
      success: true,
      model,
      response: text.substring(0, 100),
      tokenUsage: {
        promptTokens: tokenUsage.promptTokenCount || 0,
        completionTokens: tokenUsage.candidatesTokenCount || 0,
        totalTokens: tokenUsage.totalTokenCount || 0,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isTimeout = msg.includes('AbortError') || msg.includes('abort');

    return NextResponse.json({
      success: false,
      error: isTimeout ? 'タイムアウト（15秒）' : msg,
      model,
    });
  }
}
