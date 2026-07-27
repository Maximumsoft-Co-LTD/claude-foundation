#!/usr/bin/env sh
# compare.sh — turn scorecards into a verdict. Deterministic (reads stored JSON),
# so its logic is unit-tested (tests/run-bench-tests.sh) without spending tokens.
#
# Two modes:
#
#   --ratchet <baseline.jsonl> <current.jsonl>
#     Before/after regression guard on the WORKFLOW arm. For each task, current
#     must not regress vs the committed baseline:
#       - spawn_count / cycles must NOT increase   (mechanism — deterministic)
#       - cost_usd must be within +TOL of baseline (BENCH_COST_TOL, default 0.20)
#       - judge_score must NOT drop
#     duration is reported but advisory (noisy). Exit 1 if any task regresses.
#
#   --ab <scorecards.jsonl>
#     "Is the machinery worth it?" Per task, compare arm=workflow vs arm=baseline
#     (plain prompt, no /dev). Reports the cost premium and quality delta and a
#     heuristic verdict (worth-it when workflow quality is higher, or equal
#     quality at no higher cost). Report-only — always exit 0.
#
# Usage:  sh compare.sh --ratchet baselines/x.jsonl results/x.jsonl
#         sh compare.sh --ab results/scorecards.jsonl

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
AGG="$HERE/aggregate.sh"
command -v jq >/dev/null 2>&1 || { echo "compare: jq required" >&2; exit 2; }
TOL="${BENCH_COST_TOL:-0.20}"

mode="${1:-}"; shift 2>/dev/null || true

case "$mode" in
  --ratchet)
    base="${1:?usage: compare.sh --ratchet <baseline> <current>}"
    cur="${2:?usage: compare.sh --ratchet <baseline> <current>}"
    ab="$(sh "$AGG" "$base")"
    ac="$(sh "$AGG" "$cur")"
    result="$(jq -n --argjson base "$ab" --argjson cur "$ac" --arg tol "$TOL" '
      ($tol | tonumber) as $t
      | ($base | map(select(.arm == "workflow")) | INDEX(.task)) as $B
      | ($cur  | map(select(.arm == "workflow")))
      | map(
          . as $r | $B[$r.task] as $b
          | if $b == null then {task: $r.task, verdict: "new (no baseline)", fail: false, fails: []}
            else
              ([
                (if ($r.spawn_count // 0)  > ($b.spawn_count // 0)  then "spawn_count \($b.spawn_count)->\($r.spawn_count)" else empty end),
                (if ($r.cycles_test // 0)  > ($b.cycles_test // 0)  then "cycles.test \($b.cycles_test)->\($r.cycles_test)" else empty end),
                (if ($r.cycles_review // 0)> ($b.cycles_review // 0)then "cycles.review \($b.cycles_review)->\($r.cycles_review)" else empty end),
                (if ($r.cost_usd // 0)     > (($b.cost_usd // 0) * (1 + $t)) then "cost \($b.cost_usd)->\($r.cost_usd) (>\(($t*100)|floor)%)" else empty end),
                (if ($r.judge_score // 0)  < ($b.judge_score // 0)  then "quality \($b.judge_score)->\($r.judge_score)" else empty end)
              ]) as $fails
              | {task: $r.task, fails: $fails, fail: (($fails | length) > 0),
                 cost: {base: $b.cost_usd, cur: $r.cost_usd},
                 dur:  {base: $b.duration_ms, cur: $r.duration_ms}}
            end
        )
    ')"
    echo "ratchet (workflow arm, cost tolerance +$(printf '%.0f' "$(echo "$TOL*100" | bc 2>/dev/null || echo 20)")%)"
    printf '%s' "$result" | jq -r '.[] |
      if .fail then "  ✗ \(.task): " + (.fails | join("; "))
      elif .verdict then "  • \(.task): \(.verdict)"
      else "  ✓ \(.task): within budget (cost \(.cost.base // "-")→\(.cost.cur // "-"), dur \(.dur.base // "-")→\(.dur.cur // "-")ms)" end'
    if printf '%s' "$result" | jq -e 'any(.fail)' >/dev/null; then
      echo "ratchet: FAIL — a task regressed" >&2; exit 1
    else
      echo "ratchet: PASS"; exit 0
    fi
    ;;

  --ab)
    file="${1:?usage: compare.sh --ab <scorecards>}"
    agg="$(sh "$AGG" "$file")"
    echo "A/B — workflow (/dev) vs baseline (plain prompt)"
    printf '%s' "$agg" | jq -r '
      group_by(.task) | map({
        task: .[0].task,
        wf:   (map(select(.arm == "workflow")) | .[0]),
        bl:   (map(select(.arm == "baseline")) | .[0])
      })
      | .[]
      | if (.wf == null or .bl == null) then "  • \(.task): missing an arm (need both workflow + baseline)"
        else
          (.wf.cost_usd // 0) as $cw | (.bl.cost_usd // 0) as $cb
          | (.wf.judge_score // 0) as $jw | (.bl.judge_score // 0) as $jb
          | (if $jw > $jb then "worth-it (higher quality)"
             elif ($jw == $jb and $cw <= $cb) then "worth-it (equal quality, no cost premium)"
             else "questionable (quality \($jw) vs \($jb), cost \($cw) vs \($cb))" end) as $v
          | "  • \(.task): \($v)\n      cost: wf \($cw) / bl \($cb)   quality: wf \($jw) / bl \($jb)   spawns(wf): \(.wf.spawn_count // "-")"
        end'
    exit 0
    ;;

  *)
    echo "usage: compare.sh --ratchet <baseline> <current> | --ab <scorecards>" >&2
    exit 2
    ;;
esac
