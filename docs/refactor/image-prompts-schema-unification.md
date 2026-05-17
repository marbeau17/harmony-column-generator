# 画像プロンプト・スキーマ統合 / 旧形式廃止スケジュール

**作成日**: 2026-05-17
**位置付け**: P5-104 五重防御 (commit 94929a2) の中期 follow-up
**ステータス**: 設計案 (Planner)

## 1. 背景

AI 出力 `image_prompts` には **3 系統** のスキーマが歴史的経緯で並存している:

| 形式 | 出処 | フィールド | 用途 |
|:---|:---|:---|:---|
| A (canonical) | `src/lib/ai/prompts/image-prompt.ts` | `position` / `prompt` / `alt_text_ja` / `caption_ja` | source-base ライフサイクルの画像生成 prompt |
| B (legacy) | `src/lib/ai/prompts/stage1-outline.ts` | `section_id` / `prompt` / `heading_text` / `suggested_filename` | source-base Stage1 outline 出力 |
| C (zero-gen) | `src/lib/ai/prompts/stage1-zero-outline.ts` | `slot` / `prompt` | zero-generation Stage1 outline 出力 |

P5-104 で `src/lib/content/image-prompts-normalizer.ts` を設置し、3 形式すべてを canonical (A 相当: `{position, prompt, alt}`) に変換するレイヤを確立。route ハンドラ側は normalizer の出力のみ扱う。

ただし **AI prompt 側で 3 形式を発出し続ける限り、normalizer は橋渡しレイヤとして残り続ける**。長期的には A 形式に統合するのが正解。

## 2. 統合先 (canonical)

**A 形式 `{position, prompt, alt_text_ja}`** を canonical とする。理由:

- DB の `image_files` カラム / Storage パス / public URL がすべて `position` キーで参照済み
- normalizer の `NormalizedImagePrompt` 型もこの構造
- 1499 件の本番記事 (source-base 由来) の `image_prompts` JSONB が概ね A 形式

## 3. 廃止スケジュール (3 フェーズ)

### Phase 1: 観察 (2026-05-17 〜 2026-06-15) — 30 日

**目的**: 旧形式 (B/C) を発出している経路をテレメトリで定量化。

- normalizer 内で `slot` / `section_id` を検出した時に `logger.info('ai', 'image_prompt.legacy_schema', { kind: 'slot'|'section_id', ... })` を追加 (rate-limit 必須)
- Vercel ログで 30 日間の発火件数を集計
- 観察結果を `docs/feedback/eval_report.md` に追記

**実装担当**: 次サイクル Generator
**作業量**: normalizer 内に 1 箇所追加 + tests

### Phase 2: AI prompt 改修 (2026-06-16 〜 2026-07-15) — 30 日

**目的**: AI prompt 側の出力スキーマを A 形式に統一する。

- `src/lib/ai/prompts/stage1-outline.ts` の prompt 文言を書き換え:
  - `section_id` → `position`
  - `heading_text` → `alt_text_ja`
  - `suggested_filename` は撤去 (DB 側で `${position}.webp` 一意)
- `src/lib/ai/prompts/stage1-zero-outline.ts` の zod schema を更新:
  - `imagePromptSchema = z.object({ position: z.enum([...]), prompt, alt_text_ja? })`
  - prompt 文言を A 形式の例で書き換え
- `src/lib/zero-gen/run-completion.ts:95` の `normalizePromptsToArray` は撤去 (normalizer に統合済み)

**実装担当**: 次サイクル Generator
**作業量**: 3 prompt ファイル + 1 helper 撤去 + 既存テスト更新

### Phase 3: legacy field 完全除去 (2026-08-15 以降)

**目的**: normalizer から `section_id` / `slot` の受理を撤去し、A 形式のみ accept する状態にする。

**前提条件**:
- Phase 1 の `image_prompt.legacy_schema` ログが 7 日連続で 0 件
- DB 上の既存 `image_prompts` JSONB すべてが A 形式 (`section_id` / `slot` キー 0 件) であることを SQL で確認:
  ```sql
  SELECT count(*) FROM articles
  WHERE image_prompts::jsonb @? '$[*] ? (@.section_id != null || @.slot != null)';
  ```
- もし上記 SQL が > 0 を返す場合、in-place migration script で A 形式に変換してから実施

**実装担当**: 次次サイクル Generator
**作業量**: normalizer の `?? obj.section_id ?? obj.slot` 部分削除 + tests 更新 + コメントから legacy 記述削除

## 4. やらないこと (anti-scope)

- normalizer 自体の撤去はしない。canonical のみ受理になっても、AI 出力の post-validate / hard fail / silent skip 禁止という防御層は維持する (P5-104 の中核)
- `caption_ja` / `negative_prompt` / `aspect_ratio` (A 形式の optional 拡張) の扱いは本ドキュメントの対象外
- 既存記事 1499 件の DB マイグレーション自体は Phase 3 の前提条件として SQL 確認まで。実 migration は Phase 3 着手時に別チケット化

## 5. リスクと緩和

| リスク | 対応 |
|:---|:---|
| Phase 1 のログ rate-limit を漏らす → Vercel ログ溢れ | `logger` の rate-limit (`src/lib/log/rate-limit.ts`) を必ず経由、1 article あたり 1 件まで |
| Phase 2 で AI が新 prompt に従わず B/C を発出 | normalizer は throw するので queue が failed → UI 赤表示 (silent fail にならない、これが P5-104 の本質) |
| 1499 件中、stage1-outline 形式が予想より多い | Phase 3 直前で SQL 確認 → 必要なら migration script を 1 PR で実装 |

## 6. 関連

- P5-104 (commit 94929a2) — 五重防御の元実装
- `feedback_silent_failure_lessons.md` #6 — AI 出力スキーマ並存時の normalizer パターン
- `project_queue_visibility_and_image_guard.md` — 防御層 1〜5 の詳細
