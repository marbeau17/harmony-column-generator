# Top 5 Critical Fixes — Harmony Column Generator

> 優先順位: 再発リスク × 影響範囲 × ROI で並べた **クリティカル修正5本**。実装は別タスクで切り出すこと。
> 出典: progress.md (P5-13〜P5-16)、既存 `docs/refactor/*.md`、article_revisions 規約。

---

## #1 HTML 操作を htmlparser2 / cheerio へ完全移行

### 問題ステートメント
記事 HTML の挿入・置換・除去が複数箇所で「正規表現 + 文字列 splice」で実装されており、CTA 重複・タグ閉じ忘れ・dangling DOM が再発している。P5-15 (バグG) で `<p>` 中の改行が `<br>` 化されない事象を再修正したが、根本原因は HTML を文字列として扱っていること。

### 根本原因
- P5-13 (Stage2 4形態正規化) で正規表現が複雑化し、エッジケースに対応しきれない。
- P5-15 (バグF) の CTA 二重挿入も、HTML 構造を解析せず Section ID マッチで挿入していたため。
- `src/lib/content/cta-injector.ts` 等で `String.replace` が温存されている。

### 修正方針
1. `htmlparser2` + `cheerio` を導入し、CTA 挿入・hero/body/summary 画像差し込み・noindex 切替をすべて DOM ノード操作に置換。
2. `article_revisions` への履歴 INSERT は変更前後の HTML を保持（既存規約を維持）。
3. 共通ヘルパ `src/lib/content/html-dom.ts` を新設し、文字列直接操作を ESLint ルールで禁止。

### 工数見積
**L** (5〜7人日 / 既存ユニット&E2E再合わせ含む)

### 期待効果
- 公開記事 1,499 件全体に影響する HTML 破損リスクを根絶。
- CTA 3回配置の保証ロジックがツリー単位で安全になる。
- 今後の新ブロック追加 (関連記事ウィジェット等) の実装コストが半減。

---

## #2 publish-control Step 4/5 完了 — reviewed_at audit-only 化と列削除

### 問題ステートメント
publish-control V2 の Step1〜8 は本番稼働済 (P0〜P4) だが、`reviewed_at` 列が "本番フラグ" と "監査ログ" の二役を担っており、UIと cron で参照箇所が分散している。Step9 の自動PR routine も未稼働。

### 根本原因
- `project_publish_control_v2.md` 記載の通り、Step 4/5 (audit-only 化 + 列削除) が未実施。
- `reviewed_at` を真偽判定に使う関数が `src/lib/db/articles.ts` と `scripts/` 系に複数残存。

### 修正方針
1. 新カラム `audit_reviewed_at`(timestamptz, audit only) を追加し、本番判定は `published_status` enum に一本化。
2. 既存参照を grep で全置換 → RLS ポリシも更新。
3. マイグレーション完了後、`reviewed_at` を DROP COLUMN。
4. Step9 の routine `trig_01YMtfRoZmA61aChNmhtRB2r` を 2026-05-09 に予定通り起動。

### 工数見積
**M** (3人日 / マイグレ + 影響範囲テスト)

### 期待効果
- 公開判定のシングルソース化により、誤公開・二重公開の再発を防止。
- 監査要件 (由起子さん FB対応の追跡) と公開判定が分離され、運用ミスが減る。

---

## #3 本番 article health daily check の常駐化

### 問題ステートメント
`docs/refactor/article-health-monitor.md` (P12) で設計済の health check が手動実行のみで、dangling 画像・CTA 欠落・noindex 漏れ・空 body の検知が遅延する。P5-15 (バグE 空 body) は本番で見つかるまで気付けなかった。

### 根本原因
- cron / Vercel Scheduled Function 化が未着手。
- アラート通知も Slack webhook に未連携。

### 修正方針
1. Vercel Cron (`/api/cron/article-health`) を 06:00 JST 起動で配置。
2. チェック項目: ① body 空/極端短文 ② CTA 出現3回 ③ hero画像 200応答 ④ noindex 整合 ⑤ article_revisions 最新がHTML一致。
3. 失敗時は Slack `#harmony-alerts` に Markdown サマリ投稿、再発1件目で人間介入要請。
4. 履歴は `article_health_logs` テーブルに 30 日保持。

### 工数見積
**S** (1.5人日 / 既存設計流用)

### 期待効果
- 1,499 件規模の崩壊を「自動検知 → 翌朝対応」のループに乗せる。
- 由起子さん FB の "深い納得" 品質を維持するゲートが本番に常設される。

---

## #4 silent failure を ESLint で機械的に禁止

### 問題ステートメント
P5-15 のバグE/F/G はいずれも `try { ... } catch { /* ignore */ }` 系の "握り潰し" が原因で発覚が遅れた。記憶ベースのレビューに頼ると再発する。

### 根本原因
- `no-empty` / `no-unused-vars` は有効だが、`catch (e) { console.warn(e) }` のような「ログだけして上に伝播しない」パターンを止められていない。
- AI 生成コードに silent fallback が紛れ込みやすい。

### 修正方針
1. `eslint-plugin-promise` + 自作ルール `no-silent-catch` を導入し、catch 句で `throw` か明示的な `logger.error + return Result.err` 以外を禁止。
2. `Result<T, E>` 型を `src/lib/result.ts` に追加し、AI ジョブ系 (`src/lib/ai/`) を段階的に移行。
3. pre-commit フックで強制実行 (グローバル §2 フック駆動開発に準拠)。

### 工数見積
**M** (2.5人日 / ルール作成 + 既存違反の修復含む)

### 期待効果
- 今後発生しうる "見えないバグ" の早期顕在化。
- AI 生成・人手修正の双方に効くガードレール。

---

## #5 AI 出力に schema validation 必須化

### 問題ステートメント
Gemini Pro 3.1 の出力 (記事本文・キーワード提案・トーン正規化) を `JSON.parse` 直後にそのまま DB 保存しており、P5-13 (バグD: Stage2 4形態正規化) と P5-16 (キーワード提案) のいずれでも形式崩れがランタイム例外を引き起こした。

### 根本原因
- `src/lib/ai/prompts/*` の応答仕様がプロンプト側にしかなく、コード側に契約 (schema) が無い。
- LLM の確率的振る舞いに対して構造保証が無い。

### 修正方針
1. `zod` で各 AI 出力の schema を定義 (`src/lib/ai/schemas/*.ts`)。
2. 全 AI 呼び出しを `parseStrict` で包み、失敗時はリトライ (最大 2 回) → それでも失敗なら `Result.err` で握らず明示的に上流へ。
3. Gemini の `responseMimeType: application/json` + `responseSchema` を併用しモデル側でも矯正。
4. ハルシネ検出 (P5-7) と統合し、schema違反 = ハルシネ扱いで再生成。

### 工数見積
**M** (3人日 / 全 AI 呼び出し点 ~12箇所)

### 期待効果
- AI 起因のデータ汚染 (1,499件規模) を入口で遮断。
- バグD 再発リスクをゼロに近づけ、新規 AI 機能追加時の安全網になる。

---

## 優先順位サマリ

| # | Fix | 工数 | 再発リスク | 影響範囲 | ROI |
|---|---|:---:|:---:|:---:|:---:|
| 1 | HTML を cheerio へ移行 | L | 高 | 1,499件全体 | ★★★★★ |
| 2 | publish-control Step4/5 | M | 中 | 公開判定全体 | ★★★★☆ |
| 3 | article health daily check | S | 高 | 1,499件全体 | ★★★★★ |
| 4 | silent failure 禁止 | M | 高 | コード全体 | ★★★★☆ |
| 5 | AI 出力 schema 必須化 | M | 高 | AI 系全体 | ★★★★☆ |

> 推奨順: **#3 (S) → #4 → #5 → #2 → #1** (S/M を先に積み、L #1 はリリース計画と並走)。
