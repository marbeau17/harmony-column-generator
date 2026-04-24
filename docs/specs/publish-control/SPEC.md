# 単一ボタン公開制御 — 統合仕様書（使用書）

**対象:** Harmony Column Generator / dashboard 記事一覧
**日付:** 2026-04-19
**ステータス:** ユーザーレビュー待ち（未実装）
**関連ファイル:** 本ディレクトリの `01-…` 〜 `20-…` に各論の根拠

---

## 1. 目的

- 記事一覧の「確認」チェックボックス列を**廃止**し、1記事 = 1つの「公開/非公開」ボタンで完全制御する
- ハブページと関連記事ブロックを**同一アクション内で自動同期**し、表示の食い違い（表示されっぱなし／表示されないまま）を根絶する
- 本番記事 45件の書き換えは本セッションでは**絶対に発生しない**（CIガード＋実行時ガード＋FTPアサートの3重）

## 2. 現状（Before）の要点

| 項目 | 現状 | 問題 |
|---|---|---|
| 表示判定 | `status='published' AND reviewed_at IS NOT NULL` をコード5箇所で重複（`src/lib/generators/hub-generator.ts:430`, `/column/page.tsx`, `/column/[slug]/page.tsx`, `sitemap.ts`, `/api/articles/[id]/deploy`） | RLSは `status` のみで守らないため1箇所でもWHERE漏れでゴースト発生 |
| チェックボックス | `PUT /api/articles/[id]` で `reviewed_at` を書いたあと `fetch('/api/hub/deploy').catch(()=>{})` | fire-and-forget + Vercel 120s 上限 → ハブが静かに古いまま |
| 公開遷移 | `transition → 'published'` は `/api/hub/rebuild`（メモリのみ、FTP上げない）を呼ぶ | DB公開済でもFTPハブ未更新 → 「公開されないまま」 |
| 非公開化 | FTPに `remove` 系の呼び出しが**1箇所も存在しない** | 直URLで延々と読めるゴースト → 「表示されっぱなし」 |
| 関連記事 | `updateAllRelatedArticles()` は DBの JSONB のみ更新、FTPの `<slug>/index.html` は再生成されない | 公開済記事の関連ブロックが塩漬け |
| ステータス遷移 | `VALID_TRANSITIONS.published = []` — 公開を解除する正規ルートなし | 手動でreviewed_atをNULLに戻すしかない |

→ 要するに **DBとFTPの二重管理**が無監査で起きており、書き込み順と部分失敗に対する保険が無い。これが「スタック」の正体。

## 3. After（新設計）

### 3.1 UI（記事一覧ページ）

**変更**: 右端「確認」列のチェックボックスを撤去し、**ラベル付きピルボタン**に置換。

```
┌──────────────────────────┐
│  ● 公開中    │ 非公開化 ↓ │
└──────────────────────────┘
┌──────────────────────────┐
│  ○ 非公開    │ 公開する ↑ │
└──────────────────────────┘
```

状態: `公開中 / 非公開 / 更新中… / 失敗`（色＋アイコンで冗長表現、WCAG AA）

- **どちらの方向でも必ず確認モーダル**。非公開化モーダルは赤系の警告トーン（本番ハブに波及するため）。
- ヘッダに**一括公開/一括非公開**のアクションバー（最大50件 / N hub rebuild を1回に畳む）。
- フィルタタブは `確認: 全て/確認済み/未確認` → `公開状態: 全て/公開中/非公開` にリネームのみ（ロジック再利用）。
- モバイル: 44px タップ領域、長押しで複数選択。

### 3.2 DB スキーマ（追加）

```sql
-- 列追加（back-fill は既存の status='published' AND reviewed_at IS NOT NULL で算出）
ALTER TABLE articles
  ADD COLUMN is_hub_visible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN deployed_hash  TEXT,          -- 最終FTPアップロード時のHTML SHA-256
  ADD COLUMN visibility_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (visibility_state IN ('idle','deploying','live','live_hub_stale','unpublished','failed'));

-- 監査テーブル（article_revisions とは別系統。HTMLを書かないので revisions は消費しない）
CREATE TABLE publish_events (
  id           BIGSERIAL PRIMARY KEY,
  article_id   UUID NOT NULL REFERENCES articles(id),
  action       TEXT NOT NULL CHECK (action IN ('publish','unpublish','hub_rebuild','ripple_regen')),
  actor_id     UUID,
  actor_email  TEXT,
  request_id   TEXT,                       -- クライアント発行の ULID（冪等キー）
  hub_deploy_status TEXT,
  hub_deploy_error  TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**単一の真実**: 以後のハブ表示判定は `is_hub_visible = true` **1列のみ**（コード5箇所のWHEREをこれ1つに集約）。

### 3.3 API 契約

#### 単体トグル
```
POST /api/articles/{id}/visibility
Body: { visible: boolean, requestId: ULID, reason?: string }

200 OK            → 完了（DB + article FTP + hub FTP + ripple DB すべて成功）
207 Multi-Status  → 記事本体は成功、ハブが失敗（state='live_hub_stale'、UIに再デプロイCTA）
422 Unprocessable → 前提不備（status!='published' かつ visible=true を要求など）
502 Bad Gateway   → article FTP 失敗 → DB 完全ロールバック（revision 不要、publish_events に失敗記録）
```

#### 一括
```
POST /api/articles/visibility:bulk
Body: { ids: UUID[], visible: boolean, requestId: ULID }
```
N件の記事 FTP を順次アップロード後、**hub FTP は最後に1回だけ**・`updateAllRelatedArticles` も1回だけ。

#### 冪等性
- クライアント `requestId`（ULID）で同一リクエスト重複を短絡。
- サーバ側: `articles.deployed_hash` と生成後ハッシュを比較して等値ならFTPを飛ばす。

#### 原子性
- 記事ごとの **PG advisory lock** (`pg_try_advisory_xact_lock(article_id::bigint)`)。2ユーザー同時操作は片方 423 Locked。
- 状態機械: `idle → deploying → (live | live_hub_stale | failed)` → `idle` に戻るのは次操作開始時。
- プロセスクラッシュ検知: 次回呼び出し時に `visibility_state='deploying'` で 60s 以上経過した行を `failed` に矯正。

### 3.4 3段階デプロイゲートとの統合（採用: Option b）

| Gate | 現状の意味 | 新ボタン押下時の挙動 |
|---|---|---|
| Gate1 Published | `status='published'`（キュー処理で自動） | 前提条件として確認のみ（非達成なら 422） |
| Gate2 Reviewed | `reviewed_at NOT NULL`（手動） | **ボタンが自動セット** |
| Gate3 FTP Deployed | FTP 上に記事HTMLが載っている状態 | **ボタンが自動実行**（`uploadToFtp` + hub rebuild） |

Gate3 が失敗したら Gate2 もロールバック（`reviewed_at=null`）。「DB公開済なのにサイトに出ない」を構造的に不可能にする。

### 3.5 非公開化の物理挙動（採用: Option C — ソフト撤回）

`visible=false` 時:
1. `<slug>/index.html` を「非公開です」通知 + `<meta name="robots" content="noindex,noarchive">` で**上書き**（物理削除せず、可逆・SEO遮断）。
2. ハブから除外（`is_hub_visible=false`）+ ハブ再アップロード。
3. 他記事の関連ブロックから当該 slug を除去 → 下記 3.6 のリップル処理で該当 Y の HTML を順次再生成。

物理削除は別 UI「完全削除」として後日（本仕様では対象外）。

### 3.6 関連記事同期（ハイブリッド）

同期パート（ボタン押下内で完了、<12s 想定）:
- `articles.is_hub_visible` の反転
- `updateAllRelatedArticles()` による DB JSONB 全再計算
- ハブ HTML 再生成 & FTP アップロード

非同期パート（`POST /api/articles/ripple-regen` にジョブ投入、ポーリング）:
- 当該記事を related として持つ Y 群の HTML 再生成 + FTP アップロード
- Y ごとに `article_revisions` へ `change_type='ripple_related'` でスナップショット（HTML履歴ルール遵守）
- 保持ポリシー変更: `saveRevision` の 3行制限からの追い出し優先度を `ripple_related > manual` に（手動編集履歴を守る）

失敗は Y 単位でベストエフォート。Y3件失敗しても X の反転はロールバックしない（報告のみ）。

## 4. 実装手順（ユーザー承認後）

```
feat/publish-control-single-button ブランチ
 ├── step1: POST /api/articles/:id/visibility 追加（PUBLISH_CONTROL_V2=off では 404）
 ├── step2: マイグレーション: is_hub_visible / deployed_hash / visibility_state / publish_events
 │          back-fill: 既存の `status='published' AND reviewed_at IS NOT NULL` で is_hub_visible 初期化
 ├── step3: PublishButton コンポーネント（フラグ裏）
 ├── step4: シャドウテスト（staging Supabase、プロダクション FTP 非接続、onClick 実呼ばずログのみ）
 ├── step5: モンキーテスト（§5）
 ├── step6: 30分フリーズ窓で PUBLISH_CONTROL_V2=on。検証用記事1件で動作確認、
 │          既存45記事の updated_at がバイト同一であることを assert
 ├── step7: すべての公開経路（キュー処理、transition、バッチスクリプト群）が
 │          is_hub_visible=true を書くよう更新
 ├── step8: RLS 切り替えマイグレーション：
 │          `"Published articles are public"` の USING を
 │          `status='published'` → `is_hub_visible = true` に変更
 │          （step7 完了前に実行すると新規記事がサイレントに非公開化されるため順序厳守）
 └── step9: 14〜30日後、旧チェックボックスと関連フィルタコードを削除
```

各 step は env フラグ or 1PR revert で戻せる。

## 5. モンキーテスト（必須）

**フレームワーク**: Playwright（既設 `test/e2e/`）+ Vitest（純粋ロジック）。追加インストール不要。

**5層ロックアウト**（`beforeAll` 全通過しないと exit code 2）:
1. **専用 `harmony-dev` Supabase プロジェクト**。URLが本番と一致したら起動拒否。
2. **FTP モジュールをファイルシステムモックに module-alias**。本物は `DRY_RUN=true` でゲート。
3. **`monkey-` slug 名前空間**のみ操作。pre-flight で dev DB に非 `monkey-` 行が無いことを確認。
4. **Playwright ルートインターセプタ**が `harmony-mc.com` と本番 Supabase ホストへの通信を失敗させる。
5. **非 `monkey-` 行数の pre/post スナップショット**が差分1でもあればテスト失敗。

**シナリオ**（名前付き7 + ランダム200回、`MONKEY_SEED` で再現）:
- 下書きを visible=true → 422
- 公開済 → 非公開 → 他記事の関連ブロック伝播
- 人気記事の非公開化でリップル対象が5件以上あるケース
- 同一ボタン2連打 → 冪等（deploy は1回）
- 別記事の同時トグル → 両方成功
- トグル → 編集 → トグルで revision カウントが 1 しか増えないこと（リップル分は別）
- ハブFTPのみ失敗 → state='live_hub_stale' + 記事本体は生きている + UIに再デプロイCTA

**合格条件**: 全シナリオ green、非 `monkey-` 行数スナップショット完全一致、本番 FTP への送信試行 0 回。

## 6. 既存45記事の保護

### 6.1 CI ガード（最強・マージ前）
`.github/workflows/no-article-writes.yml`: staged diff を grep して、`.update(`・`.delete(`・`UPDATE articles`・`DELETE FROM articles` のうち `is_hub_visible` か `// guard-approved:` タグの無いものが1件でもあれば `exit 1`。

### 6.2 セッションガード（実行時・本セッション限定）
`.claude/session-guard.json` に `{"blockArticleWrites": true}` を置き、`src/lib/db/articles.ts::updateArticle` 冒頭でフラグが立っていれば throw。

### 6.3 FTP アサート
`uploadToFtp` に「リモートパスが `monkey-` で始まらない かつ `DRY_RUN !== true`」なら throw のガードを追加。

### 6.4 本番カットオーバー時のバイト同一検証
step6 直後、45記事の `updated_at` を事前スナップショットと比較し、1件でもズレたら即座にフラグをoff。

## 7. 主要設計決定の要約（承認ポイント）

| # | 決定事項 | 採用 | 主な対案 |
|---|---|---|---|
| D1 | UI 形状 | ラベル付きピルボタン | iOS風トグル / 単方向アクション |
| D2 | API 分割 | 単一 `:id/visibility` + 一括 `:bulk` | publish/unpublish 別エンドポイント |
| D3 | ゲート統合 | Option b（ボタンで Gate2+3 自動） | a: 前提必要 / c: ゲート独立 |
| D4 | 非公開化 | Option C（soft withdrawal + noindex） | A: DBフラグのみ / B: 物理削除 |
| D5 | 関連同期 | ハイブリッド（同期: X+ハブ, 非同期: Y HTML） | 全同期 / 全遅延 |
| D6 | 監査 | `publish_events` テーブル新設 | `article_revisions` 流用 |
| D7 | テスト | Playwright + 5層ロックアウト | 本番dry-run |

## 8. 未決事項（ユーザー確認希望）

1. **既存 `reviewed_at` 列は残すか削るか**: D3 採用なら `is_hub_visible` が新正本。`reviewed_at` は「由起子さん本人が確認した日時」の記録として意味が残るため**残す推奨**。ただし表示判定には使わない。
2. **一括操作の上限**: 50件で妥当か（ハブ再ビルドを1回に畳むとはいえ、50記事のFTPは連続処理で最大60s程度）。
3. **モンキーテストの CI 組み込み**: Playwright は現状 CI で走っていない。別ジョブとして追加するか、ローカル手動 only にするか。
4. **旧チェックボックス撤去タイミング**: 14日後 or 30日後。
