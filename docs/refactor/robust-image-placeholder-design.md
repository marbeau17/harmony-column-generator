# 画像プレースホルダー → 画像 HTML 変換の堅牢化設計

> 目的: AI 生成記事中の画像プレースホルダーを **100% 確実に** `<img>` HTML へ変換する。
> スコープ: 設計検討のみ。実装は別 PR。

## 1. 現状の問題

- **形式ブレ**: AI (Gemini Pro 3.1) が prompt に従わず、`{{IMAGE_HERO}}` / `[IMAGE: hero]` / `<!-- IMAGE hero -->` 等の placeholder 形式が記事ごとにブレる。
- **2-Phase 置換の脆さ**: `replaceImagePlaceholders` は Phase 1 (位置情報あり: H2 直後など) で取りこぼすと Phase 2 (位置情報なし: 末尾追記) にフォールバックする。
- **Phase 2 fallback 暴走 (W5 バグ)**: Phase 2 の regex が広範囲にマッチすると本文ブロックを `<img>` で置換してしまい、本文が消える事故が発生 (P5 系で観測)。
- **結果**: 画像が本文中に挿入されない / 本文消失 / hero しか出ない、等の不整合が記事ごとにランダム発生。decisive な検証が困難。

## 2. 設計案 3 通り

### 案 A: AI が完成済 `<img>` タグを直接出力 (URL は後置換)

- AI prompt で `<img src="__HERO_URL__" alt="...">` のような **タグ完成形** を出力させる。
- 後処理は `__HERO_URL__` → 実 URL の純粋な文字列置換のみ。
- 利点: regex フォールバック不要、本文消失リスクほぼゼロ。
- 欠点: AI が `<img>` タグ自体を壊す (alt 属性欠落、自己終了タグ崩れ) 可能性あり。HTML サニタイズが必要。

### 案 B: Stage1 outline で画像位置を構造化フィールドで明示

- Stage1 (構成 JSON) の各 H2 章に `image_slot: "hero" | "body" | null` を必須フィールドで持たせる。
- Stage2 (本文生成) では本文中に placeholder を埋めず、**プレーンな markdown/HTML のみ** を生成。
- 後処理で Stage1 の `image_slot` を見て該当 H2 直後に `<img>` を挿入する (本文の解析は H2 単位のみで完結)。
- 利点: AI に placeholder 整形を任せない。位置情報が構造化されているので regex 不要。
- 欠点: Stage1/Stage2 間のスキーマ整合性が必須。既存パイプラインの大改修。

### 案 C: 現状維持 + 堅牢化 (3-tier fallback + 取りこぼしログ)

- 既存の 2-Phase 置換に **Tier 3 (LLM 再問合せ)** を追加し、未消化 placeholder を AI に再修正させる。
- 各 Tier で取りこぼし数を構造化ログ (`logger.warn({ tier, leftover, articleId })`) に出して監視。
- Phase 2 の regex は **最大 1 行** までしかマッチしないよう厳格化し W5 暴走を防ぐ。
- 利点: 既存実装を壊さない、段階導入可能。
- 欠点: 根本原因 (AI 出力ブレ) は残る。Tier 3 で API コスト増。

## 3. 推奨案

**案 B を本筋、案 C を当面の保険として併用** する。
理由:
- 案 A は HTML 完成形を AI に任せる時点で `<img>` 構文崩れの新リスクが発生し、現状の placeholder ブレ問題と本質が変わらない。
- 案 B は Stage1 の構造化 JSON という既に AI 制御が効いている層に責務を寄せる設計で、本文生成の自由度を保ちつつ画像配置を決定論にできる。
- 案 C を Tier 3 ログ + Phase 2 厳格化だけ先行実装すれば、案 B 完成までの 32 既存記事の運用リスクを下げられる。

## 4. Migration Plan

### 既存 32 記事
- **触らない** (memory rule: 明示指示なき本文/タイトル/コンテキスト変更禁止)。
- 既存記事は現行の placeholder 置換結果のままアーカイブ扱い。
- 案 C の Phase 2 厳格化は既存記事の再生成を伴わない (置換ロジック変更のみ、HTML は既に確定済みなので影響なし)。

### 今後の新規記事
- 案 B のスキーマ拡張 (Stage1 outline に `image_slot`) は新規生成パイプラインのみに適用。
- DB スキーマ変更は不要 (`articles.html_content` の最終形は同じ)。
- ロールバック容易性: フィーチャーフラグ `USE_IMAGE_SLOT_V2` で新旧切替可能にする。
- 段階展開: dev → staging で 5 記事生成検証 → 本番 1 記事 → 全面移行。

### 実装順序 (別 PR で起票)
1. 案 C の Tier 3 ログ + Phase 2 regex 厳格化 (短期、低リスク)。
2. 案 B の Stage1 schema 拡張 + Stage2 prompt 改訂 (中期、フラグ付き)。
3. 案 B 安定後、案 C Tier 3 を撤去 (長期)。
