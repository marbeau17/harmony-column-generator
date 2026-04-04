import * as cheerio from 'cheerio';

// =============================================================================
// CTA自動配置エンジン
// 3段階ファネル: 情報提供(counseling) → 検討促進(system) → コンバージョン(booking)
// =============================================================================

// ─── CTA URL定数 ────────────────────────────────────────────────────────────

export const CTA_URLS = {
  counseling: 'https://harmony-mc.com/counseling/',
  system: 'https://harmony-mc.com/system/',
  booking: 'https://harmony-booking.web.app/',
};

// ─── CTA デフォルト設定 ──────────────────────────────────────────────────────

export const CTA_DEFAULTS = {
  cta1: {
    url: CTA_URLS.counseling,
    buttonText: 'カウンセリングについて詳しく見る',
    position: 'intro' as const,
    purpose: 'information', // 情報提供
    bannerUrl: '',
    bannerAlt: 'スピリチュアルカウンセリングのご案内',
  },
  cta2: {
    url: CTA_URLS.system,
    buttonText: 'ご予約の流れを確認する',
    position: 'mid' as const,
    purpose: 'consideration', // 検討促進
    bannerUrl: '',
    bannerAlt: 'カウンセリングご予約の流れ',
  },
  cta3: {
    url: CTA_URLS.booking,
    buttonText: 'カウンセリングを予約する',
    position: 'end' as const,
    purpose: 'conversion', // コンバージョン
    bannerUrl: '',
    bannerAlt: 'カウンセリングのご予約',
  },
};

// ─── CTA設定の型 ─────────────────────────────────────────────────────────────

export interface CtaConfig {
  url: string;
  buttonText: string;
  position: 'intro' | 'mid' | 'end';
  purpose: string;
  bannerUrl: string;
  bannerAlt: string;
}

export interface CtaSettingsAll {
  cta1: CtaConfig;
  cta2: CtaConfig;
  cta3: CtaConfig;
}

// ─── テーマ別CTA文言テンプレート ──────────────────────────────────────────────
// 各テーマに cta1_intro(説明ページ向け) / cta2_mid(流れページ向け) / cta3_end(予約向け) の3パターン

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
      catch: 'スピリチュアルカウンセリングでは、魂の使命についても丁寧にお伝えしています。',
      sub: 'あなたの魂が本当に求めている道を知りたい方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの流れや準備についてはこちらをご覧ください。',
      sub: '初めての方でも安心して受けていただけるよう、丁寧にご説明しています。',
    },
    cta3_end: {
      catch: 'あなたの魂の声を聴く時間を、由起子にお任せください。',
      sub: '使命に目覚める一歩を、心よりお待ちしています。',
    },
  },
  relationships: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、人間関係の根本にある魂のつながりについてもお伝えしています。',
      sub: '大切な人との関係に悩んでいる方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングではどんなことが分かるのか、流れをご紹介しています。',
      sub: 'お気持ちの整理から始められますので、安心してお越しください。',
    },
    cta3_end: {
      catch: '大切な人との関係を、魂のレベルから見つめ直してみませんか。',
      sub: 'あなたの一歩を、由起子が温かくお迎えします。',
    },
  },
  grief_care: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、大切な方とのつながりについても丁寧にお伝えしています。',
      sub: '悲しみの中にいる方へ、まずはカウンセリングでどんなことができるかをご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの流れや当日の過ごし方についてはこちらをご覧ください。',
      sub: 'あなたのペースを大切にしながら、安心できる空間をお作りします。',
    },
    cta3_end: {
      catch: '悲しみの先に、穏やかな光を見つける時間を過ごしませんか。',
      sub: 'あなたの想いを、由起子がそっと受け止めます。',
    },
  },
  self_growth: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、あなたの内なる成長の道筋についてもお伝えしています。',
      sub: '自分らしく生きるためのヒントを知りたい方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの具体的な流れや準備についてはこちらをご確認ください。',
      sub: '初めての方にも分かりやすくご案内していますので、ご安心ください。',
    },
    cta3_end: {
      catch: '新しい自分に出会う旅を、由起子と一緒に始めてみませんか。',
      sub: 'あなたの成長を、魂のレベルからサポートします。',
    },
  },
  healing: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、心の深いところにある疲れについても丁寧にお伝えしています。',
      sub: '癒しを求めている方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの流れや当日の過ごし方についてはこちらをご覧ください。',
      sub: 'リラックスした状態で受けていただけるよう、丁寧にご案内しています。',
    },
    cta3_end: {
      catch: 'あなたの心に、温かな光を取り戻す時間を過ごしませんか。',
      sub: 'ゆっくりで大丈夫。由起子があなたのタイミングでお待ちしています。',
    },
  },
  daily: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、日々の暮らしに潜む気づきについてもお伝えしています。',
      sub: '毎日をもっと心地よく過ごしたい方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの流れやご準備についてはこちらをご覧ください。',
      sub: 'ちょっとした悩みでも、安心してお話しいただける場所です。',
    },
    cta3_end: {
      catch: '心が軽くなる一歩を、由起子と一緒に踏み出してみませんか。',
      sub: 'あなたのペースを大切に、温かくお迎えします。',
    },
  },
  introduction: {
    cta1_intro: {
      catch: 'スピリチュアルカウンセリングでは、初めての方にも分かりやすく丁寧にお伝えしています。',
      sub: '「ちょっと気になる」方は、まずカウンセリングの内容をご覧ください。',
    },
    cta2_mid: {
      catch: 'カウンセリングの具体的な流れや当日の準備についてはこちらをご覧ください。',
      sub: '初めてでも安心して受けていただけるよう、丁寧にご説明しています。',
    },
    cta3_end: {
      catch: 'あなたの「気になる」が、人生を変えるきっかけになるかもしれません。',
      sub: '由起子が心を込めてお迎えします。まずはお気軽にご予約ください。',
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

// ─── CTAアイコン（SVGインライン） ──────────────────────────────────────────

const CTA_ICONS: Record<string, string> = {
  // CTA1: 情報提供 — ブックアイコン
  cta1: '<svg class="harmony-cta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  // CTA2: 検討促進 — ステップアイコン
  cta2: '<svg class="harmony-cta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
  // CTA3: コンバージョン — カレンダーアイコン
  cta3: '<svg class="harmony-cta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>',
};

// ─── CTAラベル（バナー上部のステップ表示） ──────────────────────────────────

const CTA_LABELS: Record<string, string> = {
  cta1: 'カウンセリングを知る',
  cta2: 'ご予約の流れ',
  cta3: 'カウンセリングを予約する',
};

/**
 * CTAのHTMLブロックを生成する（ヒーローカード型）
 *
 * 新デザイン:
 * - バナー画像をカード背景として使用
 * - 半透明オーバーレイでテキストの可読性を確保
 * - アイコンでCTAの目的を視覚的に表現
 * - data-cta-key属性でCSSから色分け
 *
 * @param ctaKey CTA識別子 (cta1, cta2, cta3)
 * @param position CTA配置位置
 * @param catchText キャッチコピー
 * @param subText サブテキスト
 * @param articleSlug 記事スラッグ（UTMパラメータ用）
 * @param ctaConfig CTA設定（URL, ボタンテキスト, バナー等）
 * @returns CTA HTMLブロック
 */
export function buildCtaHtml(
  ctaKey: 'cta1' | 'cta2' | 'cta3',
  position: 'intro' | 'mid' | 'end',
  catchText: string,
  subText: string,
  articleSlug: string,
  ctaConfig?: Partial<CtaConfig>
): string {
  const defaults = CTA_DEFAULTS[ctaKey];
  const url = ctaConfig?.url || defaults.url;
  const buttonText = ctaConfig?.buttonText || defaults.buttonText;
  const bannerUrl = ctaConfig?.bannerUrl || defaults.bannerUrl;
  const bannerAlt = ctaConfig?.bannerAlt || defaults.bannerAlt;
  const purpose = ctaConfig?.purpose || defaults.purpose;

  const utmUrl = `${url}?utm_source=column&utm_medium=cta&utm_campaign=${encodeURIComponent(articleSlug)}&utm_content=${ctaKey}_${purpose}`;

  const icon = CTA_ICONS[ctaKey] || '';
  const label = CTA_LABELS[ctaKey] || '';

  // バナー画像がある場合: 背景画像として使用するヒーローカード型
  // バナー画像がない場合: グラデーション背景のフォールバック
  const bgStyle = bannerUrl
    ? ` style="background-image:url('${escapeHtml(bannerUrl)}')"`
    : '';

  // SEO用: 非表示imgタグでalt textを保持（背景画像にはaltがないため）
  const seoImg = bannerUrl
    ? `\n    <img class="harmony-cta-seo-img" src="${escapeHtml(bannerUrl)}" alt="${escapeHtml(bannerAlt)}" loading="lazy" />`
    : '';

  return `<div class="harmony-cta" data-cta-position="${position}" data-cta-key="${ctaKey}"${bgStyle}>
  <div class="harmony-cta-overlay">
    <div class="harmony-cta-inner">${seoImg}
      <span class="harmony-cta-label">${icon} ${escapeHtml(label)}</span>
      <p class="harmony-cta-catch">${escapeHtml(catchText)}</p>
      <p class="harmony-cta-sub">${escapeHtml(subText)}</p>
      <a href="${utmUrl}" class="harmony-cta-btn" target="_blank" rel="noopener">${escapeHtml(buttonText)}</a>
    </div>
  </div>
</div>`;
}

/**
 * 記事HTMLにCTAを3箇所自動挿入する
 *
 * 配置ロジック:
 * - CTA1: 1番目のH2タグの直前（情報提供 → カウンセリング説明ページ）
 * - CTA2: 中間のH2タグの直前（検討促進 → 予約の流れページ）
 * - CTA3: 最後のH2セクション末尾（コンバージョン → 予約ページ）
 *
 * H2が1つ以下の場合はフォールバック配置を行う
 *
 * @param html 記事HTML
 * @param ctaTexts selectCtaTexts の戻り値
 * @param articleSlug 記事スラッグ
 * @param ctaSettings オプション: 管理画面から設定されたCTA設定
 * @returns CTA挿入済みHTML
 */
export function insertCtasIntoHtml(
  html: string,
  ctaTexts: {
    cta1: { catch: string; sub: string };
    cta2: { catch: string; sub: string };
    cta3: { catch: string; sub: string };
  },
  articleSlug: string,
  ctaSettings?: Partial<CtaSettingsAll>
): string {
  const $ = cheerio.load(html);
  const h2Elements = $('h2');
  const h2Count = h2Elements.length;

  const cta1Html = buildCtaHtml('cta1', 'intro', ctaTexts.cta1.catch, ctaTexts.cta1.sub, articleSlug, ctaSettings?.cta1);
  const cta2Html = buildCtaHtml('cta2', 'mid', ctaTexts.cta2.catch, ctaTexts.cta2.sub, articleSlug, ctaSettings?.cta2);
  const cta3Html = buildCtaHtml('cta3', 'end', ctaTexts.cta3.catch, ctaTexts.cta3.sub, articleSlug, ctaSettings?.cta3);

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
