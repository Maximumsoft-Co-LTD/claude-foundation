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

# --- the context axis in a verdict ----------------------------------------------
# Two context numbers gate, and they need different tolerances because they have
# different noise:
#
#   ctx_boot     — the resident floor: system prompt + playbook + tool schemas on
#                  the first request. Near-DETERMINISTIC for a fixed tree, so it
#                  behaves like the mechanism fields, not like cost. A 2% band
#                  absorbs schema/date jitter and nothing else. This is the only
#                  number in the harness that directly measures "did the playbook
#                  get bigger", which is what a large family of workflow changes
#                  is actually trying to move.
#   ctx_in_total — Σ per-request context = turns × average context. Cost is a
#                  linear function of it, so it gets the SAME tolerance as cost
#                  and the same MDE treatment: it is exactly as noisy.
#
# Both matter and neither substitutes for the other. rationale.md records a change
# that cut ~26 KB of resident instructions and raised cost 16.4%: boot went down,
# in_total went up because the run took more turns. A guard watching only boot
# would have called that a win.
CTX_TOL="${BENCH_CTX_TOL:-0.02}"

mode="${1:-}"; shift 2>/dev/null || true

case "$mode" in
  --ratchet)
    base="${1:?usage: compare.sh --ratchet <baseline> <current>}"
    cur="${2:?usage: compare.sh --ratchet <baseline> <current>}"
    ab="$(sh "$AGG" "$base")"
    ac="$(sh "$AGG" "$cur")"
    result="$(jq -n --argjson base "$ab" --argjson cur "$ac" --arg tol "$TOL" --arg ctol "$CTX_TOL" '
      ($tol | tonumber) as $t
      | ($ctol | tonumber) as $ct
      | ($base | map(select(.arm == "workflow")) | INDEX(.task)) as $B
      | ($cur  | map(select(.arm == "workflow")))
      | map(
          . as $r | $B[$r.task] as $b
          | if $b == null then {task: $r.task, verdict: "new (no baseline)", fail: false, fails: []}
            else
              # QUALITY, oracle-first. Compare oracle scores only when BOTH sides
              # have them: an oracle score is "criteria met out of N" and a judge
              # score is a 0-10 opinion, so crossing them compares nothing. When
              # the oracle is available it is the guard, because the judge has
              # passed twelve diffs that objectively failed an AC on this suite.
              (if ($b.oracle_score != null and $r.oracle_score != null) then "oracle" else "judge" end) as $qsrc
              | (if $qsrc == "oracle" then $b.oracle_score else $b.judge_score end) as $qb
              | (if $qsrc == "oracle" then $r.oracle_score else $r.judge_score end) as $qr
              | ([
                (if ($r.spawn_count // 0)  > ($b.spawn_count // 0)  then "spawn_count \($b.spawn_count)->\($r.spawn_count)" else empty end),
                (if ($r.cycles_test // 0)  > ($b.cycles_test // 0)  then "cycles.test \($b.cycles_test)->\($r.cycles_test)" else empty end),
                (if ($r.cycles_review // 0)> ($b.cycles_review // 0)then "cycles.review \($b.cycles_review)->\($r.cycles_review)" else empty end),
                (if ($r.cost_usd // 0)     > (($b.cost_usd // 0) * (1 + $t)) then "cost \($b.cost_usd)->\($r.cost_usd) (>\(($t*100)|floor)%)" else empty end),
                # CONTEXT. boot is near-deterministic, so it gets the tight band:
                # a resident floor that grew is a playbook that grew, and that is
                # a regression whether or not this run happened to be cheap.
                (if ($b.ctx_boot != null and $r.ctx_boot != null and $r.ctx_boot > ($b.ctx_boot * (1 + $ct)))
                 then "ctx_boot \($b.ctx_boot)->\($r.ctx_boot) (>\(($ct*100)|floor)% — the resident floor grew)" else empty end),
                (if ($b.ctx_in_total != null and $r.ctx_in_total != null and $r.ctx_in_total > ($b.ctx_in_total * (1 + $t)))
                 then "ctx_in_total \($b.ctx_in_total)->\($r.ctx_in_total) (>\(($t*100)|floor)% — more turns or more context per turn)" else empty end),
                (if ($qb != null and $qr != null and $qr < $qb) then "quality[\($qsrc)] \($qb)->\($qr)" else empty end)
              ]) as $fails
              | {task: $r.task, fails: $fails, fail: (($fails | length) > 0),
                 qsrc: $qsrc,
                 # An unmeasured axis is not a passing axis. A ratchet that stays
                 # silent about a guard it could not evaluate reads as "checked
                 # and fine", which is how a context regression ships unnoticed.
                 unguarded: ([
                   (if ($b.oracle_score == null or $r.oracle_score == null) then "quality is judge-only" else empty end),
                   (if ($b.ctx_boot == null or $r.ctx_boot == null) then "ctx_boot" else empty end),
                   (if ($b.ctx_in_total == null or $r.ctx_in_total == null) then "ctx_in_total" else empty end)
                 ]),
                 cost: {base: $b.cost_usd, cur: $r.cost_usd},
                 dur:  {base: $b.wall_s, cur: $r.wall_s},
                 ctx:  {base: $b.ctx_in_total, cur: $r.ctx_in_total},
                 boot: {base: $b.ctx_boot, cur: $r.ctx_boot}}
            end
        )
    ')"
    echo "ratchet (workflow arm, cost/ctx_in_total tolerance +$(printf '%.0f' "$(echo "$TOL*100" | bc 2>/dev/null || echo 20)")%, ctx_boot +$(printf '%.0f' "$(echo "$CTX_TOL*100" | bc 2>/dev/null || echo 2)")%)"
    printf '%s' "$result" | jq -r '.[] |
      def k($x): if $x == null then "-" else (($x/1000*10|round)/10|tostring) + "k" end;
      def m($x): if $x == null then "-" else (($x/1000000*100|round)/100|tostring) + "M" end;
      if .fail then "  ✗ \(.task): " + (.fails | join("; "))
      elif .verdict then "  • \(.task): \(.verdict)"
      else "  ✓ \(.task): within budget (cost \(.cost.base // "-")→\(.cost.cur // "-"), wall \(.dur.base // "-")→\(.dur.cur // "-")s, boot \(k(.boot.base))→\(k(.boot.cur)), ctx \(m(.ctx.base))→\(m(.ctx.cur)))" end'
    # Name every guard that could not run. Silence about an unevaluated guard is
    # indistinguishable from a guard that passed.
    printf '%s' "$result" | jq -r '.[] | select((.unguarded // []) | length > 0) |
      "  ~ \(.task): NOT GUARDED — " + (.unguarded | join(", ")) + " (missing on one side; backfill-context.sh recovers ctx_* for old baselines)"'
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
      def k($x): if $x == null then "-" else (($x/1000*10|round)/10|tostring) + "k" end;
      def m($x): if $x == null then "-" else (($x/1000000*100|round)/100|tostring) + "M" end;
      def x($a; $b): if ($a == null or $b == null or $b == 0) then "-"
                     else ((($a / $b) * 10 | round) / 10 | tostring) + "x" end;
      group_by(.task) | map({
        task: .[0].task,
        wf:   (map(select(.arm == "workflow")) | .[0]),
        bl:   (map(select(.arm == "baseline")) | .[0])
      })
      | .[]
      | if (.wf == null or .bl == null) then "  • \(.task): missing an arm (need both workflow + baseline)"
        else
          (.wf.cost_usd // 0) as $cw | (.bl.cost_usd // 0) as $cb
          # Oracle-first, and only when BOTH arms have it. This is the whole point
          # of the A/B: on 11-recent-window the judge ranked the plain baseline
          # HIGHER than /dev (10 vs 9) while the oracle showed both at exactly 5/6
          # — so a judge-based A/B verdict on that task rested on nothing.
          | (if (.wf.oracle_score != null and .bl.oracle_score != null) then "oracle" else "judge" end) as $qsrc
          | (if $qsrc == "oracle" then (.wf.oracle_score // 0) else (.wf.judge_score // 0) end) as $qw
          | (if $qsrc == "oracle" then (.bl.oracle_score // 0) else (.bl.judge_score // 0) end) as $qb
          | (if $qw > $qb then "worth-it (higher quality)"
             elif ($qw == $qb and $cw <= $cb) then "worth-it (equal quality, no cost premium)"
             else "questionable (quality \($qw) vs \($qb), cost \($cw) vs \($cb))" end) as $v
          | "  • \(.task): \($v)   [quality graded by: \($qsrc)\(if $qsrc == "judge" then " — an opinion, not an assertion" else "" end)]",
            "      cost:    wf \($cw) / bl \($cb)   (\(x($cw; $cb)))",
            "      wall(s): wf \(.wf.wall_s // "-") / bl \(.bl.wall_s // "-")   (\(x(.wf.wall_s; .bl.wall_s)))",
            "      quality: wf \($qw) / bl \($qb)" +
              (if $qsrc == "oracle" then "  (of \(.wf.oracle_max // "?"))" else "" end),
            # CONTEXT is where the machinery premium is actually visible, and it
            # is far larger than the cost column suggests: measured on
            # 09-api-compat the arms differ 61x on ctx_in_total while cost differs
            # ~7-10x, because a 97% cache-hit prefix is billed at a fraction of a
            # fresh token. Quoting only cost understates what the workflow spends;
            # quoting only context overstates what it is charged. Both ship.
            "      context: boot wf \(k(.wf.ctx_boot)) / bl \(k(.bl.ctx_boot)) (\(x(.wf.ctx_boot; .bl.ctx_boot)))   in_total wf \(m(.wf.ctx_in_total)) / bl \(m(.bl.ctx_in_total)) (\(x(.wf.ctx_in_total; .bl.ctx_in_total)))   reqs wf \(.wf.ctx_reqs // "-") / bl \(.bl.ctx_reqs // "-")"
        end'
    exit 0
    ;;

  --context)
    # A focused before/after on the fourth axis alone. Free to compute and, unlike
    # cost, it says WHERE a change went: boot moves when the resident playbook
    # changes size, reqs moves when the run does more round-trips, and in_total is
    # the product. Three numbers separate "we read less" from "we did less" —
    # a distinction the cost column cannot make on its own.
    base="${1:?usage: compare.sh --context <baseline> <current>}"
    cur="${2:?usage: compare.sh --context <baseline> <current>}"
    ab="$(sh "$AGG" "$base")"
    ac="$(sh "$AGG" "$cur")"
    echo "context (workflow arm) — boot = resident floor · reqs = round-trips · in_total = boot-and-growth integral"
    jq -rn --argjson base "$ab" --argjson cur "$ac" '
      def k($x): if $x == null then "-" else (($x/1000*10|round)/10|tostring) + "k" end;
      def m($x): if $x == null then "-" else (($x/1000000*100|round)/100|tostring) + "M" end;
      # A drop of exactly zero is "0%", not "−0%": a signed zero reads as a
      # small saving and there is none.
      def pct($a; $b): if ($a == null or $b == null or $b == 0) then "n/a"
                       else ((((1 - ($a / $b)) * 1000) | round) / 10) as $p
                            | if $p == 0 then "0%"
                              else (if $p > 0 then "−" else "+" end) + (($p | fabs | tostring) + "%") end end;
      ($base | map(select(.arm == "workflow")) | INDEX(.task)) as $B
      | ($cur | map(select(.arm == "workflow")))
      | .[]
      | . as $r | ($B[$r.task] // null) as $b
      | if $b == null then "  • \($r.task): new (no baseline)"
        elif ($b.ctx_in_total == null or $r.ctx_in_total == null)
          then "  ~ \($r.task): NOT MEASURED on one side (base \(m($b.ctx_in_total)) / cur \(m($r.ctx_in_total))) — sh backfill-context.sh recovers old rows"
        else
          "  • \($r.task):",
          "      boot     \(k($b.ctx_boot)) → \(k($r.ctx_boot))   (\(pct($r.ctx_boot; $b.ctx_boot)))",
          "      reqs     \($b.ctx_reqs // "-") → \($r.ctx_reqs // "-")   (\(pct($r.ctx_reqs; $b.ctx_reqs)))",
          "      peak     \(k($b.ctx_peak)) → \(k($r.ctx_peak))   (\(pct($r.ctx_peak; $b.ctx_peak)))",
          "      in_total \(m($b.ctx_in_total)) → \(m($r.ctx_in_total))   (\(pct($r.ctx_in_total; $b.ctx_in_total)))",
          # The interpretation line. Without it a reader sees three deltas and no
          # story; this names which of the two mechanisms moved.
          (if ($r.ctx_boot != null and $b.ctx_boot != null and $r.ctx_reqs != null and $b.ctx_reqs != null) then
            (if ($r.ctx_boot < $b.ctx_boot and $r.ctx_in_total >= $b.ctx_in_total)
             then "      → read LESS per turn but did MORE turns: the saving was relocated, not made"
             elif ($r.ctx_reqs < $b.ctx_reqs and $r.ctx_boot >= $b.ctx_boot)
             then "      → same floor, fewer round-trips: the run did less work or found it faster"
             elif ($r.ctx_boot < $b.ctx_boot and $r.ctx_in_total < $b.ctx_in_total)
             then "      → smaller floor AND smaller integral: a real context saving"
             else "      → no clean story; read boot and reqs together before quoting in_total" end)
           else empty end)
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
              # Context delta, reported alongside cost and wall. It is the axis
              # that says WHY cost moved, so an optimisation report without it is
              # a number with no mechanism.
              | (if ($b.ctx_in_total // 0) > 0 and $r.ctx_in_total != null
                 then (1 - ($r.ctx_in_total / $b.ctx_in_total)) else null end) as $dx
              | (if ($b.ctx_boot // 0) > 0 and $r.ctx_boot != null
                 then (1 - ($r.ctx_boot / $b.ctx_boot)) else null end) as $db
              # Quality, oracle-first and only when both sides carry it (see
              # --ratchet). A judge-only comparison still gates, but the report
              # names it as an opinion so a "gain" cannot be claimed off one.
              | (if ($b.oracle_score != null and $r.oracle_score != null) then "oracle" else "judge" end) as $qsrc
              | (if $qsrc == "oracle" then $b.oracle_score else $b.judge_score end) as $qb
              | (if $qsrc == "oracle" then $r.oracle_score else $r.judge_score end) as $qr
              | (($qr // 0) < ($qb // 0)) as $qdrop
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
                 ctx:  {base: $b.ctx_in_total, cur: $r.ctx_in_total, drop: $dx},
                 boot: {base: $b.ctx_boot, cur: $r.ctx_boot, drop: $db},
                 judge: {base: $qb, cur: $qr, drop: $qdrop, src: $qsrc},
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
                        | if $p == 0 then "0%"
                          else (if $p > 0 then "−" else "+" end) + (($p | fabs | tostring) + "%") end end;
      .rows[] |
      if .status == "new" then "  • \(.task): new (no baseline) — not counted"
      elif .status == "unmeasured" then "  ✗ \(.task): no usable rows to compare (\(.detail))"
      else "  \(if .fail then "✗" else "✓" end) \(.task): "
           + (if .unresolved then "UNRESOLVED  |Δcost| < MDE \((.mde*1000|round/10))% — not a saving, not a regression; raise n\n      " else "" end)
           + (if .underpowered then "⚠ underpowered — below the min-n guard; read as unmeasured\n      " else "" end)
           + "cost \(.cost.base)→\(.cost.cur) (\(pct(.cost.drop)))  "
           + "wall \(.wall.base // "-")→\(.wall.cur // "-")s (\(pct(.wall.drop)))  "
           + "quality[\(.judge.src // "judge")] \(.judge.base // "-")→\(.judge.cur // "-")"
           + (if .judge.drop then "  ← quality regressed; a cheaper worse run is not a gain" else "" end)
           # Context on its own line: it is the mechanism behind the cost delta,
           # and a saving whose context did not move is a saving with no
           # explanation — usually noise.
           + "\n      context: boot \(if .boot.base == null then "-" else ((.boot.base/1000*10|round)/10|tostring)+"k" end)→\(if .boot.cur == null then "-" else ((.boot.cur/1000*10|round)/10|tostring)+"k" end) (\(pct(.boot.drop)))  "
           + "in_total \(if .ctx.base == null then "-" else ((.ctx.base/1000000*100|round)/100|tostring)+"M" end)→\(if .ctx.cur == null then "-" else ((.ctx.cur/1000000*100|round)/100|tostring)+"M" end) (\(pct(.ctx.drop)))"
           + (if .ctx.drop == null then "  ← unmeasured: sh backfill-context.sh recovers old rows"
              elif (.cost.drop > 0.05 and .ctx.drop < 0.02) then "  ← cost fell but context did not: suspect noise, not a saving"
              else "" end)
      end'
    printf '%s' "$result" | jq -r '
      # Sign it here, not at the call site: a NEGATIVE drop is an increase, and a
      # hardcoded "−" prefix rendered it as "−-1.5%".
      def pct($x): if $x == null then "n/a"
                   else ((($x * 1000) | round) / 10) as $p
                        | if $p == 0 then "0%"
                          else (if $p > 0 then "−" else "+" end) + (($p | fabs | tostring) + "%") end end;
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
    echo "usage: compare.sh <mode> …" >&2
    echo "  --ratchet   <baseline> <current>              regression guard: mechanism, cost, CONTEXT, quality" >&2
    echo "  --gain      <baseline> <current> [--target f] did an optimisation pay, and did context explain it" >&2
    echo "  --context   <baseline> <current>              the fourth axis alone: boot / reqs / peak / in_total" >&2
    echo "  --mechanism <baseline> <current>              deterministic fields only; honest at --repeats 1" >&2
    echo "  --ab        <scorecards>                      is the machinery worth it (cost AND context premium)" >&2
    echo "  --mde       <scorecards> [effect-pct]         what can this n actually resolve" >&2
    exit 2
    ;;
esac
