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
  cta2: {
    url: CTA_URLS.system,
    buttonText: 'ご予約の流れを確認する',
    position: 'mid' as const,
    purpose: 'consideration', // 検討促進
  },
  cta3: {
    url: CTA_URLS.booking,
    buttonText: 'カウンセリングを予約する',
    position: 'end' as const,
    purpose: 'conversion', // コンバージョン
  },
};

// ─── CTA設定の型 ─────────────────────────────────────────────────────────────

export interface CtaConfig {
  url: string;
  buttonText: string;
  position: 'intro' | 'mid' | 'end';
  purpose: string;
  /** @deprecated バナー画像は廃止済み。後方互換のため残存 */
  bannerUrl?: string;
  /** @deprecated バナー画像は廃止済み。後方互換のため残存 */
  bannerAlt?: string;
}

export interface CtaSettingsAll {
  cta2: CtaConfig;
  cta3: CtaConfig;
}

// ─── テーマ別CTA文言テンプレート ──────────────────────────────────────────────
// 各テーマに cta2_mid(流れページ向け) / cta3_end(予約向け) の2パターン

export const CTA_TEMPLATES: Record<
  string,
  {
    cta2_mid: { catch: string; sub: string };
    cta3_end: { catch: string; sub: string };
  }
> = {
  soul_mission: {
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
 * @returns cta2, cta3 の文言オブジェクト
 */
export function selectCtaTexts(
  theme: string,
  _articleId: string
): {
  cta2: { catch: string; sub: string };
  cta3: { catch: string; sub: string };
} {
  const templates = CTA_TEMPLATES[theme] ?? CTA_TEMPLATES[DEFAULT_THEME];

  return {
    cta2: templates.cta2_mid,
    cta3: templates.cta3_end,
  };
}

// ─── CTAバッジラベル ─────────────────────────────────────────────────────

const CTA_BADGES: Record<string, string> = {
  cta2: 'ご予約の流れ',
  cta3: 'ご予約はこちら',
};

/**
 * CTAのHTMLブロックを生成する（CSSオンリーデザイン）
 *
 * デザイン:
 * - バナー画像不使用 — CSSグラデーションのみ
 * - data-cta-key属性でCSSから3種類を色分け
 * - コンパクトで記事の流れを妨げない
 *
 * @param ctaKey CTA識別子 (cta2, cta3)
 * @param position CTA配置位置
 * @param catchText キャッチコピー
 * @param subText サブテキスト
 * @param articleSlug 記事スラッグ（UTMパラメータ用）
 * @param ctaConfig CTA設定（URL, ボタンテキスト等）
 * @returns CTA HTMLブロック
 */
export function buildCtaHtml(
  ctaKey: 'cta2' | 'cta3',
  position: 'intro' | 'mid' | 'end',
  catchText: string,
  subText: string,
  articleSlug: string,
  ctaConfig?: Partial<CtaConfig>
): string {
  const defaults = CTA_DEFAULTS[ctaKey];
  const url = ctaConfig?.url || defaults.url;
  const buttonText = ctaConfig?.buttonText || defaults.buttonText;
  const purpose = ctaConfig?.purpose || defaults.purpose;

  const utmUrl = `${url}?utm_source=column&utm_medium=cta&utm_campaign=${encodeURIComponent(articleSlug)}&utm_content=${ctaKey}_${purpose}`;

  const badge = CTA_BADGES[ctaKey] || '';

  return `<div class="harmony-cta harmony-cta-${ctaKey.slice(-1)}" data-cta-position="${position}" data-cta-key="${ctaKey}">
  <div class="harmony-cta-inner">
    <div class="harmony-cta-badge">${escapeHtml(badge)}</div>
    <p class="harmony-cta-catch">${escapeHtml(catchText)}</p>
    <p class="harmony-cta-sub">${escapeHtml(subText)}</p>
    <a href="${utmUrl}" class="harmony-cta-btn" target="_blank" rel="noopener">${escapeHtml(buttonText)}</a>
  </div>
</div>`;
}

/**
 * 記事HTMLにCTAを2箇所自動挿入する
 *
 * 配置ロジック:
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
    cta2: { catch: string; sub: string };
    cta3: { catch: string; sub: string };
  },
  articleSlug: string,
  ctaSettings?: Partial<CtaSettingsAll>
): string {
  const $ = cheerio.load(html);

  // Idempotency guard: if CTAs already exist, don't insert again
  if ($('.harmony-cta').length > 0) {
    return $('body').html() ?? html;
  }

  const h2Elements = $('h2');
  const h2Count = h2Elements.length;

  // CTA1は削除（冒頭CTAは読者の没入を妨げるため）
  // CTA2（中盤・検討促進）とCTA3（終盤・コンバージョン）の2つのみ配置
  const cta2Html = buildCtaHtml('cta2', 'mid', ctaTexts.cta2.catch, ctaTexts.cta2.sub, articleSlug, ctaSettings?.cta2);
  const cta3Html = buildCtaHtml('cta3', 'end', ctaTexts.cta3.catch, ctaTexts.cta3.sub, articleSlug, ctaSettings?.cta3);

  if (h2Count === 0) {
    const body = $('body');
    const children = body.children();
    const midIndex = Math.floor(children.length / 2);
    if (midIndex > 0) {
      $(children[midIndex]).before(cta2Html);
    }
    body.append(cta3Html);
  } else if (h2Count === 1) {
    $(h2Elements[0]).after(cta2Html);
    $('body').append(cta3Html);
  } else {
    // H2が2つ以上: CTA2を中間H2の直前、CTA3を末尾に配置
    const midH2Index = Math.floor(h2Count / 2);
    $(h2Elements[midH2Index]).before(cta2Html);
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
