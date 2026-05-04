// ============================================================================
// test/unit/auto-apply-images.test.ts
//
// 画像自動反映 (auto-apply-images) の挙動を単体レベルで保証する新規 unit テスト。
//
// 対象: src/lib/zero-gen/replace-placeholders.ts の `replaceImagePlaceholders`
//
// zero-generation 完了直後 (run-completion.ts 経由) または編集画面の
// 「画像を本文に反映」ボタンから呼ばれる純粋関数。本テストは「自動反映」
// 観点で 6 ケースを固定化する:
//
//   1. zero-gen 完了直後 (image_files 3 件 + IMAGE プレースホルダ) → 3 個 <img> 置換
//   2. image_files 0 件 → no-op (本文は 1 byte も変わらない)
//   3. 既に <img> が 3 個埋まっている (image_files と一致) → idempotent (no-op)
//   4. <!-- IMAGE: 残存 → 置換成功
//   5. image_files の URL が空文字列 → skip (本文消失せず、置換は試みない)
//   6. stage2 が空文字列 → 何もしない (空文字を返す、エラー無し)
//
// 既存の test/unit/replace-image-placeholders.test.ts は「本文消失 regression」
// 観点での網羅テストであり、本ファイルは「auto-apply 自動反映フロー」観点で
// 補完するためのテスト。両者は重複ではなく観点が異なる。
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '@/lib/zero-gen/replace-placeholders';

// ─── テスト用 fixture ──────────────────────────────────────────────────────────

function makeImage(position: string, url?: string): ImageFileRow {
  return {
    position,
    url: url ?? `https://cdn.example.com/${position}.webp`,
    alt: `${position} の自動生成画像`,
    filename: `${position}.webp`,
  };
}

const HERO = makeImage('hero');
const BODY = makeImage('body');
const SUMMARY = makeImage('summary');
const ALL_IMAGES: ImageFileRow[] = [HERO, BODY, SUMMARY];

/** 本実装と同じ img タグフォーマット */
const imgTagFor = (img: ImageFileRow) =>
  `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;

/** 文字列内の <img ...> タグ数を数える */
const countImgTags = (html: string): number =>
  (html.match(/<img\s[^>]*\/?>/g) || []).length;

describe('auto-apply-images: replaceImagePlaceholders 自動反映フロー', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // ケース 1: zero-gen 完了直後 — image_files 3 件 + IMAGE プレースホルダ
  //   3 個の <img> に正しく置換される (run-completion.ts 経路の正常系)。
  // ────────────────────────────────────────────────────────────────────────────
  it('1. zero-gen 完了直後: 3 件の image_files が 3 個の <img> に置換される', () => {
    const stage2 =
      '<p>導入文。</p>\n' +
      '<!-- IMAGE:hero:hero.webp -->\n' +
      '<p>本文セクション 1。</p>\n' +
      '<!-- IMAGE:body:body.webp -->\n' +
      '<p>本文セクション 2。</p>\n' +
      '<!-- IMAGE:summary:summary.webp -->\n' +
      '<p>結びの段落。</p>';

    const { html, phase1, phase2, mismatched } = replaceImagePlaceholders(
      stage2,
      ALL_IMAGES,
    );

    // 3 つの img タグが全て出現
    expect(html).toContain(imgTagFor(HERO));
    expect(html).toContain(imgTagFor(BODY));
    expect(html).toContain(imgTagFor(SUMMARY));

    // 元の placeholder は 1 つも残っていない
    expect(html).not.toMatch(/IMAGE:hero/);
    expect(html).not.toMatch(/IMAGE:body/);
    expect(html).not.toMatch(/IMAGE:summary/);

    // 本文段落は完全に保持
    expect(html).toContain('<p>導入文。</p>');
    expect(html).toContain('<p>本文セクション 1。</p>');
    expect(html).toContain('<p>本文セクション 2。</p>');
    expect(html).toContain('<p>結びの段落。</p>');

    // ちょうど 3 個の <img> が存在
    expect(countImgTags(html)).toBe(3);

    // Phase 1 で 3 件マッチ、Phase 3 残骸は 0
    expect(phase1).toBeGreaterThanOrEqual(3);
    expect(phase2).toBe(0);
    expect(mismatched).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 2: image_files 0 件 → no-op
  //   本文は 1 byte も変わらない。phase1 / phase2 / mismatched 全て 0。
  // ────────────────────────────────────────────────────────────────────────────
  it('2. image_files 0 件: 本文は完全に変更されない (no-op)', () => {
    const stage2 =
      '<p>導入。</p>\n<!-- IMAGE:hero:alt -->\n<p>IMAGE:body</p>\n<p>結び。</p>';

    const { html, phase1, phase2, mismatched } = replaceImagePlaceholders(
      stage2,
      [],
    );

    // 完全一致
    expect(html).toBe(stage2);
    expect(phase1).toBe(0);
    expect(phase2).toBe(0);
    expect(mismatched).toBe(0);
    // <img> が新規挿入されていない
    expect(countImgTags(html)).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 3: 既に <img> 3 個 (image_files と一致) → idempotent (no-op)
  //   画像反映を 2 回押しても本文が壊れないことを保証する。
  //   placeholder は既に消えているので Phase 1/2 は何もマッチしない。
  // ────────────────────────────────────────────────────────────────────────────
  it('3. 既に <img> 3 個埋まっている状態に再実行 → 冪等 (no-op)', () => {
    // 1 回目の置換結果をシミュレート (placeholder は全て <img> に変換済)
    const stage2 =
      '<p>導入文。</p>\n' +
      imgTagFor(HERO) +
      '\n' +
      '<p>本文セクション 1。</p>\n' +
      imgTagFor(BODY) +
      '\n' +
      '<p>本文セクション 2。</p>\n' +
      imgTagFor(SUMMARY) +
      '\n' +
      '<p>結びの段落。</p>';

    const before = stage2;
    const { html, phase1, phase2, mismatched } = replaceImagePlaceholders(
      stage2,
      ALL_IMAGES,
    );

    // 完全一致 (1 byte も変わらない)
    expect(html).toBe(before);
    // <img> 数は依然 3 個 (重複追加されていない)
    expect(countImgTags(html)).toBe(3);
    // どのフェーズも何もマッチしていない
    expect(phase1).toBe(0);
    expect(phase2).toBe(0);
    expect(mismatched).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 4: <!-- IMAGE: 残存 → 置換成功
  //   stage2 に HTML コメント形式の placeholder が 1 つだけ残っている状態で
  //   呼び出した場合、その 1 つが <img> に置換される。
  // ────────────────────────────────────────────────────────────────────────────
  it('4. <!-- IMAGE:body --> が残存 → <img> に置換成功', () => {
    const stage2 =
      '<p>第一段落。</p>\n' +
      '<!-- IMAGE:body:body.webp -->\n' +
      '<p>第二段落。</p>';

    const { html, phase1, mismatched } = replaceImagePlaceholders(
      stage2,
      ALL_IMAGES,
    );

    // body の img タグが挿入されている
    expect(html).toContain(imgTagFor(BODY));
    // コメント placeholder は消えている
    expect(html).not.toContain('<!-- IMAGE:body');
    expect(html).not.toContain('IMAGE:body');
    // 周囲の段落は保持
    expect(html).toContain('<p>第一段落。</p>');
    expect(html).toContain('<p>第二段落。</p>');
    // Phase 1 でマッチ、残骸なし
    expect(phase1).toBeGreaterThanOrEqual(1);
    expect(mismatched).toBe(0);
    // <img> はちょうど 1 個
    expect(countImgTags(html)).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 5: image_files の URL が空文字列 → skip
  //   url が空の image_file は置換に使うべきではないが、現実装は文字列置換
  //   なので「空 src の壊れた img」を出さないことを最低限保証する観点では
  //   呼び出し側で skip するのが期待動作。本テストでは「URL 空でも本文消失
  //   は起きない / 致命的エラーは投げない / 元本文の placeholder は残る」を
  //   検証する (上位レイヤの skip 責務をユニットレベルで補完する fail-safe)。
  // ────────────────────────────────────────────────────────────────────────────
  it('5. image_files の URL が空文字列 → 本文消失せず安全に処理される', () => {
    const stage2 =
      '<p>導入文。</p>\n' +
      '<!-- IMAGE:hero:hero.webp -->\n' +
      '<p>本文。</p>\n' +
      '<!-- IMAGE:body:body.webp -->\n' +
      '<p>結び。</p>\n' +
      '<!-- IMAGE:summary:summary.webp -->';

    // 上位レイヤ (auto-apply 呼び出し側) で url=='' を skip する想定の挙動を
    //   ユニットレベルで再現: 空 URL の image_file は配列から除外してから渡す。
    const filtered = [
      makeImage('hero', ''), // URL 空
      makeImage('body'), // URL 正常
      makeImage('summary', ''), // URL 空
    ].filter((img) => img.url.trim().length > 0);

    // skip 後は body のみ残る
    expect(filtered.length).toBe(1);
    expect(filtered[0].position).toBe('body');

    const { html, mismatched } = replaceImagePlaceholders(stage2, filtered);

    // body だけが置換される
    expect(html).toContain(imgTagFor(filtered[0]));
    expect(html).not.toContain('IMAGE:body');

    // hero / summary の placeholder はそのまま残る (URL 空のため skip)
    expect(html).toContain('IMAGE:hero');
    expect(html).toContain('IMAGE:summary');

    // 周囲の本文も完全保持
    expect(html).toContain('<p>導入文。</p>');
    expect(html).toContain('<p>本文。</p>');
    expect(html).toContain('<p>結び。</p>');

    // <img> はちょうど 1 個 (空 URL のものは出力されない)
    expect(countImgTags(html)).toBe(1);
    // src="" の壊れた img タグが生成されていない
    expect(html).not.toMatch(/<img\s+src=""/);

    // 残った placeholder は Phase 3 の検出対象 (取りこぼしコメント形式) に該当するため
    //   mismatched > 0 となる (Phase 3 の責務として正しい挙動)。
    expect(mismatched).toBeGreaterThanOrEqual(2);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 6: stage2 が空文字列 → 何もしない
  //   早期リターンで空文字を返し、エラーを投げない。
  // ────────────────────────────────────────────────────────────────────────────
  it('6. stage2 が空文字列 → 何もせず空文字を返す (エラー投げない)', () => {
    const result = replaceImagePlaceholders('', ALL_IMAGES);

    expect(result.html).toBe('');
    expect(result.phase1).toBe(0);
    expect(result.phase2).toBe(0);
    expect(result.mismatched).toBe(0);
    // 関数呼び出しが throw しないことは expect が通った時点で保証される
  });
});
