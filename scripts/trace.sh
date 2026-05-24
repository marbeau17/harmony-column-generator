#!/usr/bin/env bash
# trace.sh — 公開・デプロイ一気通貫ジャーニーを trace_id で 1 列タイムラインに抽出
#
# Usage:
#   ./scripts/trace.sh <trace_id> [logfile]
#   ./scripts/trace.sh 01JCKZF2X9...                       # dev server stdout から
#   ./scripts/trace.sh 01JCKZF2X9... /tmp/next-dev.log     # 任意のログファイルから
#   tail -f /tmp/next-dev.log | ./scripts/trace.sh 01JCKZF2X9... -  # stdin pipe
#
# 仕組み:
#   - server 側 logger.ts は JSON 1 行を console.log/warn/error で出力する
#   - client 側 (PublishButton / handleBulkDeploy) は `[A0]`〜`[A8]` / `[B0]`〜`[B5]`
#     を console.log で出す。これは DevTools console に出るのでブラウザ側を別途確認。
#   - 同 trace_id を持つ全 server log を grep し、ts (timestamp) で sort して
#     プレフィックス `[A?]/[B?.*]` を見やすく抜き出す。
#
# 前提:
#   - jq が install 済 (brew install jq)
#   - server 側ログが stdout に JSON 1 行で出ている (logger.ts デフォルト)
#
# Tip:
#   bulk-deploy ジャーニーは bulk_trace_id を base に `<bulk>_<article8>` `<bulk>_hub`
#   と suffix が付くため、grep には base ID (= bulk_trace_id) だけ渡せば全部拾える。

set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat <<EOF
Usage: $0 <trace_id> [logfile|-]

  <trace_id>  ULID または vis_/deploy_/ftp_ 接頭辞の自動生成 ID
  [logfile]   読み取り対象。省略時は /tmp/next-dev.log を試行。
              '-' を渡すと stdin から読む (tail -f ... | $0 <id> - 用)

Examples:
  $0 01JCKZF2X9MQHV4WRT3P5DSXEA
  $0 vis_1716544123456_abcd1234 ~/Library/Logs/blogauto/dev.log
  tail -f /tmp/next-dev.log | $0 01JCKZF2X9... -
EOF
  exit 1
fi

TRACE_ID="$1"
LOGFILE="${2:-/tmp/next-dev.log}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found. Install with: brew install jq" >&2
  exit 1
fi

# stdin モード or ファイルモード
if [[ "$LOGFILE" == "-" ]]; then
  INPUT_CMD="cat"
elif [[ ! -f "$LOGFILE" ]]; then
  echo "Error: log file not found: $LOGFILE" >&2
  echo "Hint: redirect dev server stdout — e.g. 'npm run dev > /tmp/next-dev.log 2>&1'" >&2
  exit 1
else
  INPUT_CMD="cat $LOGFILE"
fi

# trace_id 一致行を timestamp 順に抽出 → action / request_id / details を整形
$INPUT_CMD \
  | grep -F "\"$TRACE_ID\"" \
  | while IFS= read -r line; do
      # JSON 行 (logger.ts 出力) と それ以外 ([A0] 等 raw console.log) を分岐
      if echo "$line" | jq -e . >/dev/null 2>&1; then
        echo "$line" | jq -r '
          [
            (.timestamp // "?"),
            (.level // "?")[0:1],
            (.action // "?"),
            ((.details // {} | to_entries
              | map(select(.key | IN("request_id","article_id","slug","elapsed_total_ms","elapsed_ms","http_status","final_state")))
              | map("\(.key)=\(.value)")
              | join(" ")) // "")
          ] | @tsv
        '
      else
        # 非 JSON 行 (handleBulkDeploy の console.error など)
        echo "raw $line"
      fi
    done \
  | sort -t$'\t' -k1,1 \
  | awk -F'\t' '{ printf "%-24s │ %s │ %-44s │ %s\n", $1, $2, $3, $4 }'

cat <<EOF >&2

---
ヒント:
  - 行が出ない → server がそもそも入口に到達していない可能性。dev server log を確認。
  - request_id だけ違って中身は同じなら、上流から trace_id ヘッダが落ちている。
  - [A6/skip] が出ているなら PUBLISH_CONTROL_FTP を 'on' に設定要。
  - bulk-deploy は <trace_id>_<article8> 接頭辞でも grep してみる。
EOF
