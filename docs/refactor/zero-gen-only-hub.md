# Hub 掲載対象の zero-generation 限定化 (P5-55)

**Date:** 2026-05-02
**Status:** 実装完了 (default: zero-gen のみ)
**Author:** Generator/Fixer

## 背景

ユーザー要件:
> 「ハブには **新規作成記事のみ** を掲載してほしい。書き換え (リライト) 記事はハブから除外する」

これまでハブ・sitemap・公開ページは `visibility_state='live'` の全記事を一律掲載していた。
スピリチュアルカウンセラー由起子さんの方針として、**新規視点で書き起こした記事 (zero-generation)** をハブの主役に据え、
旧 source-based リライト記事 (apolloONEBlog 流用の書き換え系) はハブ動線から外す。

## 仕様

### 区分の定義

| 区分 | `articles.generation_mode` | 説明 |
|:---|:---|:---|
| 新規作成 (zero) | `'zero'` | P5-1 以降の zero-generation パイプライン産出物 |
| 書き換え (rewrite) | `'source'` または `null` | 旧パイプライン / source_articles を元に視点変換した記事 |

### デフォルト挙動

- **ハブページ** (`/spiritual/column/`): `generation_mode='zero'` のみ表示
- **sitemap.xml**: `generation_mode='zero'` のみ含める
- **公開ページ** (`/spiritual/column/[slug]/`): `generation_mode='zero'` のみ 200 応答 (rewrite は 404)
- **column/[slug] 内部リンク (関連記事)**: `generation_mode='zero'` の中から選出

### 緊急脱出ハッチ (env)

```bash
NEXT_PUBLIC_HUB_INCLUDE_REWRITES=on
```

`on` を設定すると **rewrite 記事もハブ・sitemap・公開ページに含まれる** (旧挙動への一時復帰)。
本番デフォルトは未設定 (= off)。万一 zero-gen 記事が枯渇した場合の段階退避用。

### 実装箇所

- `src/lib/db/articles.ts::listVisibleArticles()` — `generation_mode='zero'` フィルタを WHERE 句に追加 (env で分岐)
- `src/lib/generators/hub-generator.ts` — クエリ呼び出し時にフィルタ伝播
- `src/lib/export/static-exporter.ts` — sitemap.xml 生成時にフィルタ適用
- `src/app/spiritual/column/page.tsx` — ハブ index ページ
- `src/app/spiritual/column/[slug]/page.tsx` — 個別公開ページ (rewrite slug は notFound())
- `src/app/spiritual/column/[slug]/related.tsx` — 関連記事候補プールを zero に限定

## 影響範囲

### 表示への影響
- **ハブ**: 表示記事数が減少 (rewrite 約 N 件が非表示)
- **sitemap**: rewrite 記事の URL が一旦消える → Search Console 上は「クロール除外」扱い
- **公開ページ**: 既存 rewrite 記事の URL に直アクセスすると 404

### 既存 source-based 記事の扱い

- **DB 上**: `articles` レコードはそのまま保持 (削除しない)
- **FTP 上**: 既に export 済の HTML はサーバ上に残る (FTP 削除はしない方針 = `feedback_ftp_no_delete`)
- **動線**: ハブ・sitemap・関連記事から **リンクされない** (孤立する)
- **管理画面**: ダッシュボードからは引き続き編集・閲覧可能 (`generation_mode` フィルタ無し)

### badge 文言統一
ダッシュボード一覧の badge を以下に統一:
- `generation_mode='zero'` → 「新規」 (緑)
- `generation_mode='source' | null` → 「書換」 (グレー)

## ロールバック手順

1. Vercel に `NEXT_PUBLIC_HUB_INCLUDE_REWRITES=on` を投入
2. 即時再デプロイで rewrite 記事が再表示される
3. DB 変更なし (フィルタは WHERE 句のみ)

## 関連
- `docs/progress.md` P5-55 セクション
- bug fix W5: `replaceImagePlaceholders` で本文 200 文字欠損
- 仕様: `CLAUDE.md` ハブ仕様
