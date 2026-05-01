/**
 * Stage2 (Zero-Gen writing) で Gemini が返す JSON を HTML 文字列に正規化する。
 *
 * Gemini は同じプロンプトに対して 4 形態のいずれかで返してくる:
 *   1. "<p>...</p>"                                  (string)
 *   2. { "html": "<p>...</p>" }                       (object_html)
 *   3. ["<p>...</p>", "<p>...</p>"]                   (array_html)
 *   4. [{ "html": "..." }, { "html": "..." }]         (array_object_html)
 *
 * バグD (2026-05-02) — 修正前 zero-generate-full/route.ts は 1 と 2 のみ扱い、
 * 3/4 を空文字に潰していた（記事 #71 の stage2_body_html='' 事故の原因）。
 *
 * 配列の場合は join('\n') で連結、object 形態は html プロパティ抽出、
 * 想定外の object 形態は最終フォールバックとして全 value を string 化して結合する。
 *
 * 戻り値は常に string（空文字含む）。空文字なら呼び出し側で検証エラーとする。
 */
export function normalizeStage2Html(x: unknown): string {
  const toHtml = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.html === 'string') return o.html;
    }
    return '';
  };
  if (Array.isArray(x)) {
    return x.map(toHtml).filter(Boolean).join('\n');
  }
  const direct = toHtml(x);
  if (direct) return direct;
  if (x && typeof x === 'object') {
    return Object.values(x as object).map(toHtml).filter(Boolean).join('\n');
  }
  return '';
}

/**
 * デバッグ用に response 形態名を分類する。ログに出すと
 * 「想定外 shape で空文字に潰された」事象を一目で識別可能。
 */
export function deriveStage2ResponseShape(
  x: unknown,
): 'string' | 'object_html' | 'array_html' | 'array_object_html' | 'unknown' {
  if (typeof x === 'string') return 'string';
  if (Array.isArray(x)) {
    if (x.length === 0) return 'unknown';
    if (x.every((el) => typeof el === 'string')) return 'array_html';
    if (
      x.every(
        (el) =>
          el !== null && typeof el === 'object' && typeof (el as Record<string, unknown>).html === 'string',
      )
    ) {
      return 'array_object_html';
    }
    return 'unknown';
  }
  if (x && typeof x === 'object') {
    if (typeof (x as Record<string, unknown>).html === 'string') return 'object_html';
    return 'unknown';
  }
  return 'unknown';
}
