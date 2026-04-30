// ============================================================================
// test/unit/vision-check.test.ts
// G6: 画像ハルシネーション Vision 検査のユニットテスト
//   - calcScore: 各検出フィールドの境界値・スコア計算
//   - buildImagePart: 入力形式（base64 / data URL / URL）の振り分け
//   - checkImageHallucination: Gemini Vision REST API を vi.stubGlobal でスタブ
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildImagePart,
  calcScore,
  checkImageHallucination,
  FLAG_THRESHOLD,
} from '@/lib/image/vision-check';
import type { VisionCheckResult } from '@/types/vision';

// ─── helpers ─────────────────────────────────────────────────────────────────

function visionResponseFromBody(body: unknown): unknown {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** Gemini Vision の標準レスポンスを組み立てる */
function geminiVisionBody(jsonPayload: Record<string, unknown>) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(jsonPayload) }],
        },
        finishReason: 'STOP',
      },
    ],
  };
}

const SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeEach(() => {
  // Gemini API キーが必須なので注入
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_VISION_MODEL = 'gemini-2.5-flash';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── calcScore: スコア配点ロジック ────────────────────────────────────────────

describe('calcScore', () => {
  it('全項目クリア (text 無/logo 無/anatomy_ok/alignment 1.0) は 100 点・flagged false', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 1.0,
      notes: 'ok',
    });
    expect(r.score).toBe(100);
    expect(r.flagged).toBe(false);
    expect(r.has_text).toBe(false);
    expect(r.has_logo).toBe(false);
    expect(r.anatomy_ok).toBe(true);
    expect(r.theme_alignment).toBe(1.0);
    expect(r.notes).toBe('ok');
  });

  it('全項目悪 (text 有/logo 有/anatomy 破綻/alignment 0) は 0 点・flagged true', () => {
    const r = calcScore({
      has_text: true,
      has_logo: true,
      anatomy_ok: false,
      theme_alignment: 0,
      notes: 'bad',
    });
    expect(r.score).toBe(0);
    expect(r.flagged).toBe(true);
  });

  it('has_text == true は -30 点 (最大 70 点) → flagged 直前ギリギリ', () => {
    const r = calcScore({
      has_text: true,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 1.0,
      notes: '',
    });
    // 0 + 20 + 20 + 30 = 70
    expect(r.score).toBe(70);
    expect(r.flagged).toBe(false); // FLAG_THRESHOLD == 70 なので 70 は通過
  });

  it('has_logo == true は -20 点 (text 無/anatomy_ok/alignment 1.0 で 80 点)', () => {
    const r = calcScore({
      has_text: false,
      has_logo: true,
      anatomy_ok: true,
      theme_alignment: 1.0,
      notes: '',
    });
    // 30 + 0 + 20 + 30 = 80
    expect(r.score).toBe(80);
    expect(r.flagged).toBe(false);
  });

  it('anatomy_ok == false は -20 点', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: false,
      theme_alignment: 1.0,
      notes: '',
    });
    // 30 + 20 + 0 + 30 = 80
    expect(r.score).toBe(80);
  });

  it('theme_alignment == 0 だと -30 点 (text 無/logo 無/anatomy_ok でも 70 点)', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 0,
      notes: '',
    });
    // 30 + 20 + 20 + 0 = 70
    expect(r.score).toBe(70);
    expect(r.flagged).toBe(false);
  });

  it('theme_alignment が 1 を超える値は 1.0 にクランプ', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 5,
      notes: '',
    });
    expect(r.theme_alignment).toBe(1);
    expect(r.score).toBe(100);
  });

  it('theme_alignment が負の値は 0 にクランプ', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: -0.5,
      notes: '',
    });
    expect(r.theme_alignment).toBe(0);
  });

  it('has_text true で flagged=true (text 30点剥奪 + logo も有 → 50 点)', () => {
    const r = calcScore({
      has_text: true,
      has_logo: true,
      anatomy_ok: true,
      theme_alignment: 1.0,
      notes: 'logo and text detected',
    });
    // 0 + 0 + 20 + 30 = 50
    expect(r.score).toBe(50);
    expect(r.flagged).toBe(true);
  });

  it('境界: score == FLAG_THRESHOLD (70) は flagged false', () => {
    const r = calcScore({
      has_text: true,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 1.0,
      notes: '',
    });
    expect(r.score).toBe(FLAG_THRESHOLD);
    expect(r.flagged).toBe(false);
  });

  it('境界: score == FLAG_THRESHOLD - 1 (69) は flagged true', () => {
    // 30 + 20 + 20 + round(0.0 -> 0) = 70 では 69 にできないため、
    // alignment を調整: 30 + 20 + 0 + round(0.95*30=28.5→29) = 79 みたいになる
    // ここでは has_text true + alignment 0.95 → 0+20+20+round(28.5)=69 を作る
    const r = calcScore({
      has_text: true,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 0.95,
      notes: '',
    });
    // 0 + 20 + 20 + Math.round(0.95*30=28.5) -> 29 → 69
    expect(r.score).toBe(69);
    expect(r.flagged).toBe(true);
  });

  it('anatomy_ok 未指定 (undefined) は true 扱い (人物無し画像対応)', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      theme_alignment: 1.0,
      notes: '',
    });
    expect(r.anatomy_ok).toBe(true);
    expect(r.score).toBe(100);
  });

  it('theme_alignment が NaN や undefined のときは 0 として扱う', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: Number.NaN,
      notes: '',
    });
    expect(r.theme_alignment).toBe(0);
    // 30 + 20 + 20 + 0 = 70
    expect(r.score).toBe(70);

    const r2 = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      notes: '',
    });
    expect(r2.theme_alignment).toBe(0);
    expect(r2.score).toBe(70);
  });

  it('notes が無い場合は空文字に正規化', () => {
    const r = calcScore({
      has_text: false,
      has_logo: false,
      anatomy_ok: true,
      theme_alignment: 1.0,
    });
    expect(r.notes).toBe('');
  });
});

// ─── buildImagePart: 入力形式の振り分け ──────────────────────────────────────

describe('buildImagePart', () => {
  it('data URL は inline_data で mime/data を分離', () => {
    const part = buildImagePart('data:image/jpeg;base64,/9j/4AAQ');
    expect(part).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: '/9j/4AAQ' },
    });
  });

  it('http(s) URL は file_data で fileUri を渡す (jpg)', () => {
    const part = buildImagePart('https://example.com/foo.jpg');
    expect(part).toEqual({
      file_data: { mime_type: 'image/jpeg', file_uri: 'https://example.com/foo.jpg' },
    });
  });

  it('http(s) URL: webp 拡張子は image/webp', () => {
    const part = buildImagePart('https://example.com/x.webp?v=1');
    expect(part).toEqual({
      file_data: { mime_type: 'image/webp', file_uri: 'https://example.com/x.webp?v=1' },
    });
  });

  it('純粋な base64 は inline_data (image/png にフォールバック)', () => {
    const part = buildImagePart(SAMPLE_BASE64);
    expect(part).toEqual({
      inline_data: { mime_type: 'image/png', data: SAMPLE_BASE64 },
    });
  });

  it('空文字や非文字列はエラー', () => {
    expect(() => buildImagePart('')).toThrow();
    // @ts-expect-error 異常系: 型違反
    expect(() => buildImagePart(undefined)).toThrow();
  });
});

// ─── checkImageHallucination: REST API スタブ統合 ────────────────────────────

describe('checkImageHallucination', () => {
  it('Gemini Vision が pass 想定の JSON を返したら flagged=false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      visionResponseFromBody(
        geminiVisionBody({
          has_text: false,
          has_logo: false,
          anatomy_ok: true,
          theme_alignment: 0.9,
          notes: 'calm and clean',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result: VisionCheckResult = await checkImageHallucination(
      SAMPLE_BASE64,
      '瞑想',
      '30代女性',
    );

    expect(result.flagged).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(FLAG_THRESHOLD);
    expect(result.has_text).toBe(false);
    expect(result.notes).toBe('calm and clean');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('has_text=true → flagged=true (再生成推奨)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        visionResponseFromBody(
          geminiVisionBody({
            has_text: true,
            has_logo: true,
            anatomy_ok: true,
            theme_alignment: 0.5,
            notes: 'text and logo detected',
          }),
        ),
      ),
    );

    const result = await checkImageHallucination(SAMPLE_BASE64, '瞑想', '30代女性');
    // 0 + 0 + 20 + round(0.5*30)=15 = 35
    expect(result.has_text).toBe(true);
    expect(result.flagged).toBe(true);
    expect(result.score).toBeLessThan(FLAG_THRESHOLD);
  });

  it('data URL 入力でも fetch ボディに inline_data が含まれる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      visionResponseFromBody(
        geminiVisionBody({
          has_text: false,
          has_logo: false,
          anatomy_ok: true,
          theme_alignment: 1.0,
          notes: '',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await checkImageHallucination(`data:image/png;base64,${SAMPLE_BASE64}`, 'tarot');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const [calledUrl, init] = callArgs as [string, { body: string }];
    expect(calledUrl).toContain('gemini-2.5-flash');
    expect(calledUrl).toContain('key=test-key');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.contents[0].parts[0].inline_data).toMatchObject({
      mime_type: 'image/png',
      data: SAMPLE_BASE64,
    });
    // プロンプト側にテーマが含まれている
    expect(sentBody.contents[0].parts[1].text).toContain('tarot');
  });

  it('http(s) URL 入力では file_data が送信される', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      visionResponseFromBody(
        geminiVisionBody({
          has_text: false,
          has_logo: false,
          anatomy_ok: true,
          theme_alignment: 0.8,
          notes: '',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await checkImageHallucination('https://cdn.example.com/img.webp');

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const sentBody = JSON.parse(init.body);
    expect(sentBody.contents[0].parts[0].file_data).toMatchObject({
      mime_type: 'image/webp',
      file_uri: 'https://cdn.example.com/img.webp',
    });
  });

  it('Vision が JSON ではなく自然文を返したらエラー', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        visionResponseFromBody({
          candidates: [
            {
              content: { parts: [{ text: '画像はとても綺麗でした。' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      ),
    );

    await expect(
      checkImageHallucination(SAMPLE_BASE64, '瞑想'),
    ).rejects.toThrow(/non-JSON|invalid/i);
  });

  it('500 エラー → リトライして成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'err',
        text: async () => 'transient',
      })
      .mockResolvedValueOnce(
        visionResponseFromBody(
          geminiVisionBody({
            has_text: false,
            has_logo: false,
            anatomy_ok: true,
            theme_alignment: 0.9,
            notes: 'recovered',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkImageHallucination(SAMPLE_BASE64, '瞑想', '30代女性', {
      maxRetries: 1,
    });
    expect(result.flagged).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GEMINI_API_KEY 未設定なら例外', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(
      checkImageHallucination(SAMPLE_BASE64, '瞑想', '30代女性'),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('プライバシー: 成功ログに base64 / 画像 URL 本体が出力されない', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        visionResponseFromBody(
          geminiVisionBody({
            has_text: false,
            has_logo: false,
            anatomy_ok: true,
            theme_alignment: 1.0,
            notes: 'ok',
          }),
        ),
      ),
    );

    const secretUrl = 'https://private.example.com/secret-token-XYZ123/img.png';
    await checkImageHallucination(secretUrl, 'tarot', '30代女性');

    const allLoggedText = [
      ...infoSpy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join(' ');

    expect(allLoggedText).not.toContain(secretUrl);
    expect(allLoggedText).not.toContain(SAMPLE_BASE64);
  });
});
