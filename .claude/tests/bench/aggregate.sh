#!/usr/bin/env sh
# aggregate.sh — fold N scorecard rows into one summary row per (task, arm).
#
# Input: a JSONL file (one scorecard object per line) as $1, or on stdin. Each
# row is emitted by run-bench.sh: {task, arm, ok, fail_reason, cost_usd,
# out_tokens, turns, duration_ms, spawn_count, cycles_test, cycles_review,
# judge_score, ...}.
#
# Output (default): a JSON array of aggregated rows (machine-readable; compare.sh
# consumes it). With --table: a human-readable table.
#
# Median is the summary stat because wall-clock / cost are noisy across live runs
# (dev-metrics.sh's own guidance: "take a median across runs"). Mechanism metrics
# (spawn_count, cycles) should already be stable; their median just confirms it.
#
# THREE RULES THAT MAKE THE NUMBERS HONEST:
#
#   1. Only ok==true rows feed the medians. A run killed by the watchdog still
#      carries a judge_score — but that score grades a half-finished sandbox, so
#      it measures the HARNESS failing, not the workflow producing bad code.
#      Folding it in silently reports a quality regression that never happened
#      (observed for real: a timed-out /dev arm scored 3/fail). `n` counts every
#      row, `n_ok` counts the usable ones, and `fail_reasons` says why the rest
#      dropped out. When n_ok == 0 every median is null — we have no measurement,
#      and saying so beats printing a number derived from wreckage.
#
#   2. Spread ships next to the median. Identical prompts have scored 9 and 4 on
#      this suite, so a lone median hides the thing that decides whether the
#      machinery is worth paying for: consistency. `judge_sd` is the SAMPLE
#      stddev (n-1) and is null at n<2 — one run cannot estimate variance, and a
#      null forces `--repeats` rather than implying certainty a 0 would.
#
#   3. `judge_p10` is worst-case quality by nearest-rank. Below n=10 that IS the
#      minimum observed, which is the honest reading at these sample sizes: it
#      answers "how bad does a bad day get", the number a median is built to hide.
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
  # Drop nulls before any stat: an absent metric must not be read as a zero.
  def nn: map(select(. != null));

  # True median: odd n takes the middle, even n averages the two middles. Taking
  # the lower-middle on even n silently reports the worse of two samples as "the"
  # number — misleading when the two disagree, which live runs often do.
  def med($a): ($a | sort) as $s
             | if ($s | length) == 0 then null
               elif (($s | length) % 2) == 1 then $s[(($s | length) - 1) / 2]
               else (($s[($s | length) / 2 - 1] + $s[($s | length) / 2]) / 2) end;

  # Trimmed mean — drop the single highest and lowest run, average the rest.
  # The median is robust but throws away most of the sample; at the n=5..12 this
  # suite can afford, a 1-from-each-end trim keeps the robustness and uses the
  # middle of the distribution, so the same tokens buy a tighter estimate.
  # Reported ALONGSIDE the median, never instead of it: when the two disagree the
  # distribution is skewed and neither number should be quoted on its own.
  def trimmed($a): ($a | sort) as $s | ($s | length) as $n
                 | if $n < 5 then null else (($s[1:-1] | add) / ($n - 2)) end;

  # Sample stddev (n-1). null at n<2 — one sample carries no spread information,
  # and 0 would read as "perfectly consistent", the opposite of the truth.
  def sd($a): ($a | length) as $n
            | if $n < 2 then null
              else (($a | add) / $n) as $m
                 | ((($a | map(($m - .) * ($m - .))) | add) / ($n - 1)) | sqrt end;

  # p10 by nearest-rank; collapses to the minimum for n<=10 (see header note 3).
  def p10($a): ($a | sort) as $s
             | if ($s | length) == 0 then null
               else $s[([((($s | length) * 0.10) | ceil) - 1, 0] | max)] end;

  map(select(type == "object"))
  | group_by([.task, .arm])
  | map(
      . as $all
      | ($all | map(select(.ok == true))) as $g          # usable rows only (rule 1)
      | ($g | map(.judge_score) | nn) as $J
      | ($g | map(.cost_usd)    | nn) as $C
      | ($g | map(.wall_s)      | nn) as $W
      | {
          task:         $all[0].task,
          arm:          $all[0].arm,
          n:            ($all | length),
          n_ok:         ($g | length),
          ok_rate:      (($g | length) / ($all | length)),
          # Why the failures happened, not just how many — a run lost to the
          # watchdog and one lost to an API error demand different fixes.
          # Rows written before fail_reason existed count as "unknown".
          fail_reasons: (($all | map(select(.ok != true) | (.fail_reason // "unknown")))
                         | if length == 0 then null
                           else (group_by(.) | map({key: .[0], value: length}) | from_entries) end),
          cost_usd:     med($C),
          cost_sd:      sd($C),
          cost_trimmed: trimmed($C),
          out_tokens:   med($g | map(.out_tokens) | nn),
          turns:        med($g | map(.turns) | nn),
          duration_ms:  med($g | map(.duration_ms) | nn),
          wall_s:       med($W),
          wall_sd:      sd($W),
          spawn_count:  med($g | map(.spawn_count) | nn),
          cycles_test:  med($g | map(.cycles_test) | nn),
          cycles_review:med($g | map(.cycles_review) | nn),
          judge_score:  med($J),
          judge_sd:     sd($J),
          judge_p10:    p10($J)
        }
    )
')"

if [ "$table" = "1" ]; then
  # Round the spread columns for display only; the JSON keeps full precision.
  printf '%-22s %-9s %3s %4s %5s %9s %7s %5s %5s %5s %5s %5s\n' \
    task arm n nOK okR costUSD wallSec turns spawn judge jSD jP10
  printf '%s' "$agg" | jq -r '.[] |
    [ .task, .arm, .n, .n_ok,
      ((.ok_rate*100|floor|tostring) + "%"),
      (.cost_usd // "-"|tostring),
      (.wall_s // "-"|tostring),
      (.turns // "-"|tostring),
      (.spawn_count // "-"|tostring),
      (.judge_score // "-"|tostring),
      (if .judge_sd == null then "-" else (.judge_sd*100|round|./100|tostring) end),
      (.judge_p10 // "-"|tostring)
    ] | @tsv' \
    | while IFS="$(printf '\t')" read -r t a n nok ok c w tu s j jsd jp10; do
        printf '%-22s %-9s %3s %4s %5s %9s %7s %5s %5s %5s %5s %5s\n' \
          "$t" "$a" "$n" "$nok" "$ok" "$c" "$w" "$tu" "$s" "$j" "$jsd" "$jp10"
      done
  # Failures get their own lines rather than a column: the reason is the
  # actionable part, and burying it in a width-limited cell loses it.
  fr="$(printf '%s' "$agg" | jq -r '.[] | select(.fail_reasons != null) |
    "  ! \(.task)/\(.arm) — excluded from medians: " +
    (.fail_reasons | to_entries | map("\(.key)×\(.value)") | join(", "))')"
  [ -n "$fr" ] && { echo; printf '%s\n' "$fr"; } || true
else
  printf '%s\n' "$agg"
fi
