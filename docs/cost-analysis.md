# Zero-Generation V1 コスト分析

**Date:** 2026-04-30
**Author:** PM/Analyst

## 1. Gemini Pro 3.1 単価（2026 年 4 月時点）
- 入力: $1.25 / 1M tokens
- 出力: $5.00 / 1M tokens
- text-embedding-004: $0.025 / 1M tokens
- Vision (gemini-2.5-flash): 入力 $0.075 / 出力 $0.30 / 1M tokens
- Context Cache (1h TTL): 入力課金 25% に削減

## 2. 1 記事生成の試算

### 2.1 LLM 呼出内訳（spec §3 パイプライン）
| Stage | 入力 tokens | 出力 tokens | 課金額 (cache hit 後) |
|---|---|---|---|
| Stage1 outline | 4,000 (cached) + 500 | 1,500 | $0.0028 |
| Stage2 writing | 4,000 (cached) + 1,500 | 4,000 | $0.024 |
| Proofreading | 4,000 (cached) + 4,000 | 2,000 | $0.012 |
| QualityCheck | 4,000 (cached) + 4,000 | 1,500 | $0.010 |
| Claim抽出 | 1,000 + 4,000 | 1,500 | $0.013 |
| Hallucination factual | 1,000 + 500 | 800 | $0.006 |
| Hallucination attribution | 500 | 500 | $0.003 |
| Hallucination spiritual | 500 | 200 | $0.002 |
| Hallucination logical | 1,000 + 1,000 | 800 | $0.007 |
| **テキスト合計** | **+** | **+** | **~$0.080** |

### 2.2 画像生成（Banana Pro × 3）
| 画像 | 推定 |
|---|---|
| Hero (16:9) | $0.030 |
| Body (1:1) | $0.030 |
| Summary (1:1) | $0.030 |
| **画像合計** | **$0.090** |

### 2.3 Vision 検査（任意）
| Stage | 課金額 |
|---|---|
| 画像 3 枚 × Vision | ~$0.005 |

### 2.4 Embedding（記事内容 + claim 検証）
| Stage | 課金額 |
|---|---|
| 記事 embedding | < $0.001 |
| Claim x retrieve | $0.003 |

### 2.5 1 記事合計
**~$0.18 / 記事**（Vision 含む / cache hit 想定）

cache miss 初回生成: 約 $0.30

## 3. 月次試算

| シナリオ | 月間記事数 | 月額 |
|---|---|---|
| 軽運用 | 30 | $5.4 |
| 標準 | 100 | $18 |
| 大量 | 300 | $54 |

## 4. 1499 source 記事 embedding（初回）
- 平均 chunk 数 3 / 記事 → ~5,000 chunks
- 平均 token 350 / chunk → 1.75M tokens
- text-embedding-004 単価 $0.025 / 1M = **~$0.05**
- 月次再 embed（差分のみ）: $0.001 程度

## 5. 推奨段階展開
1. **Phase 1**: テスト記事 1 件生成、コスト実測（K3 dry-run の結果から精緻化）
2. **Phase 2**: 月 30 記事ペース、本番運用、月額 ~$5 を確認
3. **Phase 3**: Phase 2 で 14 日経過後、月 100+ 記事も検討

## 6. アラート閾値
- Gemini API 月額が想定の 2x を超えた場合は要調査
- 特定記事で 10 LLM 呼出 / 失敗を超えたら quota スロットリング検討
