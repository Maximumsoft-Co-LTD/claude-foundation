#!/usr/bin/env sh
# aggregate.sh — fold N scorecard rows into one summary row per (task, arm).
#
# Input: a JSONL file (one scorecard object per line) as $1, or on stdin. Each
# row is emitted by run-bench.sh across FOUR axes: quality (`oracle_*` then
# `judge_*`), speed (`wall_s`), cost (`cost_usd`), context (`ctx_*`), plus the
# mechanism telemetry (`spawn_count`, `cycles_*`) and an `outcome` word.
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
#   4. THE ORACLE OUTRANKS THE JUDGE, and `blocked` is not a failure. Two rules
#      that came from this suite being wrong in public. On 11-recent-window the
#      judge scored twelve diffs 8-10 and passed all twelve while a deterministic
#      oracle showed every one failing AC4 — so `oracle_score` leads the table and
#      `judge_score` sits beside it as an opinion about simplicity and fit. And a
#      run that stops to ask a human about a real contradiction is the workflow
#      doing the thing a plain prompt cannot; counting it as a failure is why
#      README says "the harness cannot currently observe /dev succeeding at its
#      actual job". `n_blocked` gives it a column. It still stays out of the
#      medians — there is no delivered code to grade — but it is now visibly
#      excluded for succeeding rather than invisibly excluded for crashing.
#
#   5. FIELDS THE ENVELOPE GETS WRONG ARE NOT AGGREGATED. `duration_ms` timed one
#      841s run at 72s (it cannot see sub-agent time) and `in_tokens` read 186 on
#      a run that carried 14.4M. Both used to be medianned next to the honest
#      `wall_s`, where nothing marked which number to trust. Speed is `wall_s`;
#      tokens are `ctx_*`. The envelope's own copies survive on the row for
#      forensics under `envelope_*` names and are summarised nowhere.
#
# Usage:  sh aggregate.sh results/scorecards.jsonl [--table]
#         sh aggregate.sh results/scorecards.jsonl --table --context

set -eu
command -v jq >/dev/null 2>&1 || { echo "aggregate: jq required" >&2; exit 2; }

file=""; table=0; ctxtable=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --table) table=1 ;;
    # Context gets its own table rather than four more columns on the main one.
    # The main table is already 12 columns; at 16 it wraps in a terminal and a
    # wrapped table is how a reader picks up the wrong row's number.
    --context) ctxtable=1; table=1 ;;
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

  # An old row has no `outcome`; derive one so blocked/ok counting works across
  # scorecards recorded before the field existed rather than reporting them as a
  # separate unknown class.
  def outcome_of: .outcome // (if .ok == true then "ok"
                               else (.fail_reason // "unknown") as $r
                                  | if ($r | startswith("blocked_at")) then "blocked"
                                    elif ($r | startswith("incomplete_at")) then "incomplete"
                                    else "fail" end end);

  map(select(type == "object"))
  | group_by([.task, .arm])
  | map(
      . as $all
      | ($all | map(select(.ok == true))) as $g          # usable rows only (rule 1)
      | ($all | map(select(outcome_of == "blocked"))) as $blk
      | ($g | map(.judge_score) | nn) as $J
      | ($g | map(.cost_usd)    | nn) as $C
      | ($g | map(.wall_s)      | nn) as $W
      # Oracle rows only — a task without an oracle contributes nothing here, and
      # an absent oracle must never read as a failing one.
      | ($g | map(select(.oracle_score != null))) as $og
      | ($og | map(.oracle_score)) as $O
      | ($g | map(.ctx_boot)     | nn) as $CB
      | ($g | map(.ctx_peak)     | nn) as $CP
      | ($g | map(.ctx_in_total) | nn) as $CI
      | {
          task:         $all[0].task,
          arm:          $all[0].arm,
          n:            ($all | length),
          n_ok:         ($g | length),
          ok_rate:      (($g | length) / ($all | length)),
          # A blocked run is a design-phase success with no code (rule 4). It gets
          # counted, not buried in fail_reasons where it reads as a crash.
          n_blocked:    ($blk | length),
          blocked_rate: (($blk | length) / ($all | length)),
          # Why the failures happened, not just how many — a run lost to the
          # watchdog and one lost to an API error demand different fixes.
          # Rows written before fail_reason existed count as "unknown".
          # `blocked` is excluded here: it is reported by n_blocked instead, so
          # this list stays a list of things that actually went wrong.
          fail_reasons: (($all | map(select(.ok != true and outcome_of != "blocked") | (.fail_reason // "unknown")))
                         | if length == 0 then null
                           else (group_by(.) | map({key: .[0], value: length}) | from_entries) end),
          cost_usd:     med($C),
          cost_sd:      sd($C),
          cost_trimmed: trimmed($C),
          turns:        med($g | map(.turns) | nn),
          wall_s:       med($W),
          wall_sd:      sd($W),
          spawn_count:  med($g | map(.spawn_count) | nn),
          cycles_test:  med($g | map(.cycles_test) | nn),
          cycles_review:med($g | map(.cycles_review) | nn),

          # ---- QUALITY: objective half first ------------------------------
          n_oracle:     ($og | length),
          oracle_score: med($O),
          oracle_sd:    sd($O),
          oracle_p10:   p10($O),
          oracle_max:   ($og | map(.oracle_max) | nn | if length == 0 then null else max end),
          # Fraction of ORACLE-GRADED rows that passed every criterion. Reported
          # over $og, not over $g: dividing by rows the oracle never saw would
          # silently punish a task for not having an oracle yet.
          oracle_pass_rate: (if ($og | length) == 0 then null
                             else (($og | map(select(.oracle_verdict == "pass")) | length) / ($og | length)) end),
          # WHICH criteria failed, and in how many runs. This is the actionable
          # cell: "AC4 failed 6/6" is a finding, "quality 5/6" is a number. It is
          # what turned the 11-recent-window judge blindness from an anecdote into
          # a measured fact.
          oracle_fail_acs: (($og | map(.oracle_fails // []) | flatten)
                            | if length == 0 then null
                              else (group_by(.) | map({key: .[0], value: length}) | from_entries) end),
          judge_score:  med($J),
          judge_sd:     sd($J),
          judge_p10:    p10($J),

          # ---- CONTEXT: the fourth axis -----------------------------------
          # boot   = resident floor every turn pays (what the playbook costs)
          # peak   = high-water mark, i.e. remaining window headroom
          # in_total = Σ per-request context = "turns × average context", the
          #            quantity cost is a linear function of. A change can cut
          #            boot and raise in_total by causing more turns — which is
          #            the exact shape of the −26 KB / +16.4% result in
          #            rationale.md — so all three are reported, never one.
          n_ctx:          ($CI | length),
          ctx_boot:       med($CB),
          ctx_peak:       med($CP),
          ctx_mean:       med($g | map(.ctx_mean) | nn),
          ctx_in_total:   med($CI),
          ctx_in_total_sd: sd($CI),
          ctx_out_total:  med($g | map(.ctx_out_total) | nn),
          ctx_cache_hit:  med($g | map(.ctx_cache_hit) | nn),
          ctx_reqs:       med($g | map(.ctx_reqs) | nn),
          ctx_agents:     med($g | map(.ctx_agents) | nn),
          ctx_agent_in_total: med($g | map(.ctx_agent_in_total) | nn)
        }
    )
')"

if [ "$table" = "1" ]; then
  # Round the spread columns for display only; the JSON keeps full precision.
  # `oracle` leads `judge` because it is the column that can be checked (rule 4);
  # `blk` sits next to nOK so a run excluded for succeeding is visible at a glance.
  printf '%-22s %-9s %3s %4s %4s %9s %7s %5s %5s %7s %5s %5s\n' \
    task arm n nOK blk costUSD wallSec turns spawn oracle judge jP10
  printf '%s' "$agg" | jq -r '.[] |
    [ .task, .arm, .n, .n_ok, (.n_blocked // 0),
      (.cost_usd // "-"|tostring),
      (.wall_s // "-"|tostring),
      (.turns // "-"|tostring),
      (.spawn_count // "-"|tostring),
      # "5/6" carries the denominator: an oracle score is only readable against
      # its own max, and a bare 5 next to a judge 9 invites reading it as worse.
      (if .oracle_score == null then "-"
       else ((.oracle_score|tostring) + "/" + ((.oracle_max // "?")|tostring)) end),
      (.judge_score // "-"|tostring),
      (.judge_p10 // "-"|tostring)
    ] | @tsv' \
    | while IFS="$(printf '\t')" read -r t a n nok blk c w tu s o j jp10; do
        printf '%-22s %-9s %3s %4s %4s %9s %7s %5s %5s %7s %5s %5s\n' \
          "$t" "$a" "$n" "$nok" "$blk" "$c" "$w" "$tu" "$s" "$o" "$j" "$jp10"
      done

  # A task graded by the judge ALONE is flagged, because that is the state in
  # which this suite has already been wrong at n=12. Silence here would let an
  # opinion be read as a measurement.
  nj="$(printf '%s' "$agg" | jq -r '.[] | select(.n_oracle == 0 and .judge_score != null) |
    "  ~ \(.task)/\(.arm) — quality is the JUDGE ONLY (no oracle for this task): read it as simplicity/fit, not as \"the criteria are met\""')"
  [ -n "$nj" ] && { echo; printf '%s\n' "$nj"; } || true

  # Which criteria actually fail, and how often. The single most actionable line
  # the harness can print: a 5/6 that fails the same AC every run is a finding.
  oa="$(printf '%s' "$agg" | jq -r '.[] | select(.oracle_fail_acs != null) |
    . as $r | "  ✗ \(.task)/\(.arm) — failing criteria: " +
    (.oracle_fail_acs | to_entries | sort_by(-.value) | map("\(.key) ×\(.value)/\($r.n_oracle)") | join(", "))')"
  [ -n "$oa" ] && { echo; printf '%s\n' "$oa"; } || true

  # Blocked runs get a line saying what they are, because the word "excluded"
  # otherwise reads as "broken" — the exact misreading that hid /dev's own
  # design-phase wins (README > blocked_at_*).
  bl="$(printf '%s' "$agg" | jq -r '.[] | select((.n_blocked // 0) > 0) |
    "  ⊘ \(.task)/\(.arm) — \(.n_blocked) run(s) BLOCKED for a human: a design-phase stop, not a failure. Read state.json > notes before concluding anything."')"
  [ -n "$bl" ] && { echo; printf '%s\n' "$bl"; } || true

  # Failures get their own lines rather than a column: the reason is the
  # actionable part, and burying it in a width-limited cell loses it.
  fr="$(printf '%s' "$agg" | jq -r '.[] | select(.fail_reasons != null) |
    "  ! \(.task)/\(.arm) — excluded from medians: " +
    (.fail_reasons | to_entries | map("\(.key)×\(.value)") | join(", "))')"
  [ -n "$fr" ] && { echo; printf '%s\n' "$fr"; } || true

  if [ "$ctxtable" = "1" ]; then
    echo
    echo "context — boot = resident floor per turn · peak = high-water · in_total = Σ per-request context (cost tracks this)"
    printf '%-22s %-9s %4s %8s %8s %10s %6s %5s %6s\n' \
      task arm nCtx boot peak in_total cache reqs agents
    printf '%s' "$agg" | jq -r '.[] |
      def k($x): if $x == null then "-" else (($x/1000*10|round)/10|tostring) + "k" end;
      def m($x): if $x == null then "-" else (($x/1000000*100|round)/100|tostring) + "M" end;
      [ .task, .arm, (.n_ctx // 0), k(.ctx_boot), k(.ctx_peak), m(.ctx_in_total),
        (if .ctx_cache_hit == null then "-" else ((.ctx_cache_hit*100|round)|tostring) + "%" end),
        (.ctx_reqs // "-"|tostring), (.ctx_agents // "-"|tostring)
      ] | @tsv' \
      | while IFS="$(printf '\t')" read -r t a nc bo pk it ch rq ag; do
          printf '%-22s %-9s %4s %8s %8s %10s %6s %5s %6s\n' \
            "$t" "$a" "$nc" "$bo" "$pk" "$it" "$ch" "$rq" "$ag"
        done
    # An unmeasured context column is not a zero-context run. Say which rows are
    # blank so nobody reads a dash as "this run carried no context".
    nc="$(printf '%s' "$agg" | jq -r '.[] | select((.n_ctx // 0) == 0) |
      "  ~ \(.task)/\(.arm) — context NOT measured (rows predate the axis, or the transcript is gone). Recover with: sh backfill-context.sh <file>"')"
    [ -n "$nc" ] && { echo; printf '%s\n' "$nc"; } || true
  fi
else
  printf '%s\n' "$agg"
fi
