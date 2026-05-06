// ============================================================================
// src/app/api/log/route.ts
// P5-G6: ブラウザ側 console イベントを Vercel 構造化ログへ echo するエンドポイント。
// ----------------------------------------------------------------------------
// 仕様:
//   - POST のみ受け付ける（GET/PUT/DELETE は 405）
//   - 認証は不要（誰でも送れる）。ただし下記の安全策で abuse を抑止する。
//   - body schema: { category, action, level, details? }
//       * category : 既存 server logger と同じ範囲を許容（'client' を追加）
//       * action   : 1〜80 文字の英数 + _ /  -
//       * level    : 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
//       * details  : 任意のオブジェクト（payload size <= 4KB に制限）
//   - rate limit: IP ベース簡易版。1 client につき 100 events / 分。
//   - 受信時は server-side logger に同じ category/action で再 emit する。
//   - レスポンスは {ok: true} or {error: string} の最小形（payload snake_case）。
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  checkRateLimit,
  RATE_LIMIT_MAX_PER_MINUTE,
} from '@/lib/log/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── スキーマ ────────────────────────────────────────────────────────────
const ALLOWED_CATEGORIES = [
  'client',
  'api',
  'ai',
  'auth',
  'db',
  'system',
  'generator',
  'deploy',
  'related-articles',
  'export',
  'utility',
] as const;
type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

const ALLOWED_LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG'] as const;
type AllowedLevel = (typeof ALLOWED_LEVELS)[number];

// 4KB を超える payload は弾く（攻撃ベクター抑止）
const MAX_PAYLOAD_BYTES = 4096;

const logBodySchema = z.object({
  category: z.enum(ALLOWED_CATEGORIES),
  action: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_./:-]+$/, {
      message: 'action は英数 _ . - / : のみ使用可能',
    }),
  level: z.enum(ALLOWED_LEVELS),
  details: z.record(z.unknown()).optional(),
});

// Rate limit ロジックは src/lib/log/rate-limit.ts に分離（Next.js App Router の
// route.ts は HTTP method 等の限定された field しか export 不可のため）。

function getClientKey(req: NextRequest): string {
  // Vercel/Edge では x-forwarded-for, x-real-ip が付与される。
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

function emitToServerLogger(
  level: AllowedLevel,
  category: AllowedCategory,
  action: string,
  details: Record<string, unknown> | undefined,
  meta: Record<string, unknown>,
): void {
  // server-side logger の 4 段階に対応付ける。
  // category 'client' は server logger 側で未定義なので 'system' に正規化する。
  const serverCategory = category === 'client' ? 'system' : category;
  const merged = { ...(details ?? {}), ...meta, source: 'client' };
  switch (level) {
    case 'ERROR':
      logger.error(serverCategory, action, merged);
      break;
    case 'WARN':
      logger.warn(serverCategory, action, merged);
      break;
    case 'DEBUG':
      logger.debug(serverCategory, action, merged);
      break;
    default:
      logger.info(serverCategory, action, merged);
      break;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // payload size 制限（軽量チェック: Content-Length ヘッダ）
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', max_bytes: MAX_PAYLOAD_BYTES },
      { status: 413 },
    );
  }

  // rate limit
  const clientKey = getClientKey(req);
  if (!checkRateLimit(clientKey)) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', max_per_minute: RATE_LIMIT_MAX_PER_MINUTE },
      { status: 429 },
    );
  }

  // body parse
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // 受信ボディが MAX_PAYLOAD_BYTES を超えるケース（Content-Length 未送信）の二重防御。
  const serialized = JSON.stringify(raw ?? {});
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', max_bytes: MAX_PAYLOAD_BYTES },
      { status: 413 },
    );
  }

  const parsed = logBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { category, action, level, details } = parsed.data;
  const userAgent = req.headers.get('user-agent') ?? null;
  emitToServerLogger(level, category, action, details, {
    client_ip: clientKey,
    user_agent: userAgent,
  });

  return NextResponse.json({ ok: true });
}

// 他 method は明示的に 405 を返す（ノイズ低減）
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
