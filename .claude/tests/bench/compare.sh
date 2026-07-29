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
#   --gain <baseline.jsonl> <current.jsonl> [--target <fraction>]
#     The ratchet's mirror image. --ratchet asks "did we get worse?"; --gain asks
#     "did we get better, by how much, and did quality survive it?" — the question
#     an optimisation pass is actually trying to answer, and one a pass/fail
#     regression guard cannot express (staying inside +20% is not a win).
#     Reports per-task and suite-total cost/wall deltas against the baseline.
#     `--target 0.5` asserts BOTH cost and wall dropped >= 50%.
#     A quality drop fails outright at any saving: cheaper-but-worse is not a gain,
#     the same ordering --ratchet and --ab already enforce. A task with no usable
#     row on either side (n_ok == 0) fails too when a target is set — an unmeasured
#     task cannot be claimed as a win.
#
#   --mechanism <baseline.jsonl> <current.jsonl>
#     The FAST check. Compares only the deterministic fields — spawn_count and the
#     two cycle counters — and ignores cost, wall and judge entirely. Those three
#     are what a structural change actually moves, and unlike cost/quality they do
#     not need repeats to be trusted (README: "Mechanism metrics are DETERMINISTIC
#     — the primary proof a change worked"). So this runs meaningfully at
#     `--repeats 1`: one run per task, ~5 minutes, and it catches the shape
#     regressions (a spawn that came back, a review cycle that started firing)
#     that would otherwise cost a full 6-run median cycle to see. Use it to
#     iterate; use --gain/--ratchet to decide.
#
# Usage:  sh compare.sh --ratchet baselines/x.jsonl results/x.jsonl
#         sh compare.sh --ab results/scorecards.jsonl
#         sh compare.sh --gain baselines/x.jsonl results/x.jsonl --target 0.5

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
AGG="$HERE/aggregate.sh"
command -v jq >/dev/null 2>&1 || { echo "compare: jq required" >&2; exit 2; }
TOL="${BENCH_COST_TOL:-0.20}"

# --- resolution floor -----------------------------------------------------------
# This suite's cost spread is wide enough that most "wins" are noise: on
# 11-recent-window, sd is ~$0.7 on a ~$2.7 mean, so at n=6 the smallest honestly
# detectable difference is roughly 25%. Three separate verdicts in one session were
# reported at -6.5%, -13% and -15%, adopted, and then failed to reproduce; a fourth
# read -29% at n=6 and -20% at n=12. Reporting a delta smaller than the measurement
# can resolve is how that happens, so the comparison now refuses to.
#
# MDE = 2 * sqrt(se_base^2 + se_cur^2) expressed as a % of the baseline, where
# se = sd/sqrt(n) — the ordinary two-sample standard error at ~95%. A |delta|
# under it prints UNRESOLVED and counts as NO CHANGE: not a win, not a regression.
# Override with BENCH_MDE_OFF=1 only to inspect raw numbers, never to decide.
MIN_N="${BENCH_MIN_N:-6}"
MDE_OFF="${BENCH_MDE_OFF:-0}"

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
                 dur:  {base: $b.wall_s, cur: $r.wall_s}}
            end
        )
    ')"
    echo "ratchet (workflow arm, cost tolerance +$(printf '%.0f' "$(echo "$TOL*100" | bc 2>/dev/null || echo 20)")%)"
    printf '%s' "$result" | jq -r '.[] |
      if .fail then "  ✗ \(.task): " + (.fails | join("; "))
      elif .verdict then "  • \(.task): \(.verdict)"
      else "  ✓ \(.task): within budget (cost \(.cost.base // "-")→\(.cost.cur // "-"), wall \(.dur.base // "-")→\(.dur.cur // "-")s)" end'
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
          | "  • \(.task): \($v)\n      cost: wf \($cw) / bl \($cb)   wall(s): wf \(.wf.wall_s // "-") / bl \(.bl.wall_s // "-")   quality: wf \($jw) / bl \($jb)"
        end'
    exit 0
    ;;

  --mde)
    # Standalone: what can this scorecard actually resolve, and how many repeats
    # would a given effect need? Answer BEFORE spending a run, not after.
    f="${1:?usage: compare.sh --mde <scorecards.jsonl> [effect-pct]}"
    want="${2:-20}"
    sh "$AGG" "$f" | jq -r --arg want "$want" --arg minn "$MIN_N" '
      .[] | select(.arm == "workflow") | select(.n_ok > 1)
      | (.cost_sd / (.n_ok | sqrt)) as $se
      | (2 * $se * 1.4142 / .cost_usd * 100) as $mde
      | ((2 * 1.4142 * .cost_sd / (.cost_usd * ($want|tonumber) / 100)) | . * . | ceil) as $need
      | "\(.task): n=\(.n_ok)  sd=$\(.cost_sd*100|round/100)  median=$\(.cost_usd*100|round/100)",
        "   smallest resolvable effect at this n:  \($mde*10|round/10)%",
        "   repeats needed to resolve \($want)%:      n=\($need) per side",
        (if .n_ok < ($minn|tonumber) then "   ⚠ UNDERPOWERED — below BENCH_MIN_N=\($minn); treat any delta as unmeasured" else empty end)
    '
    exit 0
    ;;
  --gain)
    base="${1:?usage: compare.sh --gain <baseline> <current> [--target <fraction>]}"
    cur="${2:?usage: compare.sh --gain <baseline> <current> [--target <fraction>]}"
    shift 2 2>/dev/null || true
    target=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --target) target="${2:?--target needs a fraction, e.g. 0.5}"; shift ;;
        *) echo "compare --gain: unknown arg: $1" >&2; exit 2 ;;
      esac
      shift
    done
    ab="$(sh "$AGG" "$base")"
    ac="$(sh "$AGG" "$cur")"
    result="$(jq -n --argjson base "$ab" --argjson cur "$ac" --arg target "$target" --argjson MINN "$MIN_N" --arg MDEOFF "$MDE_OFF" '
      (if $target == "" then null else ($target | tonumber) end) as $T
      | ($base | map(select(.arm == "workflow")) | INDEX(.task)) as $B
      | ($cur  | map(select(.arm == "workflow")))
      | map(
          . as $r | $B[$r.task] as $b
          | if $b == null then {task: $r.task, status: "new", counted: false, fail: false}
            # An unmeasured side is not a saving. Reporting a delta off a null
            # would print "-100%" for a task that simply never produced a row.
            elif ($b.n_ok == 0 or $r.n_ok == 0 or $b.cost_usd == null or $r.cost_usd == null)
              then {task: $r.task, status: "unmeasured", counted: false, fail: ($T != null),
                    detail: "n_ok base=\($b.n_ok) cur=\($r.n_ok)"}
            else
              (1 - ($r.cost_usd / $b.cost_usd)) as $dc
              | (if ($b.wall_s // 0) > 0 and $r.wall_s != null
                 then (1 - ($r.wall_s / $b.wall_s)) else null end) as $dw
              | (($r.judge_score // 0) < ($b.judge_score // 0)) as $qdrop
              # Resolution floor: a cost delta smaller than this measurement can
              # separate from noise is NOT a saving. Two-sample SE at ~95%.
              | (if ($b.cost_sd != null and $r.cost_sd != null and $b.n_ok > 1 and $r.n_ok > 1 and $b.cost_usd > 0)
                 then (2 * (((($b.cost_sd / ($b.n_ok|sqrt)) | . * .) + (($r.cost_sd / ($r.n_ok|sqrt)) | . * .)) | sqrt) / $b.cost_usd)
                 else null end) as $mde
              | (($mde != null) and (($dc | fabs) < $mde) and ($MDEOFF != "1")) as $unres
              | (($b.n_ok < $MINN) or ($r.n_ok < $MINN)) as $under
              | {task: $r.task, status: (if $unres then "unresolved" else "measured" end),
                 counted: true, mde: $mde, unresolved: $unres, underpowered: $under,
                 cost: {base: $b.cost_usd, cur: $r.cost_usd, drop: $dc},
                 wall: {base: $b.wall_s, cur: $r.wall_s, drop: $dw},
                 judge: {base: $b.judge_score, cur: $r.judge_score, drop: $qdrop},
                 # An unresolved cost delta can never satisfy a target — claiming a
                 # win off noise is the exact failure this guard exists to stop.
                 fail: ($qdrop or ($T != null and ($unres or $dc < $T or ($dw == null or $dw < $T)))) }
            end
        )
      | . as $rows
      | ($rows | map(select(.counted))) as $m
      | {rows: $rows,
         suite: (if ($m | length) == 0 then null else
           ($m | map(.cost.base) | add) as $cb | ($m | map(.cost.cur) | add) as $cc
           | ($m | map(.wall.base // 0) | add) as $wb | ($m | map(.wall.cur // 0) | add) as $wc
           | {cost: {base: $cb, cur: $cc, drop: (if $cb > 0 then (1 - ($cc / $cb)) else null end)},
              wall: {base: $wb, cur: $wc, drop: (if $wb > 0 then (1 - ($wc / $wb)) else null end)}}
           end),
         target: $T,
         fail: ($rows | any(.fail))}
    ')"
    if [ -n "$target" ]; then
      echo "gain (workflow arm, target −$(printf '%.0f' "$(echo "$target*100" | bc 2>/dev/null || echo 50)")% on BOTH cost and wall; quality must not drop)"
    else
      echo "gain (workflow arm, no target — deltas reported; quality must still not drop)"
    fi
    printf '%s' "$result" | jq -r '
      # Sign it here, not at the call site: a NEGATIVE drop is an increase, and a
      # hardcoded "−" prefix rendered it as "−-1.5%".
      def pct($x): if $x == null then "n/a"
                   else ((($x * 1000) | round) / 10) as $p
                        | (if $p >= 0 then "−" else "+" end) + (($p | fabs | tostring) + "%") end;
      .rows[] |
      if .status == "new" then "  • \(.task): new (no baseline) — not counted"
      elif .status == "unmeasured" then "  ✗ \(.task): no usable rows to compare (\(.detail))"
      else "  \(if .fail then "✗" else "✓" end) \(.task): "
           + (if .unresolved then "UNRESOLVED  |Δcost| < MDE \((.mde*1000|round/10))% — not a saving, not a regression; raise n\n      " else "" end)
           + (if .underpowered then "⚠ underpowered — below the min-n guard; read as unmeasured\n      " else "" end)
           + "cost \(.cost.base)→\(.cost.cur) (\(pct(.cost.drop)))  "
           + "wall \(.wall.base // "-")→\(.wall.cur // "-")s (\(pct(.wall.drop)))  "
           + "judge \(.judge.base // "-")→\(.judge.cur // "-")"
           + (if .judge.drop then "  ← quality regressed; a cheaper worse run is not a gain" else "" end)
      end'
    printf '%s' "$result" | jq -r '
      # Sign it here, not at the call site: a NEGATIVE drop is an increase, and a
      # hardcoded "−" prefix rendered it as "−-1.5%".
      def pct($x): if $x == null then "n/a"
                   else ((($x * 1000) | round) / 10) as $p
                        | (if $p >= 0 then "−" else "+" end) + (($p | fabs | tostring) + "%") end;
      if .suite == null then "  suite: nothing comparable" else
      "  suite total: cost \(.suite.cost.base)→\(.suite.cost.cur) (\(pct(.suite.cost.drop)))  "
      + "wall \(.suite.wall.base)→\(.suite.wall.cur)s (\(pct(.suite.wall.drop)))" end'
    if printf '%s' "$result" | jq -e '.fail' >/dev/null; then
      echo "gain: FAIL — target not met or quality regressed" >&2; exit 1
    else
      echo "gain: PASS"; exit 0
    fi
    ;;

  --mechanism)
    base="${1:?usage: compare.sh --mechanism <baseline> <current>}"
    cur="${2:?usage: compare.sh --mechanism <baseline> <current>}"
    ab="$(sh "$AGG" "$base")"
    ac="$(sh "$AGG" "$cur")"
    result="$(jq -n --argjson base "$ab" --argjson cur "$ac" '
      ($base | map(select(.arm == "workflow")) | INDEX(.task)) as $B
      | ($cur  | map(select(.arm == "workflow")))
      | map(
          . as $r | $B[$r.task] as $b
          | if $b == null then {task: $r.task, status: "new", fail: false}
            elif $r.n_ok == 0 then {task: $r.task, status: "unmeasured", fail: true}
            else
              ([ {k: "spawn_count",   b: ($b.spawn_count   // 0), c: ($r.spawn_count   // 0)},
                 {k: "cycles_test",   b: ($b.cycles_test   // 0), c: ($r.cycles_test   // 0)},
                 {k: "cycles_review", b: ($b.cycles_review // 0), c: ($r.cycles_review // 0)} ]) as $f
              | {task: $r.task, status: "measured",
                 rose:  ($f | map(select(.c > .b)) | map("\(.k) \(.b)->\(.c)")),
                 fell:  ($f | map(select(.c < .b)) | map("\(.k) \(.b)->\(.c)")),
                 fail:  (($f | map(select(.c > .b)) | length) > 0)}
            end
        )
      | {rows: ., fail: (map(.fail) | any)}
    ')"
    echo "mechanism (workflow arm — deterministic fields only; no medians needed)"
    printf '%s' "$result" | jq -r '.rows[] |
      if .status == "new" then "  • \(.task): new (no baseline)"
      elif .status == "unmeasured" then "  ✗ \(.task): no usable row"
      elif .fail then "  ✗ \(.task): " + (.rose | join("; "))
      elif (.fell | length) > 0 then "  ✓ \(.task): improved — " + (.fell | join("; "))
      else "  ✓ \(.task): unchanged" end'
    if printf '%s' "$result" | jq -e '.fail' >/dev/null; then
      echo "mechanism: FAIL — machinery grew" >&2; exit 1
    else
      echo "mechanism: PASS"; exit 0
    fi
    ;;

  *)
    echo "usage: compare.sh --ratchet <baseline> <current> | --ab <scorecards> | --gain <baseline> <current> [--target <f>] | --mechanism <baseline> <current>" >&2
    exit 2
    ;;
esac
