# よくある障害対応 Runbook

> Harmony Column Generator 運用時の頻出トラブル対応手順。
> 上から順に確認すれば 9 割解決する。

---

## 1. 「ボタン押しても動かない」

クライアント側 JS / API ハンドラの故障を疑う。

- **使うスクリプト:** なし（ブラウザ DevTools と Vercel Dashboard）
- **実行コマンド:**
  - ブラウザ DevTools → Console / Network タブで赤エラー確認
  - `vercel logs <deployment-url> --follow` でサーバー側ログ確認
- **期待結果:** Console / Vercel に該当 API の 4xx/5xx が出る → そのエンドポイントを修正
- **見落とし注意:** ボタン側 `onClick` で `toast.error()` が呼ばれているか確認。silent failure なら toast 配線不足。

---

## 2. 「記事が公開されない」

DB 上の状態フラグが整合していない可能性大。

- **使うスクリプト:** `scripts/check-article-state.ts`（無ければ ad hoc クエリ）
- **実行コマンド:**
  ```bash
  tsx scripts/check-article-state.ts <article-id>
  ```
- **確認カラム:**
  - `articles.status` が `'published'` か
  - `articles.visibility_state` が `'public'` か
  - `articles.reviewed_at` に値が入っているか（レビュー済みフラグ）
- **期待結果:** 3 つ全て揃って初めて公開対象。揃わない場合は管理 UI から再レビュー → 公開。

---

## 3. 「ハブに記事が出ない」

ハブページは generation_mode と公開状態でフィルタされている。

- **使うスクリプト:** `scripts/regenerate-hub.ts`
- **実行コマンド:**
  ```bash
  tsx scripts/check-article-state.ts <article-id>  # generation_mode 確認
  tsx scripts/regenerate-hub.ts                    # ハブ再生成
  ```
- **確認カラム:** `articles.generation_mode` が `'zero'` または該当モード
- **期待結果:** ハブ HTML が再生成され FTP に upload される。reload 後に該当記事カードが表示。

---

## 4. 「公開 URL が 404」

FTP 上に物理ファイルが無い、または deploy が走っていない。

- **使うスクリプト:** `scripts/check-ftp-files.ts`、`scripts/redeploy-article.ts`
- **実行コマンド:**
  ```bash
  tsx scripts/check-ftp-files.ts <slug>     # FTP に .html があるか
  tsx scripts/redeploy-article.ts <id>      # 強制再デプロイ
  ```
- **期待結果:** FTP に `column/<slug>.html` が存在し、HTTP 200 で返る。

---

## 5. 「画像が表示されない」

Banana Pro 生成後に image_files の URL が壊れている / placeholder 残置。

- **使うスクリプト:** `scripts/check-image-files.ts`、`scripts/replace-placeholders.ts`
- **実行コマンド:**
  ```bash
  tsx scripts/check-image-files.ts <article-id>
  tsx scripts/replace-placeholders.ts <article-id>
  ```
- **確認カラム:** `image_files.url` が `https://` で始まる Storage URL になっているか
- **期待結果:** placeholder（`__IMG_HERO__` 等）が実 URL に置換され HTML 再生成。

---

## 6. 「関連記事が変」

embedding 計算後に related が古いまま固定されている。

- **使うスクリプト:** `scripts/recompute-all-related.ts`
- **実行コマンド:**
  ```bash
  tsx scripts/recompute-all-related.ts
  ```
- **期待結果:** 全記事の `related_articles` JSON が再計算され、コサイン類似度上位 N 件で上書き。

---

## 7. 「不正コメント `<!--<img`」

過去のテンプレート不具合で HTML に壊れたコメントが残るケース。

- **使うスクリプト:** `scripts/fix-broken-img-comments.ts`
- **実行コマンド:**
  ```bash
  tsx scripts/fix-broken-img-comments.ts        # 全記事走査・修正
  tsx scripts/redeploy-affected-articles.ts     # 影響記事を再デプロイ
  ```
- **期待結果:** `<!--<img` 始まりの壊れコメントが除去され、本文表示が正常化。article_revisions に履歴 INSERT 必須。

---

## 8. 「テスト失敗」

CI / ローカルで vitest / tsc がコケた場合の切り分け順。

- **使うスクリプト:** なし（標準ツール）
- **実行コマンド:**
  ```bash
  npx tsc --noEmit                # 型エラー先に潰す
  npm run test -- --reporter=verbose <失敗ファイル>
  git log --oneline -10 <失敗ファイル>  # 最近の変更履歴
  ```
- **期待結果:** tsc 通過 → vitest 単体実行で原因特定 → 直近 commit を review し regression を切り戻し or 修正。
- **エスカレーション:** 3 ループ修正で直らなければ `progress.md` に状態スナップショットを書いて人間に介入要請（グローバル §4.3 準拠）。

---

## 補足

- すべての修正系スクリプトは **必ず `article_revisions` に履歴 INSERT してから本体 UPDATE** すること（プロジェクト固有禁止事項）。
- 本番反映前に `develop` ブランチでリハーサルする。
- 重大障害時は Vercel deploy を一時 freeze（環境変数 `DEPLOY_FREEZE=1`）して二次被害を防ぐ。
