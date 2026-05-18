// P5-111: postValidateAutoFix の before/after 構造比較ガード
//
// 守るべき不変条件 (AI 出力が違反したら DB UPDATE を block する):
//   1. body 長 >= 80%
//   2. body 長 >= 200 chars (絶対下限)
//   3. h2 数 / img 数 / CTA 数 / placeholder 数: after >= before
//   4. <script> 数: after <= before (新規注入禁止 = XSS/prompt injection 防止)

import { describe, it, expect } from 'vitest';
import { postValidateAutoFix } from '@/lib/auto-fix/orchestrator';

const TEMPLATE_BODY = `
<h2>第1章 はじめに</h2>
<p>本文 a. ${'あ'.repeat(200)}</p>
<!--IMAGE:hero:hero.webp-->
<h2>第2章 中心</h2>
<p>本文 b. ${'い'.repeat(200)}</p>
<img src="https://example.com/body.jpg" alt="body" />
<div class="harmony-cta">
  <a class="harmony-cta-btn" href="https://harmony-booking.web.app/">予約</a>
</div>
<h2>第3章 まとめ</h2>
<p>本文 c. ${'う'.repeat(200)}</p>
<img src="https://example.com/summary.jpg" alt="summary" />
<div class="harmony-cta">
  <a class="harmony-cta-btn" href="https://harmony-booking.web.app/">予約</a>
</div>
`;

describe('postValidateAutoFix — 構造保持系', () => {
  it('after が before と完全に同じなら ok', () => {
    const r = postValidateAutoFix(TEMPLATE_BODY, TEMPLATE_BODY);
    expect(r.ok).toBe(true);
    expect(r.before.h2).toBe(3);
    expect(r.after.h2).toBe(3);
    expect(r.before.cta).toBe(2);
    expect(r.after.cta).toBe(2);
    expect(r.before.placeholder).toBe(1);
    expect(r.after.placeholder).toBe(1);
  });

  it('h2/CTA/img を維持したまま文字を増やすのは ok', () => {
    const after = TEMPLATE_BODY + '<p>追記された本文。</p>';
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(true);
  });
});

describe('postValidateAutoFix — 違反検知系 (ok=false で throw 対象)', () => {
  it('body が 20% 超縮小したら NG', () => {
    // before > 500 chars、after は 200 char 以上 (絶対下限はクリア) かつ
    // before の 80% 未満になるサイズにすることで「縮小」ガードだけが発火することを担保
    const after =
      '<h2>第1章</h2><h2>第2章</h2><h2>第3章</h2><p>' + 'あ'.repeat(220) + '</p>';
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/縮小/);
  });

  it('body が 200 char 未満なら NG (絶対下限)', () => {
    const after = '<h2>a</h2><h2>b</h2><h2>c</h2><p>x</p>';
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/極端に短い/);
  });

  it('h2 が減ったら NG', () => {
    const after = TEMPLATE_BODY.replace('<h2>第3章 まとめ</h2>', '');
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/H2/);
  });

  it('img が減ったら NG', () => {
    const after = TEMPLATE_BODY.replace(/<img[^>]*\/>/, '');
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/img/);
  });

  it('CTA ブロックが減ったら NG', () => {
    const after = TEMPLATE_BODY.replace(/<div class="harmony-cta">[\s\S]*?<\/div>/, '');
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CTA/);
  });

  it('画像プレースホルダが減ったら NG', () => {
    const after = TEMPLATE_BODY.replace('<!--IMAGE:hero:hero.webp-->', '');
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/プレースホルダ/);
  });

  it('<script> タグが新規注入されたら NG', () => {
    const after = TEMPLATE_BODY + '<script>alert(1)</script>';
    const r = postValidateAutoFix(TEMPLATE_BODY, after);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/script/);
  });
});

describe('postValidateAutoFix — エッジ', () => {
  it('before が空でも after が下限を満たせば ok', () => {
    const after = '<h2>新規</h2>' + 'あ'.repeat(300);
    const r = postValidateAutoFix('', after);
    expect(r.ok).toBe(true);
  });

  it('before/after ともに空なら ok=false (下限違反)', () => {
    const r = postValidateAutoFix('', '');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/極端に短い/);
  });
});
