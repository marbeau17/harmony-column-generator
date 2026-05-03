# 記事 publish + FTP 反映 エンドツーエンド検証チェックリスト

> 対象: Harmony Column Generator / publish + FTP デプロイ統合フロー
> 目的: UI 操作 → DB 状態遷移 → FTP 反映 までを 1 本の経路で確認するための手順
> 関連: P5-47 (visibility API) / hub deploy API / publish_events

---

## 1. 想定ユーザー操作

| # | 画面 | 操作 | エンドポイント | 備考 |
|---|------|------|----------------|------|
| S1 | `/admin/articles` | 「公開」ボタンをクリック | `POST /api/articles/{id}/visibility` | P5-47 visibility API |
| S2 | `/admin/articles/{id}` | 「再デプロイ」をクリック | `POST /api/articles/{id}/deploy` | 単記事 FTP push |
| S3 | `/admin/settings` → デプロイタブ | 「FTP デプロイ」(ハブ) をクリック | `POST /api/hub/deploy` | ハブ index 再生成 |

各ステップは独立に成功すること。S1 → S2 → S3 の順で連結検証する。

---

## 2. 各ステップで起きるべき変化 (DB × FTP)

### S1: 公開ボタン (visibility API)

- **DB**:
  - `articles.status`: `draft` → `published`
  - `articles.visibility_state`: `hidden` → `visible`
  - `articles.is_hub_visible`: `false` → `true`
  - `articles.slug`: 確定 (NULL なら自動採番)
  - `articles.published_at`: NULL → `now()`
- **FTP**: 変化なし (DB のみ)
- **publish_events**: `action='publish'` を 1 件 INSERT

### S2: 再デプロイ (deploy API)

- **DB**:
  - `articles.last_deployed_at`: 更新
  - `articles.deploy_status`: `pending` → `success`
- **FTP**:
  - `/spiritual/column/{slug}/index.html` を upsert
  - `/spiritual/column/{slug}/images/{hero,body,summary}.jpg` を upsert
- **publish_events**: `action='deploy'` を 1 件 INSERT

### S3: ハブデプロイ (hub deploy API)

- **DB**: ハブ生成スナップショット (`hub_snapshots` 等) を更新
- **FTP**:
  - `/spiritual/column/index.html` を再生成・upsert
  - 公開対象 (`is_hub_visible=true`) のみ列挙されること
- **publish_events**: `action='hub_deploy'` を 1 件 INSERT

---

## 3. 検証コマンド

```bash
# DB 状態確認 (slug ごとに 1 ファイル生成)
tsx scripts/check-{slug}-state.ts

# FTP に滞留 / 不整合がないか診断
tsx scripts/diag-stuck-articles-ftp.ts

# 公開 URL の HTTP 200 / Last-Modified を確認
curl -I https://harmony-mc.com/spiritual/column/{slug}/index.html
curl -I https://harmony-mc.com/spiritual/column/index.html

# publish_events 直近 N 件
tsx scripts/dump-publish-events.ts --limit=20
```

期待値:
- `curl -I` は `HTTP/1.1 200 OK` かつ `Last-Modified` が S2/S3 実行時刻以降
- `diag-stuck-articles-ftp.ts` は `OK: 0 stuck` を返す

---

## 4. 既知のサイレント失敗ポイント (D7 結果参照 / placeholder)

> Plan フェーズで D7 ("FTP サイレント失敗トリアージ") の結果が出たら、以下に追記する。

- TBD: visibility=visible かつ FTP に index.html が存在しないケースの検出方法
- TBD: hub deploy 成功でも個別記事 deploy が遅延しているときの整合性確認
- TBD: 画像 upsert が 0 byte で完了する rare case の再現手順
- TBD: publish_events に `action='deploy'` が記録されているのに FTP に痕跡がないケース

---

## 改訂履歴
- 2026-05-02: 初版作成 (P5-47 + hub deploy 統合 E2E)
