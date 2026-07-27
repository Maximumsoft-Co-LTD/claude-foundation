#!/usr/bin/env sh
# aggregate.sh — fold N scorecard rows into one median row per (task, arm).
#
# Input: a JSONL file (one scorecard object per line) as $1, or on stdin. Each
# row is emitted by run-bench.sh: {task, arm, ok, cost_usd, out_tokens, turns,
# duration_ms, spawn_count, cycles_test, cycles_review, judge_score, ...}.
#
# Output (default): a JSON array of aggregated rows (machine-readable; compare.sh
# consumes it). With --table: a human-readable table.
#
# Median is the summary stat because wall-clock / cost are noisy across live runs
# (dev-metrics.sh's own guidance: "take a median across runs"). Mechanism metrics
# (spawn_count, cycles) should already be stable; their median just confirms it.
#
# Usage:  sh aggregate.sh results/scorecards.jsonl [--table]

set -eu
command -v jq >/dev/null 2>&1 || { echo "aggregate: jq required" >&2; exit 2; }

file=""; table=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --table) table=1 ;;
    *) file="$1" ;;
  esac
  shift
done

read_input() { if [ -n "$file" ]; then cat "$file"; else cat; fi; }

agg="$(read_input | jq -s '
  def med(f): map(f) | map(select(. != null)) | sort
              | if length == 0 then null else .[((length - 1) / 2) | floor] end;
  map(select(type == "object"))
  | group_by([.task, .arm])
  | map({
      task:         .[0].task,
      arm:          .[0].arm,
      n:            length,
      ok_rate:      ((map(select(.ok == true)) | length) / length),
      cost_usd:     med(.cost_usd),
      out_tokens:   med(.out_tokens),
      turns:        med(.turns),
      duration_ms:  med(.duration_ms),
      wall_s:       med(.wall_s),
      spawn_count:  med(.spawn_count),
      cycles_test:  med(.cycles_test),
      cycles_review:med(.cycles_review),
      judge_score:  med(.judge_score)
    })
')"

if [ "$table" = "1" ]; then
  printf '%-24s %-9s %3s %5s %9s %7s %5s %5s %5s\n' task arm n okR costUSD wallSec turns spawn judge
  printf '%s' "$agg" | jq -r '.[] |
    [ .task, .arm, .n,
      (.ok_rate*100|floor|tostring + "%"),
      (.cost_usd // "-"|tostring),
      (.wall_s // "-"|tostring),
      (.turns // "-"|tostring),
      (.spawn_count // "-"|tostring),
      (.judge_score // "-"|tostring)
    ] | @tsv' \
    | while IFS="$(printf '\t')" read -r t a n ok c w tu s j; do
        printf '%-24s %-9s %3s %5s %9s %7s %5s %5s %5s\n' "$t" "$a" "$n" "$ok" "$c" "$w" "$tu" "$s" "$j"
      done
else
  printf '%s\n' "$agg"
fi
