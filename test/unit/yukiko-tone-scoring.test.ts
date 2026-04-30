// ============================================================================
// test/unit/yukiko-tone-scoring.test.ts
// spec §7 由起子トーン採点のテスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import { scoreYukikoTone, WEIGHTS } from '@/lib/tone/yukiko-scoring';

// ─── 由起子さん本文サンプル（stage2-writing.ts の few-shot 由来） ─────────
const yukikoSampleHtml = `
<h2 id="section-1">目に見えないものを敬う気持ち</h2>
<p>私たちの暮らしの中で、ときに忘れがちなものがあります。それは、目に見えないものを敬う気持ちです。</p>
<p>便利さやスピード、目に見える成果が重視される今の時代。けれど、本当に大切なものは、目には映らないけれど、心には確かに感じられるものの中にあります。</p>
<p>たとえば、朝起きてカーテンを開けたとき。そっと差し込む光に、何か温かいものを感じることがありませんか。あの感覚が、実は大切なんです。</p>
<p>「諦める」という言葉。一般的にはネガティブなものとして捉えられる言葉かと思います。でも実は、「諦める」には二つの相反する意味があるんです。</p>
<p>一つはポジティブな「受容」としての諦め、もう一つはネガティブな「拒否」としての諦めです。この違いを知ることで、人生の選択肢や心の在り方が大きく変わってきます。</p>
<p>カウンセリングの中で感じるのは、ご自身の心の声に耳を澄ませる時間がとても大切だということ。先日、ある方とこんなお話がありました。</p>
<p>遠回りしてもいい。立ち止まってもいい。何度でもルートを変えていい。大切なのは、「どう生きたいか」というあなたの意志ではないでしょうか。</p>
<div class="harmony-cta">
  <p class="harmony-cta-catch">心のスペースを取り戻したいあなたへ</p>
  <p class="harmony-cta-sub">小さな一歩から、ゆっくり始めてみませんか。</p>
  <a class="harmony-cta-btn" href="https://harmony-booking.web.app/">ご予約・お問い合わせはこちら</a>
</div>
<h2 id="section-2">小さなワークのすすめ</h2>
<p>気づいたこと・感じたことがあれば、ぜひノートに書き留めてみてください。この小さなワークが、あなたの心にやさしい灯りをともしますように。</p>
`;

// ─── 重み合計のテスト ───────────────────────────────────────────────────────
describe('WEIGHTS', () => {
  it('14 項目の重み合計が 1.0 に近い（±0.05 以内）', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(0.95);
    expect(sum).toBeLessThanOrEqual(1.05);
  });

  it('14 項目すべてに重みが定義されている', () => {
    expect(Object.keys(WEIGHTS)).toHaveLength(14);
  });
});

// ─── 必須通過項目の zero-out テスト ────────────────────────────────────────
describe('必須通過項目 zero-out', () => {
  it('"" を含むと total=0 / passed=false / blockers に noDoubleQuote', () => {
    const html = '<p>これは"テスト"です。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('noDoubleQuote');
  });

  it('curly quote “”でも total=0', () => {
    const html = '<p>これは“テスト”です。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.total).toBe(0);
    expect(r.blockers).toContain('noDoubleQuote');
  });

  it('スピ断定（波動）が肯定文脈で含まれると total=0', () => {
    const html = '<p>波動が高まります。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('noSpiritualAssertion');
  });

  it('スピ NG 語が否定文脈なら通過する', () => {
    const html =
      '<p>波動という考え方を断定するわけではありません。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.blockers).not.toContain('noSpiritualAssertion');
  });

  it('必須通過 NG 時も breakdown は計算される', () => {
    const html = '<p>"test"</p>';
    const r = scoreYukikoTone(html);
    expect(r.total).toBe(0);
    expect(r.breakdown).toBeDefined();
    expect(r.breakdown.noDoubleQuote).toBe(0);
  });
});

// ─── 個別項目の境界値テスト ──────────────────────────────────────────────
describe('個別項目の境界値', () => {
  it('視点変換度: 視点語句が無いと低スコア', () => {
    const html = '<p>今日は晴れています。明日は雨でしょう。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.perspectiveShift).toBeLessThan(0.5);
  });

  it('視点変換度: 「でも実は」「けれど」「のかもしれません」で満点近く', () => {
    const html =
      '<p>でも実はそうではないのかもしれません。けれど見方を変えると違って見えます。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.perspectiveShift).toBeGreaterThanOrEqual(1);
  });

  it('抽象度逆スコア: 「たとえば」「カウンセリングの中で」で満点', () => {
    const html =
      '<p>たとえば朝。先日カウンセリングの中で、こんなお話がありました。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.concretenessReverse).toBeGreaterThanOrEqual(1);
  });

  it('抽象度逆スコア: 具体エピソードゼロは 0', () => {
    const html = '<p>心は静かです。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.concretenessReverse).toBe(0);
  });

  it('比喩オリジナリティ: クリシェ「木漏れ日」を含むと減点', () => {
    const html =
      '<p>木漏れ日のような優しさを感じてみてください。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.breakdown.metaphorOriginality).toBeLessThan(1);
  });

  it('比喩オリジナリティ: クリシェ 3 つで 0', () => {
    const html =
      '<p>木漏れ日と波紋のように走馬灯が心に残ります。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.breakdown.metaphorOriginality).toBe(0);
  });

  it('比喩オリジナリティ: クリシェなしで満点', () => {
    const html =
      '<p>朝の空気のような清々しさを感じてみてください。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.breakdown.metaphorOriginality).toBe(1);
  });

  it('語尾優しさ: 全て「です/ます」で満点', () => {
    const html =
      '<p>今日は穏やかな一日です。心が静まります。ゆっくりしてみてくださいね。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.softEnding).toBe(1);
  });

  it('語尾優しさ: 「だ。」「である。」が過半数で減点', () => {
    const html =
      '<p>これは事実だ。</p><p>結論は明確である。</p><p>そう決めるべきである。</p><p>違いない。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.softEnding).toBeLessThan(0.5);
  });

  it('CTA 自然挿入: harmony-cta 1 個で満点', () => {
    const html =
      '<div class="harmony-cta"><a href="https://harmony-booking.web.app/">予約</a></div>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.ctaNaturalInsertion).toBe(1);
  });

  it('CTA 自然挿入: 0 個で 0', () => {
    const html = '<p>本文のみ。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.ctaNaturalInsertion).toBe(0);
  });

  it('CTA 自然挿入: 4 個以上で減点', () => {
    const html = Array(4)
      .fill('<div class="harmony-cta"></div>')
      .join('');
    const r = scoreYukikoTone(html);
    expect(r.breakdown.ctaNaturalInsertion).toBeLessThan(1);
  });

  it('CTA URL: harmony-booking URL が無いと 0', () => {
    const html = '<div class="harmony-cta"><a href="https://example.com/">link</a></div>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.ctaUrlPresence).toBe(0);
  });

  it('禁止フレーズ: 「いかがでしたでしょうか」で減点', () => {
    const html = '<p>いかがでしたでしょうか。</p>' + yukikoSampleHtml;
    const r = scoreYukikoTone(html);
    expect(r.breakdown.forbiddenPhraseAbsence).toBeLessThan(1);
  });

  it('絵文字抑制: 多数の絵文字で 0', () => {
    const html = '<p>今日は良い日です✨🌟💖🎀🌸</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.emojiRestraint).toBe(0);
  });

  it('絵文字抑制: なしで満点', () => {
    const html = '<p>今日は穏やかです。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.emojiRestraint).toBe(1);
  });

  it('深い納得度: 体感的言い換えが豊富で満点', () => {
    const html =
      '<p>と感じることがありませんか。ではないでしょうか。なんです。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.deepResonance).toBeGreaterThanOrEqual(1);
  });

  it('短短長リズム: 短短長パターン 2 回以上で満点', () => {
    const html =
      '<p>朝です。光が差します。私たちはその光を受けて、それぞれに違う一日を歩み始めるのですね。夜です。星が見えます。空を見上げると、不思議とやさしい気持ちが心の奥からゆっくりと広がっていくのです。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.rhythmShortLong).toBeGreaterThanOrEqual(1);
  });

  it('ダブルポスト回避: stub で常に 1', () => {
    const html = '<p>テキスト。</p>';
    const r = scoreYukikoTone(html);
    expect(r.breakdown.doublePostAvoidance).toBe(1);
  });
});

// ─── 由起子さん本文サンプルでの総合スコア ────────────────────────────────
describe('由起子さん本文サンプル（few-shot ベース）', () => {
  it('total >= 0.80 / passed=true', () => {
    const r = scoreYukikoTone(yukikoSampleHtml);
    expect(r.blockers).toEqual([]);
    expect(r.total).toBeGreaterThanOrEqual(0.8);
    expect(r.passed).toBe(true);
  });

  it('total <= 1.0', () => {
    const r = scoreYukikoTone(yukikoSampleHtml);
    expect(r.total).toBeLessThanOrEqual(1);
  });

  it('breakdown の各値が 0-1 の範囲', () => {
    const r = scoreYukikoTone(yukikoSampleHtml);
    for (const v of Object.values(r.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─── 低品質テキストの総合スコア ──────────────────────────────────────────
describe('低品質テキスト（AI臭い + クリシェ多用）', () => {
  it('total < 0.60', () => {
    const html =
      '<p>いかがでしたでしょうか。木漏れ日のような優しさを感じてください。波紋のように広がる愛の涙。走馬灯のような記憶。この記事ではスピリチュアルについて解説します。まとめると、結論から言うと、心のスペースを取り戻すべきだ。なければならない。</p>';
    const r = scoreYukikoTone(html);
    expect(r.total).toBeLessThan(0.6);
  });
});
