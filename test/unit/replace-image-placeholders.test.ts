// ============================================================================
// test/unit/replace-image-placeholders.test.ts
//
// P5-55+ regression test — replaceImagePlaceholders が「本文を誤って削除しない」
// ことを単体レベルで保証する。
//
// 過去のインシデント:
//   旧 fallback `/(?<![A-Za-z_])IMAGE[：:]\s*[^\n<]{1,200}/g` が本文中の
//   「IMAGE:」表現にマッチして後続 200 文字を強制削除し、本文消失バグを
//   引き起こした (P5-55)。本テストはこの種のバグの再発を compile-time に近い
//   フィードバックループで検出するため、最低 8 ケースを固定化する。
//
// 8 検証ケース:
//   1. <!-- IMAGE:hero:alt --> を img タグに置換 (正常)
//   2. <p>IMAGE:body</p> を img タグに置換 (正常)
//   3. 本文中の「IMAGE:hero」(平文) は削除しない
//   4. 本文中の「画像 (IMAGE: hero と body)」のような自然文は保持される
//   5. Phase 2 fallback で位置情報なし IMAGE: のみ対象、200 文字後続は削らない
//   6. <p>IMAGEハント:bonsai</p> のような偶然のマッチは無視
//   7. 空 imageFiles[] では何も削除しない
//   8. 全 3 つのプレースホルダ (hero/body/summary) が正しく置換される
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
  type PlaceholderMismatchInfo,
} from '@/lib/zero-gen/replace-placeholders';

// ─── テスト用 fixture ──────────────────────────────────────────────────────────

function makeImage(position: string): ImageFileRow {
  return {
    position,
    url: `https://example.com/${position}.webp`,
    alt: `${position} のイメージ`,
    filename: `${position}.webp`,
  };
}

const HERO = makeImage('hero');
const BODY = makeImage('body');
const SUMMARY = makeImage('summary');
const ALL_IMAGES: ImageFileRow[] = [HERO, BODY, SUMMARY];

/** img タグ生成パターン (本実装と同じフォーマット) */
const imgTagFor = (img: ImageFileRow) =>
  `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;

describe('replaceImagePlaceholders — 本文消失 regression 保護', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // ケース 1: HTML コメント形式の hero placeholder
  // ────────────────────────────────────────────────────────────────────────────
  it('1. <!-- IMAGE:hero:alt --> を img タグに置換する', () => {
    const body = '<p>導入文。</p>\n<!-- IMAGE:hero:ヒーロー画像 -->\n<p>本文。</p>';
    const { html, phase1 } = replaceImagePlaceholders(body, ALL_IMAGES);

    expect(html).toContain(imgTagFor(HERO));
    expect(html).not.toContain('IMAGE:hero');
    // 周囲の本文は維持
    expect(html).toContain('<p>導入文。</p>');
    expect(html).toContain('<p>本文。</p>');
    expect(phase1).toBeGreaterThanOrEqual(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 2: <p>IMAGE:body</p> 形式
  // ────────────────────────────────────────────────────────────────────────────
  it('2. <p>IMAGE:body</p> を img タグに置換する', () => {
    const body = '<p>第一段落。</p>\n<p>IMAGE:body</p>\n<p>第二段落。</p>';
    const { html, phase1 } = replaceImagePlaceholders(body, ALL_IMAGES);

    expect(html).toContain(imgTagFor(BODY));
    expect(html).not.toContain('<p>IMAGE:body</p>');
    expect(html).toContain('<p>第一段落。</p>');
    expect(html).toContain('<p>第二段落。</p>');
    expect(phase1).toBeGreaterThanOrEqual(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 3: 本文中の平文「IMAGE:hero」は削除しない
  //   全ての位置 placeholder が <!-- --> や <p> でラップされず、平文として
  //   本文中に登場する場合は触らない。
  // ────────────────────────────────────────────────────────────────────────────
  it('3. 平文の「IMAGE:hero」を削除しない (全 placeholder 既に置換済シナリオ)', () => {
    // hero/body/summary は既に Phase 1 で置換される形 (HTML コメント)
    // にしておき、本文に偶然「IMAGE:hero」という文字列が混じっても残ることを確認。
    //   …が、Phase 1 のパターン `IMAGE:hero(?::[^\\s<]*)?` は平文もマッチするため
    //   完全な「平文保護」は Phase 1 では難しい。本ケースは Phase 1 が
    //   matched に hero を追加した上で、Phase 2 fallback の対象外であることを
    //   検証する (Phase 2 のみで吹っ飛ぶことを防ぐ)。
    const body =
      '<p>これは「IMAGE: hero」というキーワードについての解説です。後続の文章は決して消えてはいけません。なぜならユーザの大切な本文だからです。</p>';
    const { html } = replaceImagePlaceholders(body, ALL_IMAGES);
    // 後続の本文が確実に保持されている
    expect(html).toContain('後続の文章は決して消えてはいけません');
    expect(html).toContain('なぜならユーザの大切な本文だからです');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 4: 自然文「画像 (IMAGE: hero と body)」は保持される
  //   平文中の IMAGE: 表現と後続テキストを Phase 2 fallback が貪欲に
  //   削除しないことを保証する。
  // ────────────────────────────────────────────────────────────────────────────
  it('4. 自然文中の「画像 (IMAGE: hero と body)」を保持する', () => {
    const naturalText =
      '次の項目で詳しく説明します。これは絶対に消えてはいけない長い本文です。' +
      'スピリチュアルな視点から、この体験の意味を一緒にひもといていきましょう。';
    const body = `<p>画像 (IMAGE: hero と body) は記事を彩ります。${naturalText}</p>`;
    const { html } = replaceImagePlaceholders(body, ALL_IMAGES);

    // 後続の自然文が完全に保持されている
    expect(html).toContain('絶対に消えてはいけない長い本文');
    expect(html).toContain('スピリチュアルな視点から');
    expect(html).toContain('一緒にひもといていきましょう');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 5: Phase 2 fallback で 200 文字後続は削らない
  //   旧バグ `[^\n<]{1,200}` は IMAGE: 直後 200 文字を消し飛ばしていた。
  //   現実装では HTML コメント / <p> ラップに限定されているため、
  //   平文の IMAGE: 表現の後続文字は安全に残る。
  // ────────────────────────────────────────────────────────────────────────────
  it('5. Phase 2 fallback は 200 文字後続を削らない (平文 IMAGE: は無視)', () => {
    const longTrail = 'あ'.repeat(200);
    // hero / body / summary を一切ラップせず、本文中に IMAGE: が登場するだけ
    const body = `<p>テーマ: IMAGE: ${longTrail} ここまで本文。</p>`;
    const { html } = replaceImagePlaceholders(body, [SUMMARY]); // あえて 1 件のみ

    // 200 文字の「あ」が完全保持
    expect(html).toContain(longTrail);
    // 末尾の「ここまで本文。」も保持
    expect(html).toContain('ここまで本文。');
    // 段落タグが破壊されていない
    expect(html).toContain('<p>');
    expect(html).toContain('</p>');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 6: 偶然のマッチ「IMAGEハント:bonsai」を無視
  //   IMAGE の直後に「:」以外の文字が来る場合は placeholder ではない。
  // ────────────────────────────────────────────────────────────────────────────
  it('6. <p>IMAGEハント:bonsai</p> のような偶然のマッチを無視する', () => {
    const body = '<p>IMAGEハント:bonsai という造語の解説です。</p>';
    const { html, phase1, phase2 } = replaceImagePlaceholders(body, ALL_IMAGES);

    // 元のテキストが完全に残る
    expect(html).toContain('IMAGEハント:bonsai という造語の解説です。');
    // どのフェーズでもマッチしていない
    expect(phase1).toBe(0);
    expect(phase2).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 7: 空 imageFiles[] では何も削除しない
  // ────────────────────────────────────────────────────────────────────────────
  it('7. 空 imageFiles[] では本文を一切変更しない', () => {
    const body =
      '<p>導入。</p>\n<!-- IMAGE:hero:alt -->\n<p>IMAGE:body</p>\n<p>結び。</p>';
    const { html, phase1, phase2 } = replaceImagePlaceholders(body, []);

    // 完全一致 (1 byte も変わらない)
    expect(html).toBe(body);
    expect(phase1).toBe(0);
    expect(phase2).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 8: hero / body / summary の 3 placeholder が全て置換される
  // ────────────────────────────────────────────────────────────────────────────
  it('8. 全 3 placeholder (hero/body/summary) が正しく置換される', () => {
    const body =
      '<p>リード文。</p>\n' +
      '<!-- IMAGE:hero:hero alt -->\n' +
      '<p>本文セクション。</p>\n' +
      '<p>IMAGE:body</p>\n' +
      '<p>結びセクション。</p>\n' +
      '<!-- IMAGE:summary:summary alt -->';

    const { html, phase1 } = replaceImagePlaceholders(body, ALL_IMAGES);

    // 3 つの img タグが全て出現
    expect(html).toContain(imgTagFor(HERO));
    expect(html).toContain(imgTagFor(BODY));
    expect(html).toContain(imgTagFor(SUMMARY));

    // 元の placeholder が 1 つも残っていない
    expect(html).not.toMatch(/IMAGE:hero/);
    expect(html).not.toMatch(/IMAGE:body/);
    expect(html).not.toMatch(/IMAGE:summary/);

    // 本文の段落も保持
    expect(html).toContain('<p>リード文。</p>');
    expect(html).toContain('<p>本文セクション。</p>');
    expect(html).toContain('<p>結びセクション。</p>');

    // Phase 1 で 3 件以上マッチ
    expect(phase1).toBeGreaterThanOrEqual(3);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 9 (P5-58): 正常系で mismatched は 0
  //   全 placeholder が Phase 1/2 で置換されきった場合、
  //   Phase 3 残存検出は何もヒットせず mismatched=0、callback も発火しない。
  // ────────────────────────────────────────────────────────────────────────────
  it('9. mismatched 件数: 全 placeholder が置換完了なら 0 になり callback 未発火', () => {
    const body =
      '<p>リード文。</p>\n' +
      '<!-- IMAGE:hero:hero alt -->\n' +
      '<p>本文。</p>\n' +
      '<p>IMAGE:body</p>\n' +
      '<!-- IMAGE:summary:summary alt -->';
    const onMismatch = vi.fn<(info: PlaceholderMismatchInfo) => void>();
    const { mismatched } = replaceImagePlaceholders(body, ALL_IMAGES, onMismatch);

    expect(mismatched).toBe(0);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 10 (P5-58): Phase 3 残存検出 — 取りこぼしコメント placeholder
  //   imageFiles に存在しない位置 (footer) のコメント placeholder を残し、
  //   Phase 1/2 でも処理されないケースで mismatched > 0 / callback 発火を確認。
  // ────────────────────────────────────────────────────────────────────────────
  it('10. Phase 3: 取りこぼしコメント placeholder を検出し callback を発火', () => {
    // hero / body / summary が全て Phase 1 で matched となるよう本文を構成し、
    //   Phase 2 fallback (unmatched 起動) が走らない状況を作る。
    //   その上で imageFiles に存在しない `IMAGE:footer` コメントを残し、
    //   Phase 1/2 が触らず Phase 3 が検出することを確認する。
    const body =
      '<p>導入。</p>\n' +
      '<!-- IMAGE:hero:hero.webp -->\n' +
      '<p>本文1。</p>\n' +
      '<!-- IMAGE:body:body.webp -->\n' +
      '<p>本文2。</p>\n' +
      '<!-- IMAGE:summary:summary.webp -->\n' +
      '<p>結び。</p>\n' +
      '<!-- IMAGE:footer:unknown.webp -->'; // imageFiles に無い position
    const onMismatch = vi.fn<(info: PlaceholderMismatchInfo) => void>();
    const { html, mismatched } = replaceImagePlaceholders(
      body,
      ALL_IMAGES,
      onMismatch,
    );

    // footer コメントは置換されずに残っている
    expect(html).toContain('IMAGE:footer');
    // Phase 3 が検出
    expect(mismatched).toBeGreaterThanOrEqual(1);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    const info = onMismatch.mock.calls[0][0];
    expect(info.count).toBe(mismatched);
    expect(info.residual.length).toBeGreaterThan(0);
    expect(info.residual.some((s) => s.includes('IMAGE:footer'))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ケース 11 (P5-58): 不正コメント `<!--<img ...>` 検出
  //   過去の P5-57 バグで生成され得た「閉じない不正コメント断片」を
  //   Phase 3 が検出し、residual snippet に含めることを確認。
  // ────────────────────────────────────────────────────────────────────────────
  it('11. Phase 3: 不正コメント <!--<img ... を検出', () => {
    // 既に <!--<img ...> という壊れたコメントが本文に紛れ込んでいる状況。
    // Phase 1/2 が触らない (どの placeholder パターンとも一致しない) ため、
    //   Phase 3 が検出する。
    const body =
      '<p>本文1。</p>\n' +
      '<!--<img src="https://example.com/broken.webp" alt="壊れ" />\n' +
      '<p>本文2。</p>';
    const onMismatch = vi.fn<(info: PlaceholderMismatchInfo) => void>();
    const { mismatched, html } = replaceImagePlaceholders(
      body,
      ALL_IMAGES,
      onMismatch,
    );

    // Phase 3 が検出
    expect(mismatched).toBeGreaterThanOrEqual(1);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    const info = onMismatch.mock.calls[0][0];
    expect(info.residual.some((s) => s.startsWith('<!--<img'))).toBe(true);
    // Phase 3 は置換しないため、不正断片は html に残ったまま
    expect(html).toContain('<!--<img');
  });
});
