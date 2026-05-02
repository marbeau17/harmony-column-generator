# URL マイグレーション 301 リダイレクト 設計ドキュメント

> 本ドキュメントは設計方針のみを記す。実装は **今回見送り**（§6 TODO 参照）。

## 1. 背景

P5-44 でカラム配信パスが `/column/{slug}.html` 形式から `/spiritual/column/{slug}/` 形式へ変わった。
旧 URL は Google にインデックスされている可能性が高く、放置すると以下の SEO 影響が懸念される。

- 旧 URL アクセス時に 404 を返すと、被リンク資産が失われ、サーチコンソール (SC) のクロールエラーが急増する。
- 重複インデックス（旧 `.html` と新 `/`）が並走すると、評価が分散しランキングが下がる恐れ。
- 内部リンク・外部被リンクの一部が旧 URL のままなので、シームレスに新 URL へ誘導する必要がある。

→ **301 (Moved Permanently)** で旧 → 新へ恒久リダイレクトを設定し、SEO 評価を新 URL に集約する。

## 2. 旧 URL → 新 URL マッピング

| 旧 URL | 新 URL | 種別 |
|:---|:---|:---|
| `https://harmony-mc.com/column/{slug}.html` | `https://harmony-mc.com/spiritual/column/{slug}/` | 個別記事 |
| `https://harmony-mc.com/columns/` | `https://harmony-mc.com/spiritual/column/` | 一覧（複数形） |
| `https://harmony-mc.com/column/` | `https://harmony-mc.com/spiritual/column/` | 一覧（単数形・存在すれば） |

スラッグは旧 URL の `{slug}` 部をそのまま流用する（マッピング差分が出た場合は別途対応表を追加）。

## 3. 設定方法（3 案）

### 案 A: lolipop の `.htaccess` に Redirect / RewriteRule（推奨）

サーバーレベルでリダイレクトを完結させる方式。アプリケーションコード変更ゼロ。

```apache
# 個別記事: /column/{slug}.html → /spiritual/column/{slug}/
RewriteEngine On
RewriteRule ^column/([^/]+)\.html$ /spiritual/column/$1/ [R=301,L]

# 一覧ページ
Redirect 301 /columns/ /spiritual/column/
Redirect 301 /column/  /spiritual/column/
```

- Pros: 高速、アプリ非依存、Google が即時 301 を解釈。
- Cons: lolipop FTP デプロイフローに `.htaccess` 反映ステップを追加する必要あり。

### 案 B: Next.js middleware で server-side redirect

admin / Vercel 経由のリクエストにのみ対応する方式。`middleware.ts` で `/column/...html` を検知して 301 を返す。

- Pros: TypeScript で型安全、テストしやすい。
- Cons: harmony-mc.com は静的 HTML を lolipop で配信しているため、Next.js を通らず **本ケースでは効かない**。Vercel 配信パスへ完全移行する場合のみ有効。

### 案 C: ハブ HTML 内に JS-based redirect（last resort）

旧 `.html` ファイルを残し、`<meta http-equiv="refresh">` または `<script>location.replace()</script>` で新 URL へ飛ばす。

- Pros: サーバー設定変更不要。
- Cons: クライアント依存、SEO 評価が完全には引き継がれない（Google は JS リダイレクトを軟弱な signal として扱う）。

## 4. 推奨

**案 A（lolipop `.htaccess`）** を採用する。

- 理由: 静的配信レイヤで完結、コード変更不要、301 が確実に伝播。
- リスク: `.htaccess` の文法ミスで全ページ 500 になる恐れ → ステージング相当のサブディレクトリで先行検証する。

## 5. 検証

リダイレクト設定後、以下のコマンドで 301 が返ることを確認する。

```bash
# 個別記事
curl -I https://harmony-mc.com/column/sample-slug.html
# → HTTP/1.1 301 Moved Permanently
# → Location: https://harmony-mc.com/spiritual/column/sample-slug/

# 一覧
curl -I https://harmony-mc.com/columns/
curl -I https://harmony-mc.com/column/
```

加えて、Google Search Console の「URL 検査」で新 URL がインデックスされ、旧 URL が「リダイレクトされたページ」として認識されることを確認する。

## 6. TODO（実装見送り判断）

- [ ] Google Search Console で旧 URL `/column/{slug}.html` が現在もインデックスされているか確認。
- [ ] インデックスされている場合のみ、案 A を実装フェーズへ進める。
- [ ] インデックスされていなければ、`.htaccess` 変更は不要（新規 URL から開始するだけで十分）。
- [ ] 判断結果を `docs/progress.md` に追記し、必要に応じて別途 P5-x チケット化する。

> 実装は SC 確認後に判断するため、本タスクではドキュメント化のみで完了とする。
