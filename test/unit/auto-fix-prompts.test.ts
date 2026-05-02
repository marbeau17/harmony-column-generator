import { describe, it, expect } from 'vitest';
import {
  buildSuffixFixPrompt,
  buildKeywordFixPrompt,
  buildAbstractFixPrompt,
  buildLengthFixPrompt,
  buildClaimFixPrompt,
  buildToneFixPrompt,
  buildAutoFixPrompt,
} from '@/lib/auto-fix/prompts';

const SAMPLE_HTML = '<h2 id="x">章</h2><p>本文。</p>';

describe('buildSuffixFixPrompt', () => {
  it('現在比率と目標を user prompt に含める', () => {
    const { system, user } = buildSuffixFixPrompt({
      bodyHtml: SAMPLE_HTML,
      current: 0.08,
      target: 0.15,
    });
    expect(system).toContain('語りかけ');
    expect(user).toContain('8.0%');
    expect(user).toContain('15%');
    expect(user).toContain(SAMPLE_HTML);
  });
});

describe('buildKeywordFixPrompt', () => {
  it('キーワード一覧を番号付で user prompt に含める', () => {
    const { user } = buildKeywordFixPrompt({
      bodyHtml: SAMPLE_HTML,
      keywords: ['チャクラ', '瞑想'],
    });
    expect(user).toContain('1. チャクラ');
    expect(user).toContain('2. 瞑想');
    expect(user).toContain('3 回');
  });
});

describe('buildAbstractFixPrompt', () => {
  it('検出された抽象表現を引用形式で含める', () => {
    const { user } = buildAbstractFixPrompt({
      bodyHtml: SAMPLE_HTML,
      detected_phrase: '引き寄せの法則',
    });
    expect(user).toContain('"引き寄せの法則"');
    expect(user).toContain('具体例');
  });
});

describe('buildLengthFixPrompt', () => {
  it('現在/目標/不足/章ごと追記目安を出力', () => {
    const { user } = buildLengthFixPrompt({
      bodyHtml: SAMPLE_HTML,
      current: 1500,
      target: 2000,
    });
    expect(user).toContain('1500');
    expect(user).toContain('2000');
    expect(user).toContain('500');
  });

  it('小さい不足でも 1 章あたり 80 字下限を保つ', () => {
    const { user } = buildLengthFixPrompt({
      bodyHtml: SAMPLE_HTML,
      current: 1990,
      target: 2000,
    });
    expect(user).toContain('80');
  });
});

describe('buildClaimFixPrompt', () => {
  it('claim_idx を 指定して span 単位の書換を指示', () => {
    const { user, system } = buildClaimFixPrompt({
      bodyHtml: SAMPLE_HTML,
      claim_idx: 7,
    });
    expect(user).toContain('data-claim-idx="7"');
    expect(system).toContain('ハルシネーション');
  });
});

describe('buildToneFixPrompt', () => {
  it('toneTotal が指定されると現在値を出す', () => {
    const { user } = buildToneFixPrompt({
      bodyHtml: SAMPLE_HTML,
      toneTotal: 0.65,
    });
    expect(user).toContain('0.65');
    expect(user).toContain('0.80');
  });

  it('toneTotal 未指定でも fallback メッセージを出す', () => {
    const { user } = buildToneFixPrompt({ bodyHtml: SAMPLE_HTML });
    expect(user).toContain('基準を下回');
  });

  it('blockers があれば section に含める', () => {
    const { user } = buildToneFixPrompt({
      bodyHtml: SAMPLE_HTML,
      toneTotal: 0.5,
      blockers: ['hiraganaRatio', 'rhythmShortLong'],
    });
    expect(user).toContain('hiraganaRatio');
    expect(user).toContain('rhythmShortLong');
  });
});

describe('buildAutoFixPrompt — ディスパッチ', () => {
  it('fix_type=suffix で suffix prompt を返す', () => {
    const { system } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'suffix',
      current_value: 0.05,
      target_value: 0.15,
    });
    expect(system).toContain('語りかけ');
  });

  it('fix_type=keyword で keyword prompt を返す', () => {
    const { user } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'keyword',
      keywords: ['ヒーリング'],
    });
    expect(user).toContain('1. ヒーリング');
  });

  it('fix_type=abstract で detected_phrase を引用', () => {
    const { user } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'abstract',
      detected_phrase: 'カルマ',
    });
    expect(user).toContain('"カルマ"');
  });

  it('fix_type=length で current/target が反映', () => {
    const { user } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'length',
      current_value: 1200,
      target_value: 2000,
    });
    expect(user).toContain('1200');
    expect(user).toContain('2000');
  });

  it('fix_type=claim で claim_idx 反映', () => {
    const { user } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'claim',
      claim_idx: 3,
    });
    expect(user).toContain('data-claim-idx="3"');
  });

  it('fix_type=tone で current_value が toneTotal として渡る', () => {
    const { user } = buildAutoFixPrompt(SAMPLE_HTML, {
      fix_type: 'tone',
      current_value: 0.7,
    });
    expect(user).toContain('0.70');
  });
});
