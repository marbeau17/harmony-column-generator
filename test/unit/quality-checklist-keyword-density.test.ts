import { describe, it, expect } from 'vitest';
import { runQualityChecklist } from '@/lib/content/quality-checklist';

// P5-65: keyword_density トークナイザー — 「カンマ + 空白」区切りの複数キーワードに対応
//
// 入力例:
//   keyword = "気功 自然, 東洋医学 自然"
// 第一段階: ", " で分割 → ["気功 自然", "東洋医学 自然"]
// 第二段階: 各フレーズを空白で分割 → ["気功", "自然", "東洋医学", "自然"]
// → unique tokens = ["気功", "自然", "東洋医学"]
// バグ前は "自然," というコンマ付きトークンがそのまま残り「最少トークン『自然,』0回」と表示されていた。

const TITLE = '気功と東洋医学から見た自然のリズムについて';
const META = 'この記事は気功と東洋医学の観点から自然について丁寧に解説する内容です。';

function buildHtml(text: string): string {
  // 必須項目をある程度満たすダミー HTML（keyword_density のみを評価したいので最小限の構造でよい）
  return [
    '<article>',
    '<h2>気功と自然</h2>',
    `<p>${text}</p>`,
    '<h2>東洋医学の視点</h2>',
    `<p>${text}</p>`,
    '<h2>まとめ</h2>',
    `<p>${text}</p>`,
    '</article>',
  ].join('\n');
}

function findKeywordItem(items: ReturnType<typeof runQualityChecklist>['items']) {
  const item = items.find(i => i.id === 'keyword_density');
  if (!item) throw new Error('keyword_density item not found');
  return item;
}

describe('checkKeywordDensity — P5-65 トークナイザー修正', () => {
  it('「気功 自然, 東洋医学 自然」のような , 区切りで「自然,」というコンマ付きトークンを生成しない', () => {
    const text = '気功は自然のリズムを大切にする実践です。東洋医学もまた、自然との調和を重視します。気功と東洋医学はどちらも自然から学ぶ知恵です。';
    const result = runQualityChecklist({
      title: TITLE,
      html: buildHtml(text),
      keyword: '気功 自然, 東洋医学 自然',
      metaDescription: META,
    });
    const item = findKeywordItem(result.items);
    // detail に「自然,」（コンマ付き）が現れてはいけない
    expect(item.detail ?? '').not.toMatch(/自然,/);
    // weakToken は本来のトークン（気功 / 自然 / 東洋医学 のいずれか）であるべき
    expect(item.detail ?? '').toMatch(/「(気功|自然|東洋医学)」/);
  });

  it('「気功 自然, 東洋医学 自然」を投入したとき各トークンが本文中に出現すれば pass する', () => {
    const text = '気功は自然のリズムに沿った実践です。東洋医学もまた自然と調和します。気功と東洋医学はどちらも自然から多くを学びます。';
    const result = runQualityChecklist({
      title: TITLE,
      html: buildHtml(text),
      keyword: '気功 自然, 東洋医学 自然',
      metaDescription: META,
    });
    const item = findKeywordItem(result.items);
    expect(item.status).toBe('pass');
    expect(typeof item.value).toBe('number');
    expect(item.value as number).toBeGreaterThanOrEqual(3);
  });

  it('全角コンマ「，」や読点「、」も第一段階分割の区切り文字として扱う', () => {
    const text = '気功は自然のリズムを尊ぶ。東洋医学もまた自然との調和を重んじる。気功と東洋医学はどちらも自然と深く結びつく。';
    const result = runQualityChecklist({
      title: TITLE,
      html: buildHtml(text),
      keyword: '気功 自然，東洋医学 自然',
      metaDescription: META,
    });
    const item = findKeywordItem(result.items);
    // 「自然，」「自然、」のような区切り文字付きトークンが出てはいけない
    expect(item.detail ?? '').not.toMatch(/自然[、,，]/);
    expect(item.detail ?? '').toMatch(/「(気功|自然|東洋医学)」/);
  });

  it('単一キーワード（カンマなし・スペースなし）は従来通り単一フレーズとして評価する', () => {
    const text = '気功は古来より続く実践です。気功には深い知恵があります。気功を通じて自分を整えましょう。';
    const result = runQualityChecklist({
      title: '気功で整える毎日のリズム入門ガイド',
      html: buildHtml(text),
      keyword: '気功',
      metaDescription: META,
    });
    const item = findKeywordItem(result.items);
    expect(item.status).toBe('pass');
    // detail はマルチ表示（フルフレーズ／最少トークン）にならず単純な「N回」表記
    expect(item.detail ?? '').toMatch(/^\d+回$/);
  });

  it('複数キーワードで一部のトークンが本文に欠落していれば warn 以下になる', () => {
    // 「東洋医学」が本文に登場しないケース
    const text = '気功は自然のリズムを大切にします。気功で自然と調和できます。気功と自然のつながりを学びます。';
    const result = runQualityChecklist({
      title: TITLE,
      html: buildHtml(text),
      keyword: '気功 自然, 東洋医学 自然',
      metaDescription: META,
    });
    const item = findKeywordItem(result.items);
    // 「東洋医学」が 0 回なので effectiveCount = max(fullCount, 0) のいずれかが小さくなり、pass にはならない
    expect(item.status).not.toBe('pass');
    // weakToken は「東洋医学」になるはず
    expect(item.detail ?? '').toContain('東洋医学');
    expect(item.detail ?? '').toContain('0回');
  });
});
