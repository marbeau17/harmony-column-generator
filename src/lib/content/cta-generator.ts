import * as cheerio from 'cheerio';

// =============================================================================
// CTA自動配置エンジン
// =============================================================================

export const CTA_URL = 'https://harmony-booking.web.app/';

// テーマ別CTA文言テンプレート
// 各テーマに cta1_intro / cta2_mid / cta3_end の3パターン
export const CTA_TEMPLATES: Record<
  string,
  {
    cta1_intro: { catch: string; sub: string };
    cta2_mid: { catch: string; sub: string };
    cta3_end: { catch: string; sub: string };
  }
> = {
  soul_mission: {
    cta1_intro: {
      catch: 'あなたの魂が本当に求めている使命を、一緒に見つけませんか？',
      sub: '心の奥にある声に耳を傾ける、特別なカウンセリングをご用意しています。',
    },
    cta2_mid: {
      catch: '使命に気づいた時、人生は大きく動き出します。',
      sub: 'あなただけの魂の道筋を、プロのカウンセラーがサポートします。',
    },
    cta3_end: {
      catch: '今日が、魂の使命に目覚める日になるかもしれません。',
      sub: 'まずは気軽にご相談ください。あなたの一歩を心よりお待ちしています。',
    },
  },
  relationships: {
    cta1_intro: {
      catch: '人間関係の悩み、ひとりで抱えていませんか？',
      sub: '心のプロが、あなたの人間関係を丁寧に紐解きます。',
    },
    cta2_mid: {
      catch: '関係性のパターンに気づくことで、人生は変わり始めます。',
      sub: 'カウンセリングで、より深い人間関係を築くヒントを見つけましょう。',
    },
    cta3_end: {
      catch: '大切な人との関係を、もっと豊かにしたいあなたへ。',
      sub: '一歩踏み出す勇気を、私たちが支えます。お気軽にご予約ください。',
    },
  },
  grief_care: {
    cta1_intro: {
      catch: '大切な存在を失った悲しみに、寄り添わせてください。',
      sub: 'グリーフケア専門のカウンセラーが、あなたの心を優しく受け止めます。',
    },
    cta2_mid: {
      catch: '悲しみは、愛の深さの証です。',
      sub: '安心できる場所で、あなたの想いをそのまま語ってみませんか。',
    },
    cta3_end: {
      catch: '悲しみの先に、穏やかな光が見える日まで。',
      sub: 'あなたのペースで大丈夫です。いつでもご相談ください。',
    },
  },
  self_growth: {
    cta1_intro: {
      catch: '「もっと自分らしく生きたい」その想いを形にしませんか？',
      sub: 'あなたの内なる成長を加速させる、パーソナルカウンセリング。',
    },
    cta2_mid: {
      catch: '自分を知ることが、変化への第一歩です。',
      sub: 'プロのサポートで、あなたの可能性を最大限に引き出します。',
    },
    cta3_end: {
      catch: '新しい自分に出会う旅を、今日から始めてみませんか。',
      sub: 'まずは無料相談から。あなたの成長を全力で応援します。',
    },
  },
  healing: {
    cta1_intro: {
      catch: '心が疲れた時、安心して休める場所があります。',
      sub: '癒しのプロフェッショナルが、あなたの心を丁寧にケアします。',
    },
    cta2_mid: {
      catch: '本当の癒しは、自分自身を受け入れることから始まります。',
      sub: 'カウンセリングで、心の深いところから癒される体験を。',
    },
    cta3_end: {
      catch: 'あなたの心に、温かな光を取り戻しませんか。',
      sub: 'ゆっくりで大丈夫。あなたのタイミングでお越しください。',
    },
  },
  daily: {
    cta1_intro: {
      catch: '日々の暮らしの中に、心のゆとりを見つけませんか？',
      sub: 'ちょっとした悩みでも、話すだけで心が軽くなることがあります。',
    },
    cta2_mid: {
      catch: '毎日をもっと心地よく過ごすためのヒント、一緒に探しましょう。',
      sub: '暮らしに寄り添うカウンセリングで、日常が変わります。',
    },
    cta3_end: {
      catch: '心が軽くなる一歩を、今日踏み出してみませんか。',
      sub: 'お気軽にご予約ください。あなたのペースを大切にします。',
    },
  },
  introduction: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングに興味を持ったあなたへ。',
      sub: '初めての方でも安心。丁寧にご説明しながら進めます。',
    },
    cta2_mid: {
      catch: '「ちょっと気になる」その気持ちを大切にしてください。',
      sub: '体験してみることで、新しい世界が広がるかもしれません。',
    },
    cta3_end: {
      catch: 'あなたの「気になる」が、人生を変えるきっかけになるかもしれません。',
      sub: 'まずはお試しください。心よりお待ちしています。',
    },
  },
};

// デフォルトテーマ（マッチしない場合のフォールバック）
const DEFAULT_THEME = 'healing';

/**
 * テーマに基づいてCTA文言を選択する
 * @param theme テーマ名
 * @param _articleId 記事ID（将来のA/Bテスト等で使用可能）
 * @returns cta1, cta2, cta3 の文言オブジェクト
 */
export function selectCtaTexts(
  theme: string,
  _articleId: string
): {
  cta1: { catch: string; sub: string };
  cta2: { catch: string; sub: string };
  cta3: { catch: string; sub: string };
} {
  const templates = CTA_TEMPLATES[theme] ?? CTA_TEMPLATES[DEFAULT_THEME];

  return {
    cta1: templates.cta1_intro,
    cta2: templates.cta2_mid,
    cta3: templates.cta3_end,
  };
}

/**
 * CTAのHTMLブロックを生成する
 * @param position CTA配置位置
 * @param catchText キャッチコピー
 * @param subText サブテキスト
 * @param articleSlug 記事スラッグ（UTMパラメータ用）
 * @returns CTA HTMLブロック
 */
export function buildCtaHtml(
  position: 'intro' | 'mid' | 'end',
  catchText: string,
  subText: string,
  articleSlug: string
): string {
  const utmUrl = `${CTA_URL}?utm_source=column&utm_medium=cta&utm_campaign=${encodeURIComponent(articleSlug)}&utm_content=${position}`;

  return `<div class="harmony-cta" data-cta-position="${position}">
  <div class="harmony-cta-inner">
    <p class="harmony-cta-catch">${escapeHtml(catchText)}</p>
    <p class="harmony-cta-sub">${escapeHtml(subText)}</p>
    <a href="${utmUrl}" class="harmony-cta-btn" target="_blank" rel="noopener">カウンセリングを予約する</a>
  </div>
</div>`;
}

/**
 * 記事HTMLにCTAを3箇所自動挿入する
 *
 * 配置ロジック:
 * - CTA1: 1番目のH2タグの直前
 * - CTA2: 中間のH2タグの直前
 * - CTA3: 最後のH2セクション末尾（最後のH2タグ内の末尾）
 *
 * H2が1つ以下の場合はフォールバック配置を行う
 *
 * @param html 記事HTML
 * @param ctaTexts selectCtaTexts の戻り値
 * @param articleSlug 記事スラッグ
 * @returns CTA挿入済みHTML
 */
export function insertCtasIntoHtml(
  html: string,
  ctaTexts: {
    cta1: { catch: string; sub: string };
    cta2: { catch: string; sub: string };
    cta3: { catch: string; sub: string };
  },
  articleSlug: string
): string {
  const $ = cheerio.load(html);
  const h2Elements = $('h2');
  const h2Count = h2Elements.length;

  const cta1Html = buildCtaHtml('intro', ctaTexts.cta1.catch, ctaTexts.cta1.sub, articleSlug);
  const cta2Html = buildCtaHtml('mid', ctaTexts.cta2.catch, ctaTexts.cta2.sub, articleSlug);
  const cta3Html = buildCtaHtml('end', ctaTexts.cta3.catch, ctaTexts.cta3.sub, articleSlug);

  if (h2Count === 0) {
    // H2がない場合: 先頭・中間・末尾に配置
    const body = $('body');
    body.prepend(cta1Html);
    body.append(cta3Html);
    // 中間: 子要素の真ん中あたりに挿入
    const children = body.children();
    const midIndex = Math.floor(children.length / 2);
    if (midIndex > 0) {
      $(children[midIndex]).before(cta2Html);
    } else {
      body.append(cta2Html);
    }
  } else if (h2Count === 1) {
    // H2が1つ: CTA1を前、CTA2とCTA3を後ろに配置
    $(h2Elements[0]).before(cta1Html);
    $(h2Elements[0]).after(cta2Html);
    $('body').append(cta3Html);
  } else {
    // H2が2つ以上: 標準配置
    // CTA1: 1番目のH2の直前
    $(h2Elements[0]).before(cta1Html);

    // CTA2: 中間のH2の直前
    const midH2Index = Math.floor(h2Count / 2);
    $(h2Elements[midH2Index]).before(cta2Html);

    // CTA3: 最後のH2セクション末尾
    // 最後のH2の次のH2がないので、bodyの末尾に配置
    $('body').append(cta3Html);
  }

  return $('body').html() ?? html;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
