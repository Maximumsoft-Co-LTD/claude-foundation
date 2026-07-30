#!/usr/bin/env sh
# run-bench-tests.sh — deterministic self-test of the benchmark comparison logic
# (aggregate.sh + compare.sh) against synthetic scorecards. No live runs, no
# tokens: it proves the median/ratchet/AB math is correct so a real benchmark's
# verdict can be trusted.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
BENCH="$HERE/.."
FIX="$BENCH/fixtures"
AGG="$BENCH/aggregate.sh"
CMP="$BENCH/compare.sh"

. "$BENCH/../lib/assert.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq required for bench tests" >&2; exit 1; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT INT TERM
TMP_OUT="$TMPROOT/out.jsonl"

echo "Running benchmark self-test..."
echo

# --- aggregate: medians over the 3 'before' repeats -------------------------
agg="$(sh "$AGG" "$FIX/before.jsonl")"
assert_eq "aggregate n"           "3"    "$(printf '%s' "$agg" | jq -r '.[0].n')"
# jq 1.7 preserves number literals (0.10 stays 0.10), so compare numerically.
if printf '%s' "$agg" | jq -e '.[0].cost_usd == 0.10' >/dev/null; then pass "aggregate cost median (== 0.10)"; else fail "aggregate cost median — expected 0.10, got $(printf '%s' "$agg" | jq -r '.[0].cost_usd')"; fi
assert_eq "aggregate spawn median" "5"   "$(printf '%s' "$agg" | jq -r '.[0].spawn_count')"
assert_eq "aggregate judge median" "8"   "$(printf '%s' "$agg" | jq -r '.[0].judge_score')"
assert_eq "aggregate n_ok (all rows usable)" "3" "$(printf '%s' "$agg" | jq -r '.[0].n_ok')"
assert_eq "aggregate no fail_reasons when all ok" "null" "$(printf '%s' "$agg" | jq -r '.[0].fail_reasons')"
assert_eq "aggregate sd of identical scores is 0" "0" "$(printf '%s' "$agg" | jq -r '.[0].judge_sd')"

# --- spread: the median alone hides the thing that decides adoption ---------
# Live runs of ONE prompt scored 9 and 4 on this suite. A median of 6.5 reads as
# "mediocre but steady" when the truth is "a coin flip" — so sd and p10 ship
# alongside it, and p10 is what a bad day actually costs you.
var="$(sh "$AGG" "$FIX/variance.jsonl")"
if printf '%s' "$var" | jq -e '.[0].judge_score == 6.5' >/dev/null; then pass "variance judge median (== 6.5)"; else fail "variance judge median — expected 6.5, got $(printf '%s' "$var" | jq -r '.[0].judge_score')"; fi
# sample sd of {9,4} = sqrt(((9-6.5)^2+(4-6.5)^2)/1) = sqrt(12.5) ≈ 3.5355
if printf '%s' "$var" | jq -e '.[0].judge_sd > 3.535 and .[0].judge_sd < 3.536' >/dev/null; then pass "variance judge sd (≈ 3.5355)"; else fail "variance judge sd — expected ≈3.5355, got $(printf '%s' "$var" | jq -r '.[0].judge_sd')"; fi
assert_eq "variance judge p10 = worst observed" "4" "$(printf '%s' "$var" | jq -r '.[0].judge_p10')"
# One sample cannot estimate spread. null says so; 0 would claim consistency.
one="$(head -1 "$FIX/variance.jsonl" | sh "$AGG")"
assert_eq "sd is null at n<2" "null" "$(printf '%s' "$one" | jq -r '.[0].judge_sd')"

# --- failed rows stay out of every median -----------------------------------
# A watchdog kill still produces a judge score, but it grades a half-built
# sandbox — folding it in reports a quality regression that never happened
# (observed live: a timed-out /dev arm scored 3/fail and read as bad code).
fl="$(sh "$AGG" "$FIX/failed.jsonl")"
t2="$(printf '%s' "$fl" | jq -c '.[] | select(.task == "t2")')"
assert_eq "failed: n counts every row"        "2" "$(printf '%s' "$t2" | jq -r '.n')"
assert_eq "failed: n_ok counts usable rows"   "1" "$(printf '%s' "$t2" | jq -r '.n_ok')"
assert_eq "failed: judge median skips the timeout row" "8" "$(printf '%s' "$t2" | jq -r '.judge_score')"
assert_eq "failed: mechanism median skips it too"      "5" "$(printf '%s' "$t2" | jq -r '.spawn_count')"
assert_eq "failed: sd null once the bad row is dropped" "null" "$(printf '%s' "$t2" | jq -r '.judge_sd')"
assert_eq "failed: fail_reasons names the cause" "1" "$(printf '%s' "$t2" | jq -r '.fail_reasons.timeout')"
# All rows failed => no measurement exists. A null beats a number built from wreckage.
t3="$(printf '%s' "$fl" | jq -c '.[] | select(.task == "t3")')"
assert_eq "failed: all-failed task reports no quality" "null" "$(printf '%s' "$t3" | jq -r '.judge_score')"
assert_eq "failed: all-failed task ok_rate 0"          "0"    "$(printf '%s' "$t3" | jq -r '.ok_rate')"
# Rows written before fail_reason existed must still be classified, not dropped.
assert_eq "failed: legacy row without fail_reason => unknown" "1" "$(printf '%s' "$t3" | jq -r '.fail_reasons.unknown')"
# The table has to SAY a row was excluded, or the exclusion is just silent loss.
tbl="$(sh "$AGG" "$FIX/failed.jsonl" --table)"
assert_contains "table flags excluded rows" "$tbl" "excluded from medians"
assert_contains "table names the reason"    "$tbl" "timeout"

# --- the runner's fail_reason vocabulary matches what aggregate reports ------
# aggregate groups on whatever string the runner writes; a rename on one side
# silently splits the tally into two buckets, so the sets are pinned together.
for reason in timeout no_envelope api_error; do
  if grep -q "freason=\"$reason\"" "$BENCH/run-bench.sh"; then pass "run-bench emits fail_reason '$reason'"; else fail "run-bench no longer emits fail_reason '$reason'"; fi
done
if grep -q 'fail_reason:' "$BENCH/run-bench.sh"; then pass "run-bench writes fail_reason into the scorecard"; else fail "run-bench scorecard is missing fail_reason"; fi
# Assert the MECHANISM, not the flag's filename: the watchdog drops a marker file
# and the classifier reads it back, which is what separates "we killed it" from
# "it died on its own". (An earlier version of this check pinned the literal
# `.bench-timeout` name and broke the moment the flag moved out of the sandbox.)
if grep -q ': > "\$5"' "$BENCH/run-bench.sh"; then pass "run-bench watchdog drops a kill marker"; else fail "run-bench watchdog no longer marks its own kills"; fi
if grep -q 'if \[ -f "\$tmof" \]' "$BENCH/run-bench.sh"; then pass "run-bench reads the kill marker back"; else fail "run-bench cannot distinguish a watchdog kill from a self-exit"; fi

# --- judge reply parsing: a missing score is not a zero ---------------------
# The rubric asks for single-line JSON; models pretty-print anyway. A line-wise
# `grep -o '{.*}'` then grabbed the nested "subscores" object — valid JSON with
# no .score — and a `// 0` default recorded a real 8/pass as 0/fail. Three /dev
# arms with different behaviour (spawn_count 4, 4 and 0) all landed on exactly 0
# that way while every baseline scored 8-10. These run off canned replies, so the
# parser is proven without spending a token.
JUDGE="$BENCH/judge-outcome.sh"
JSB="$TMPROOT/judge-sb"
mkdir -p "$JSB"
( cd "$JSB" && git init -q \
  && printf '# sandbox\n' > README.md \
  && git add -A && git -c user.email=t@bench -c user.name=bench commit -qm base ) >/dev/null 2>&1
printf 'export const toCsv = (rows) => rows.join(",")\n' > "$JSB/index.js"   # the "solution" diff
JBASE="$(git -C "$JSB" rev-parse HEAD 2>/dev/null || echo HEAD)"
ACC="$BENCH/tasks/02-csv-format/acceptance.txt"

judge_out() {  # $1 reply fixture -> the judge's stdout (empty when unjudgeable)
  JUDGE_REPLY_FILE="$FIX/$1" sh "$JUDGE" "$JSB" "$ACC" --base "$JBASE" 2>/dev/null || true
}
judge_rc() {   # $1 reply fixture -> the judge's exit code
  _rc=0
  JUDGE_REPLY_FILE="$FIX/$1" sh "$JUDGE" "$JSB" "$ACC" --base "$JBASE" >/dev/null 2>&1 || _rc=$?
  printf '%s' "$_rc"
}

assert_eq "judge parses pretty-printed reply"   "8"    "$(judge_out judge-reply-multiline.txt | jq -r '.score')"
assert_eq "judge keeps verdict on pretty reply" "pass" "$(judge_out judge-reply-multiline.txt | jq -r '.verdict')"
assert_eq "judge parses fenced reply"           "6"    "$(judge_out judge-reply-fenced.txt   | jq -r '.score')"
assert_eq "judge parses reply wrapped in prose" "9"    "$(judge_out judge-reply-prose.txt    | jq -r '.score')"
# The whole point: no numeric .score => unjudgeable (exit 2, no stdout), NOT 0.
assert_eq "judge exits 2 when the reply has no score" "2" "$(judge_rc judge-reply-noscore.txt)"
assert_eq "judge emits nothing when it cannot score"  ""  "$(judge_out judge-reply-noscore.txt)"
# A scoreless reply must never be salvaged with a default anywhere in the script.
if grep -q "score // 0" "$JUDGE"; then fail "judge still defaults a missing score to 0"; else pass "judge has no silent score-0 default"; fi

# --- the graded diff carries the SOLUTION, not the harness's own droppings ----
# A trivial CSV run once handed the judge 33KB of diff of which 31KB (94%) was
# `.bench-envelope.json` + `__pycache__`, leaving 1.8KB of real code and half the
# 60KB cap already spent. Longer runs write bigger envelopes, so real code fell
# off the end and the judge graded metadata. A sandbox whose ONLY changes are
# such artifacts must read as an EMPTY solution diff (exit 2), not as a solution.
NSB="$TMPROOT/noise-sb"
mkdir -p "$NSB/__pycache__"
( cd "$NSB" && git init -q \
  && printf '# sandbox\n' > README.md \
  && git add -A && git -c user.email=t@bench -c user.name=bench commit -qm base ) >/dev/null 2>&1
NBASE="$(git -C "$NSB" rev-parse HEAD 2>/dev/null || echo HEAD)"
printf '{"cost":1,"turns":80}\n'      > "$NSB/.bench-envelope.json"
printf 'cached\n'                     > "$NSB/__pycache__/mod.cpython-312.pyc"
printf 'noise\n'                      > "$NSB/build.log"
_rc=0
JUDGE_REPLY_FILE="$FIX/judge-reply-multiline.txt" sh "$JUDGE" "$NSB" "$ACC" --base "$NBASE" >/dev/null 2>&1 || _rc=$?
assert_eq "judge ignores a diff of only harness artifacts" "2" "$_rc"
# Add one real source file and the same sandbox becomes judgeable.
printf 'export const toCsv = (r) => r.join(",")\n' > "$NSB/index.js"
assert_eq "judge grades the solution once real code exists" "8" \
  "$(JUDGE_REPLY_FILE="$FIX/judge-reply-multiline.txt" sh "$JUDGE" "$NSB" "$ACC" --base "$NBASE" 2>/dev/null | jq -r '.score')"
# Truncation must announce itself — a silently cut diff scores low and reads as bad code.
if grep -q "truncated to 60000B" "$JUDGE"; then pass "judge warns when it truncates the diff"; else fail "judge truncates the diff silently"; fi

# --- the runner keeps its artifacts out of the sandbox ----------------------
# `git add -A` sweeps anything under the sandbox into the graded diff, so the
# envelope and the timeout flag must be written as SIBLINGS of it.
if grep -q 'sb/.bench-envelope.json' "$BENCH/run-bench.sh"; then fail "run-bench still writes its envelope inside the sandbox"; else pass "run-bench keeps the envelope out of the sandbox"; fi
if grep -q 'SANDROOT/\$n-\$a-\$r.envelope.json' "$BENCH/run-bench.sh"; then pass "run-bench writes the envelope beside the sandbox"; else fail "run-bench envelope path is not a sandbox sibling"; fi
if grep -q 'SANDROOT/\$n-\$a-\$r.timeout' "$BENCH/run-bench.sh"; then pass "run-bench writes the timeout flag beside the sandbox"; else fail "run-bench timeout flag is not a sandbox sibling"; fi

# --- a run that stops early is not a successful run -------------------------
# /dev halting at the gate exits CLEANLY: healthy envelope, ok=true, and the judge
# merely finds no code. Observed: a benign "Docs: light" deviation stalled a run
# that then burned $2.80 over 640s and delivered zero code while scoring as a
# success. `done_at` is the run's own completion stamp — absent means it never
# reached Close, whatever the exit code claimed.
gs="$(sh "$AGG" "$FIX/gate-stall.jsonl")"
assert_eq "gate stall: counted but not usable" "1" "$(printf '%s' "$gs" | jq -r '.[0].n_ok')"
assert_eq "gate stall: excluded from the cost median" "4.78" "$(printf '%s' "$gs" | jq -r '.[0].cost_usd')"
assert_eq "gate stall: named in the tally" "1" "$(printf '%s' "$gs" | jq -r '.[0].fail_reasons.incomplete_at_gate')"
if grep -q 'done_at // "null"' "$BENCH/run-bench.sh"; then pass "run-bench checks done_at for completion"; else fail "run-bench cannot tell an early stop from a finished run"; fi
if grep -q 'incomplete_at_' "$BENCH/run-bench.sh"; then pass "run-bench names the step it stopped before"; else fail "run-bench does not record where a run stopped"; fi

# --- rows say which workflow produced them ----------------------------------
# Without it a ratchet can compare two different /dev versions and call the delta
# a regression; the rows collected while the harness itself was being fixed are
# exactly that hazard. `-dirty` marks a tree the sha alone does not identify.
if grep -q 'workflow_sha:' "$BENCH/run-bench.sh"; then pass "run-bench stamps workflow_sha on each row"; else fail "run-bench rows are not attributable to a /dev version"; fi
# sh resolves functions at call time, so defining workflow_sha() below its first
# call fails silently: `command not found` on stderr, an empty WFSHA, and every
# row stamped null. Caught live exactly that way — grep alone cannot see it.
_def="$(grep -n '^workflow_sha() {' "$BENCH/run-bench.sh" | cut -d: -f1)"
_use="$(grep -n '^WFSHA="\$(workflow_sha)"' "$BENCH/run-bench.sh" | cut -d: -f1)"
if [ -n "$_def" ] && [ -n "$_use" ] && [ "$_def" -lt "$_use" ]; then
  pass "workflow_sha is defined before it is called (line $_def < $_use)"
else
  fail "workflow_sha called at line ${_use:-?} but defined at ${_def:-none} — WFSHA would be empty"
fi
if grep -q -- '-dirty' "$BENCH/run-bench.sh"; then pass "run-bench flags an uncommitted workflow tree"; else fail "run-bench cannot flag a dirty workflow tree"; fi
assert_eq "aggregate tolerates rows carrying workflow_sha" "workflow" "$(printf '%s' "$gs" | jq -r '.[0].arm')"

# --- observed spawns sit beside self-reported ones --------------------------
# state.json > spawn_count is self-reported and has read 0 on a run that spawned
# `lead`; the guard hook's ledger is the independent count.
if grep -q 'spawn_log' "$BENCH/run-bench.sh"; then pass "run-bench reads the guard's spawn ledger"; else fail "run-bench ignores the observed spawn count"; fi
assert_eq "scorecard keeps both spawn numbers" "0 1" \
  "$(jq -r 'select(.repeat==1) | "\(.spawn_count) \(.spawn_observed)"' "$FIX/gate-stall.jsonl")"

# --- ratchet PASS: after-good does not regress vs before --------------------
if sh "$CMP" --ratchet "$FIX/before.jsonl" "$FIX/after-good.jsonl" >/dev/null 2>&1; then
  pass "ratchet PASS on non-regressing run"
else
  fail "ratchet PASS on non-regressing run — expected exit 0"
fi

# --- ratchet FAIL: after-bad regresses on spawn + cost + quality ------------
out="$(sh "$CMP" --ratchet "$FIX/before.jsonl" "$FIX/after-bad.jsonl" 2>&1 || true)"
if sh "$CMP" --ratchet "$FIX/before.jsonl" "$FIX/after-bad.jsonl" >/dev/null 2>&1; then
  fail "ratchet FAIL on regressing run — expected exit 1"
else
  pass "ratchet FAIL on regressing run (exit 1)"
fi
assert_contains "ratchet names spawn regression"   "$out" "spawn_count"
assert_contains "ratchet names cost regression"     "$out" "cost"
assert_contains "ratchet names quality regression"  "$out" "quality"

# --- A/B: workflow higher quality => worth-it -------------------------------
ab="$(sh "$CMP" --ab "$FIX/ab.jsonl" 2>&1)"
assert_contains "ab verdict worth-it" "$ab" "worth-it"
assert_contains "ab reports both arms cost" "$ab" "wf 0.1"

# --- a killed runner must actually die ---------------------------------------
# `trap cleanup EXIT INT TERM` where cleanup doesn't exit SWALLOWS the signal:
# the handler runs, deletes $SANDROOT, and the script resumes — so every later
# repeat runs against a deleted sandbox root and appends `no_envelope` rows,
# and no amount of `kill` stops it. Observed live: eight unkillable runners
# racing garbage into two scorecard files. Free to test with a `claude` stub.
STUB="$TMPROOT/stub"; mkdir -p "$STUB"
printf '#!/bin/sh\nsleep 60\n' > "$STUB/claude"; chmod +x "$STUB/claude"
(
  PATH="$STUB:$PATH"; export PATH
  sh "$BENCH/run-bench.sh" --run --arm baseline --tasks 01-task-list --out "$TMPROOT/sig.jsonl" \
    >"$TMPROOT/sig.log" 2>&1 &
  echo $! > "$TMPROOT/sig.pid"
  wait
) >/dev/null 2>&1 &
harness_pid=$!
# Give the runner time to reach the watchdog'd claude call, then TERM it.
i=0; while [ ! -s "$TMPROOT/sig.pid" ] && [ "$i" -lt 50 ]; do i=$((i+1)); sleep 0.2; done
sleep 2
runner_pid="$(cat "$TMPROOT/sig.pid" 2>/dev/null || echo 0)"
kill -TERM "$runner_pid" 2>/dev/null || true
i=0; while kill -0 "$runner_pid" 2>/dev/null && [ "$i" -lt 25 ]; do i=$((i+1)); sleep 0.2; done
if kill -0 "$runner_pid" 2>/dev/null; then
  kill -9 "$runner_pid" 2>/dev/null || true
  fail "run-bench survives SIGTERM (trap swallows the signal — unkillable runner)"
else
  pass "run-bench exits on SIGTERM"
fi
kill -9 "$harness_pid" 2>/dev/null || true
pkill -9 -f "$STUB/claude" 2>/dev/null || true
# Belt-and-braces: if THIS test run is itself interrupted, the runner it started
# would otherwise keep cycling repeats against a stub. Its --out path is unique
# to this TMPROOT, so it is safe to match on.
pkill -9 -f "$TMPROOT/sig.jsonl" 2>/dev/null || true
# The scorecard must not gain rows from a run we terminated: a killed repeat has
# nothing to say about the workflow, and `no_envelope` rows read like real ones.
sig_rows="$( [ -f "$TMPROOT/sig.jsonl" ] && wc -l < "$TMPROOT/sig.jsonl" | tr -d ' ' || echo 0)"
assert_eq "a TERMed runner writes no scorecard rows" "0" "$sig_rows"

# --- run-parallel: argument guards (the live path costs tokens, these don't) --
# Repeats are independent, so running them concurrently is free wall-clock — but
# only if each writes its OWN file. Two runners sharing one --out truncate each
# other on start, the incident README.md documents, so --out is mandatory here.
PAR="$BENCH/run-parallel.sh"
if sh -n "$PAR" 2>/dev/null; then pass "run-parallel parses"; else fail "run-parallel has a syntax error"; fi
par_noout="$(sh "$PAR" --arm design --tasks 09-api-compat 2>&1 || true)"
assert_contains "run-parallel demands --out" "$par_noout" "--out <file> is required"
par_zero="$(sh "$PAR" --repeats 0 --out "$TMPROOT/p.jsonl" 2>&1 || true)"
assert_contains "run-parallel rejects --repeats 0" "$par_zero" "must be >= 1"
par_nan="$(sh "$PAR" --repeats two --out "$TMPROOT/p.jsonl" 2>&1 || true)"
assert_contains "run-parallel rejects a non-numeric --repeats" "$par_nan" "positive integer"
# Each child must get its own --out, or the merge is merging one file with itself.
if grep -q -- '--out "$base-r\$i.jsonl"' "$PAR"; then pass "run-parallel gives each repeat its own file"; else fail "run-parallel children share an --out"; fi
# And it must not hang forever when a child dies before writing a row.
if grep -q 'pgrep -f "\$base-r"' "$PAR"; then pass "run-parallel gives up when its children die"; else fail "run-parallel would hang on a dead child"; fi

# --- design arm: the runner must route it to the deterministic grader --------
# A design run produces no code, so calling judge-outcome.sh on it would grade an
# empty diff and manufacture a quality failure — the same class of bug the
# judge's own `score: 0` parser fix exists to prevent.
if grep -q 'if \[ "\$a" = "design" \]; then' "$BENCH/run-bench.sh"; then pass "run-bench routes the design arm to grade-design"; else fail "run-bench sends the design arm to the outcome judge"; fi
# --plan-only stops at the gate on purpose, so done_at is legitimately absent.
if grep -q 'design_incomplete_at_' "$BENCH/run-bench.sh"; then pass "run-bench grades the design arm on reaching the gate"; else fail "run-bench would mark every design run incomplete (no done_at)"; fi
for t in "$BENCH"/tasks/*/; do
  tn="$(basename "$t")"
  [ -f "$t/design.txt" ] || { fail "task $tn: missing design.txt"; continue; }
  if grep -q -- '--plan-only' "$t/design.txt"; then pass "task $tn: design prompt is plan-only"; else fail "task $tn: design prompt would build code"; fi
done

# --- grade-design: the design arm's deterministic quality signal -------------
# The design arm produces no code, so there is nothing for the outcome judge to
# grade. This grader answers the one question a design set can be held to without
# a model: is it complete and self-consistent? Deterministic => no repeats, no
# variance, no tokens — which is what makes the fast arm worth having.
GRADER="$BENCH/grade-design.sh"
mk_design() {  # $1 dir  $2 tasks-body  — writes a lint-clean S/feat design set
  mkdir -p "$1/.workflow/0001-feat-x"
  _r="$1/.workflow/0001-feat-x"
  printf '{"id":"0001-feat-x","type":"feat","size":"S","field":"greenfield"}' > "$_r/state.json"
  printf '# Spec\n\n**Type**: feat\n\n## Goal\ng\n\n## User Stories\n- US1 as a user I want x\n\n## Acceptance\n- **AC1** — **Given** a, **When** b, **Then** c.\n- **AC2** — **Given** d, **When** e, **Then** f.\n\n## Functional Requirements\n- FR-001 x\n\n## Success Criteria\n- SC-001 y\n' > "$_r/spec.md"
  printf '# Plan\n\n**Type**: feat\n\n## Summary\ns\n\n```mermaid\nflowchart LR\n  A --> B\n```\n' > "$_r/plan.md"
  printf '%s' "$2" > "$_r/tasks.md"
  printf '# Test plan\n\n## Coverage plan\n\n| AC | Level | Asserts |\n|----|-------|---------|\n| AC1 | unit | x |\n| AC2 | unit | y |\n' > "$_r/test-plan.md"
}
DGOOD="$TMPROOT/design-good"
mk_design "$DGOOD" '# Tasks

- [x] T001 [AC1] do the thing — verify: the suite is green
- [x] T002 [AC2] do the other thing — verify: the suite is green
'
dg="$(sh "$GRADER" "$DGOOD" 2>/dev/null || true)"
assert_eq "grade-design: complete set scores 10" "10"   "$(printf '%s' "$dg" | jq -r '.score')"
assert_eq "grade-design: complete set passes"    "pass" "$(printf '%s' "$dg" | jq -r '.verdict')"
assert_eq "grade-design: counts every AC"        "2"    "$(printf '%s' "$dg" | jq -r '.ac_total')"

# An AC with no delivering task is the classic design hole — the pre-gate scan
# exists for it, so the grader must see it too.
DBAD="$TMPROOT/design-untasked"
mk_design "$DBAD" '# Tasks

- [x] T001 [AC1] do the thing — verify: the suite is green
'
db="$(sh "$GRADER" "$DBAD" 2>/dev/null || true)"
assert_eq "grade-design: an untasked AC is caught" "1"    "$(printf '%s' "$db" | jq -r '.ac_tasked')"
assert_eq "grade-design: and fails the verdict"    "fail" "$(printf '%s' "$db" | jq -r '.verdict')"
# A dir with no run at all is unjudgeable, not a zero — same rule as the outcome
# judge, so a broken harness never manufactures a quality failure.
sh "$GRADER" "$TMPROOT" >/dev/null 2>&1 && dgrc=0 || dgrc=$?
assert_eq "grade-design: no run dir is unjudgeable (exit 2)" "2" "$dgrc"

# --- mechanism: the fast structural check -----------------------------------
# Cost/wall/quality need repeats before they mean anything; spawn_count and the
# cycle counters do not (README: mechanism metrics are DETERMINISTIC). Splitting
# them out gives a check that is honest at --repeats 1, which is the difference
# between a 5-minute iteration and a 30-minute one.
mech_ok="$(sh "$CMP" --mechanism "$FIX/mech-before.jsonl" "$FIX/mech-before.jsonl" 2>&1)" && mech_rc=0 || mech_rc=$?
assert_eq "mechanism: identical rows pass" "0" "$mech_rc"
assert_contains "mechanism: says unchanged" "$mech_ok" "unchanged"
mech_bad="$(sh "$CMP" --mechanism "$FIX/mech-before.jsonl" "$FIX/mech-grew.jsonl" 2>&1)" && mech_bad_rc=0 || mech_bad_rc=$?
assert_eq "mechanism: a new review cycle FAILS" "1" "$mech_bad_rc"
assert_contains "mechanism: names the counter that grew" "$mech_bad" "cycles_review 0->1"
# The deliberate blind spot, pinned so nobody mistakes this for a verdict: it
# passes a run that got 9x more expensive and graded 3/fail, because judging that
# is --gain's and --ratchet's job and doing it here would reintroduce the need
# for medians — the exact cost this mode exists to avoid.
mech_blind="$(sh "$CMP" --mechanism "$FIX/mech-before.jsonl" "$FIX/mech-shrank.jsonl" 2>&1)" && mech_blind_rc=0 || mech_blind_rc=$?
assert_eq "mechanism: ignores cost and quality by design" "0" "$mech_blind_rc"
assert_contains "mechanism: reports a shrink as an improvement" "$mech_blind" "spawn_count 4->2"

# --- gain: the ratchet's mirror image ---------------------------------------
# --ratchet answers "did we get worse?" — it passes a run that costs 19% MORE.
# An optimisation pass needs the opposite question ("better by how much?"), and
# needs it to fail when a saving was bought with quality. Same ordering as
# --ratchet/--ab: a cheaper worse run is never a win.
gain_ok="$(sh "$CMP" --gain "$FIX/gain-before.jsonl" "$FIX/gain-after.jsonl" --target 0.5 2>&1)" && gain_rc=0 || gain_rc=$?
assert_eq "gain: a real 50%+ cut passes" "0" "$gain_rc"
assert_contains "gain: reports the per-task cost drop" "$gain_ok" "cost 1.00→0.40 (−60%)"
# A negative drop is an INCREASE and must read as such: the sign lives in pct(),
# because a hardcoded "−" prefix rendered a 1.5%% rise as "−-1.5%%".
regress="$(sh "$CMP" --gain "$FIX/gain-after.jsonl" "$FIX/gain-before.jsonl" 2>&1 || true)"
assert_contains "gain: an increase renders with a + sign" "$regress" "(+150%)"
assert_contains "gain: reports the per-task wall drop" "$gain_ok" "wall 1000→400s (−60%)"
# The suite line is what answers "did the LANE get cheaper", not just one task.
assert_contains "gain: reports a suite total"          "$gain_ok" "suite total:"
assert_contains "gain: suite pools both tasks"         "$gain_ok" "cost 3→1.3 (−56.7%)"

# Cheaper-but-worse must fail even at a huge saving — the whole point of the gate.
gain_bad="$(sh "$CMP" --gain "$FIX/gain-before.jsonl" "$FIX/gain-after-worse.jsonl" --target 0.5 2>&1)" && gain_bad_rc=0 || gain_bad_rc=$?
assert_eq "gain: 80% cheaper but judge 9→7 FAILS" "1" "$gain_bad_rc"
assert_contains "gain: names the quality regression" "$gain_bad" "quality regressed"
# …and it fails on quality with no --target too: the ordering is not opt-in.
sh "$CMP" --gain "$FIX/gain-before.jsonl" "$FIX/gain-after-worse.jsonl" >/dev/null 2>&1 && gain_nt_rc=0 || gain_nt_rc=$?
assert_eq "gain: quality gate applies without --target" "1" "$gain_nt_rc"

# A task with no usable row cannot be claimed as a win — "-100%" off a null is
# the same lie aggregate.sh's n_ok rule exists to prevent.
gain_un="$(sh "$CMP" --gain "$FIX/gain-before.jsonl" "$FIX/gain-after-unmeasured.jsonl" --target 0.5 2>&1)" && gain_un_rc=0 || gain_un_rc=$?
assert_eq "gain: an all-failed task FAILS the target" "1" "$gain_un_rc"
assert_contains "gain: says why it is uncomparable" "$gain_un" "no usable rows to compare"
# Missing the target on ONE axis is still a miss — the goal named cost AND wall.
gain_half="$(printf '%s\n' '{"task":"t1","arm":"workflow","repeat":1,"ok":true,"cost_usd":0.40,"wall_s":900,"judge_score":9,"judge_verdict":"pass"}' > "$TMPROOT/half.jsonl"; sh "$CMP" --gain "$FIX/gain-before.jsonl" "$TMPROOT/half.jsonl" --target 0.5 2>&1)" && gain_half_rc=0 || gain_half_rc=$?
assert_eq "gain: cost met but wall missed still FAILS" "1" "$gain_half_rc"

# --- runner arg parsing: --out keeps concurrent runs from clobbering ---------
# Two runners sharing results/scorecards.jsonl destroyed each other's rows once;
# --out is the fix, so its parsing is guarded here (dry-run: no tokens spent).
if sh "$BENCH/run-bench.sh" --dry-run --out "$TMP_OUT" --tasks 01-task-list >/dev/null 2>&1; then
  pass "run-bench accepts --out"
else
  fail "run-bench rejects --out (concurrent runs would clobber)"
fi
if sh "$BENCH/run-bench.sh" --dry-run --bogus-flag >/dev/null 2>&1; then
  fail "run-bench silently accepts an unknown flag"
else
  pass "run-bench rejects an unknown flag"
fi

# --- task lint: every benchmark task is well-formed BEFORE it costs money ----
# A malformed task (missing arm prompt, empty acceptance, a baseline prompt that
# secretly invokes the workflow) silently wastes a live run — several dollars and
# ~15 minutes each. These checks are free, so they run every time.
TASKS="$BENCH/tasks"
for d in "$TASKS"/*/; do
  [ -d "$d" ] || continue
  t="$(basename "$d")"
  for f in workflow.txt baseline.txt acceptance.txt; do
    if [ -s "$d$f" ]; then pass "task $t: has non-empty $f"; else fail "task $t: missing/empty $f"; fi
  done
  # The workflow arm must drive /dev, and headless needs the non-interactive gate.
  if grep -q '^/dev ' "$d/workflow.txt" 2>/dev/null; then pass "task $t: workflow prompt invokes /dev"; else fail "task $t: workflow prompt must start with '/dev '"; fi
  if grep -q -- '--yes' "$d/workflow.txt" 2>/dev/null; then pass "task $t: workflow prompt passes --yes"; else fail "task $t: workflow prompt needs --yes (headless gate would stall)"; fi
  # The baseline arm is the control: it must not INVOKE the workflow. Match the
  # invocation form (a line-initial `/dev `), not a mention — a task may legitimately
  # ask the deliverable to document `/dev` (e.g. the landing-site copy).
  if grep -qE '^[[:space:]]*/dev[[:space:]]' "$d/baseline.txt" 2>/dev/null; then fail "task $t: baseline prompt must not invoke /dev (control arm)"; else pass "task $t: baseline prompt does not invoke the workflow"; fi
  # And it must say so explicitly, so the control arm can't drift into using it.
  if grep -qi 'not use any workflow' "$d/baseline.txt" 2>/dev/null; then pass "task $t: baseline prompt states no-workflow"; else fail "task $t: baseline prompt should state 'do not use any workflow'"; fi
  # The prompt must NOT enumerate the acceptance criteria. README > "A task is only
  # useful if the baseline can fail it": `workflow.txt`/`baseline.txt` carry the
  # USER'S ASK, `acceptance.txt` carries the requirements the user never stated —
  # that gap is the entire thing being measured. A prompt listing its own ACs
  # measures transcription, not judgement, and both arms score ~10. Tasks 07-11
  # were written this way; 01-06 predate the rule and are grandfathered below.
  case "$t" in
    01-task-list|02-csv-format|03-form-validator|04-paginate|05-debounce|06-landing-site)
      : ;;   # grandfathered: known to enumerate ACs, kept only as a cost/latency floor
    *)
      for arm in workflow baseline; do
        if grep -qE '\bAC[0-9]' "$d/$arm.txt" 2>/dev/null; then
          fail "task $t: $arm.txt enumerates AC ids — measures transcription, not judgement"
        else
          pass "task $t: $arm.txt does not leak the acceptance criteria"
        fi
      done ;;
  esac

  # Acceptance is what both arms are judged against — it must carry criteria.
  if grep -qE '\bAC[0-9]' "$d/acceptance.txt" 2>/dev/null; then pass "task $t: acceptance lists AC ids"; else fail "task $t: acceptance has no AC ids"; fi
done

# --- the sandbox must never contain the bench itself ----------------------------
# `.claude/tests/bench/tasks/<t>/acceptance.txt` is the answer key, with the trap
# written out. Copying `.claude/` wholesale put it inside the workflow arm's own
# sandbox while the baseline arm (bare repo) never saw it — an asymmetry that
# inflates workflow quality scores and measures transcription, not judgement.
# Observed live: a run ran `cat .../tasks/11-recent-window/design.txt` and Read
# `acceptance.txt` out of its own tree.
if grep -q 'rm -rf "$s/.claude/tests"' "$HERE/../run-bench.sh"; then
  pass "run-bench.sh strips .claude/tests from the workflow sandbox"
else
  fail "run-bench.sh ships .claude/tests (answer keys) into the graded sandbox"
fi
if grep -q 'rm -rf "$sb/.claude/tests"' "$HERE/../profile-turns.sh"; then
  pass "profile-turns.sh strips .claude/tests from its sandbox"
else
  fail "profile-turns.sh ships .claude/tests into its sandbox"
fi

# --- the resolution floor is enforced, not advisory -----------------------------
# Three verdicts in one session were reported at -6.5%, -13% and -15%, adopted,
# and failed to reproduce; a fourth read -29% at n=6 and -20% at n=12. Each was
# under the smallest effect the sample could separate from noise. `--gain` now
# refuses to call such a delta a saving, and `--mde` sizes the run beforehand.
tmpd="$(mktemp -d)"; trap 'rm -rf "$tmpd"' EXIT
# Two arms with a real spread: a ~16% median drop that the noise cannot resolve.
{ echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":2.0,"wall_s":100,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
  echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":3.6,"wall_s":100,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
  echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":2.8,"wall_s":100,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
} > "$tmpd/base.jsonl"
{ echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":1.7,"wall_s":90,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
  echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":3.1,"wall_s":90,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
  echo '{"task":"t","arm":"workflow","ok":true,"cost_usd":2.35,"wall_s":90,"judge_score":9,"judge_verdict":"pass","turns":10,"spawn_count":0,"cycles_test":0,"cycles_review":0}'
} > "$tmpd/cur.jsonl"
out="$(sh "$HERE/../compare.sh" --gain "$tmpd/base.jsonl" "$tmpd/cur.jsonl" 2>&1 || true)"
if printf '%s' "$out" | grep -q 'UNRESOLVED'; then
  pass "gain flags a sub-MDE cost drop as UNRESOLVED"
else
  fail "gain reported a sub-MDE cost drop as a saving: $out"
fi
# With the guard off the same delta prints as a number — proving the guard, not the data, is what suppressed it.
out2="$(BENCH_MDE_OFF=1 sh "$HERE/../compare.sh" --gain "$tmpd/base.jsonl" "$tmpd/cur.jsonl" 2>&1 || true)"
if printf '%s' "$out2" | grep -q 'UNRESOLVED'; then
  fail "BENCH_MDE_OFF=1 did not disable the resolution guard"
else
  pass "BENCH_MDE_OFF=1 disables the guard for raw inspection"
fi
# --mde sizes the next run instead of guessing.
out3="$(sh "$HERE/../compare.sh" --mde "$tmpd/base.jsonl" 20 2>&1 || true)"
if printf '%s' "$out3" | grep -q 'repeats needed to resolve'; then
  pass "--mde reports the repeats needed for a target effect"
else
  fail "--mde did not report a required n: $out3"
fi
if printf '%s' "$out3" | grep -q 'UNDERPOWERED'; then
  pass "--mde warns when n is below the min-n guard"
else
  fail "--mde did not warn at n=3 (below BENCH_MIN_N=6): $out3"
fi
# The trimmed mean ships next to the median, and only once a trim is meaningful.
tm="$(sh "$HERE/../aggregate.sh" "$tmpd/base.jsonl" | jq -r '.[0].cost_trimmed')"
if [ "$tm" = "null" ]; then
  pass "trimmed mean is null below n=5 (a 1-from-each-end trim needs a middle)"
else
  fail "trimmed mean should be null at n=3, got $tm"
fi

# --- a halted run says WHY it halted --------------------------------------------
# `incomplete_at_*` conflated "stopped to ask a human" with "fell over". On the M
# lane one halted run had caught a real contradiction between the spec's rounding
# rule and its own acceptance criteria — the pipeline doing its job — and it read
# identically to four that merely ran out. The split needs the orchestrator to
# record the stop, so pin both halves.
if grep -q 'blocked_at_' "$HERE/../run-bench.sh"; then
  pass "run-bench distinguishes blocked_at_* from incomplete_at_*"
else
  fail "run-bench still reports every halt as incomplete_at_*"
fi
ORCHF="$HERE/../../../orchestrator.md"
if [ -f "$ORCHF" ]; then
  if grep -qF 'notes += "BLOCKED:' "$ORCHF"; then
    pass "orchestrator records a BLOCKED stop in state before halting"
  else
    fail "orchestrator halts on NON_INTERACTIVE_BLOCKER without recording it — the bench cannot tell why"
  fi
fi

# --- deterministic AC oracle (11-recent-window) --------------------------------
# judge-outcome.sh is a model: identical diffs have scored 9 and 4 on this suite,
# and one --keep run graded 9/pass while silently failing AC4 and AC5. The oracle
# replaces that guess with per-AC assertions and a SWE-bench FAIL_TO_PASS check
# (the shipped test must pass on the delivered tree AND fail once the original
# window.js is restored — a suite that stays green does not pin the bug).
#
# An unvalidated oracle is worse than no oracle, so it is pinned against four
# fixtures whose verdicts are known by construction. Free: no model, no tokens.
ORACLE="$HERE/../tasks/11-recent-window/oracle/run.sh"
FIX="$HERE/../fixtures/oracle-11"
if [ -f "$ORACLE" ] && [ -d "$FIX" ] && command -v node >/dev/null 2>&1; then
  oracle_score() { sh "$ORACLE" "$FIX/$1" 2>/dev/null | sed -n 's/.*"score":\([0-9]*\).*/\1/p'; }
  oracle_ac()    { sh "$ORACLE" "$FIX/$1" 2>/dev/null | grep -c "\"$2\":\"pass\""; }

  # A correct fix, in the right layer, with a test that pins the report.
  [ "$(oracle_score good)" = "6" ] \
    && pass "oracle scores a correct solution 6/6" \
    || fail "oracle scores the known-good fixture $(oracle_score good)/6 — it would reject real work"

  # The documented trap: guard bolted into feed.js, window.js untouched.
  [ "$(oracle_ac trap-feed AC2_right_layer)" = "0" ] \
    && pass "oracle catches the wrong-layer trap (guard in feed.js)" \
    || fail "oracle passes AC2 for a fix that never touched window.js"

  # A green suite that does not pin the reported case.
  [ "$(oracle_ac trap-feed AC1_regression_first)" = "0" ] \
    && pass "oracle catches a suite that stays green with the bug restored" \
    || fail "oracle's FAIL_TO_PASS check does not fail on an unpinning suite"

  # Right fix, no regression test at all.
  [ "$(oracle_ac no-test AC1_regression_first)" = "0" ] \
    && pass "oracle catches a fix shipped with no test" \
    || fail "oracle passes AC1 for a sandbox with no test file"

  # Collateral damage to dropLastN, which was already correct.
  [ "$(oracle_ac collateral AC3_no_collateral)" = "0" ] \
    && pass "oracle catches collateral damage to dropLastN" \
    || fail "oracle passes AC3 for a solution that broke dropLastN"

  # Everything except AC3 must still pass there — an oracle that fails everything
  # on one defect cannot tell a small regression from a wrong solution.
  [ "$(oracle_score collateral)" = "5" ] \
    && pass "oracle isolates the failing AC instead of collapsing the score" \
    || fail "oracle scored the collateral fixture $(oracle_score collateral)/6, expected 5"
fi

# --- deterministic AC oracle (13-money-drift) ----------------------------------
# Same contract as the 11- oracle, on a task with two live defects in five files.
# The first assertion is the one that matters most: an oracle that passes the
# UNFIXED seed is measuring nothing, and would silently bless every future run.
ORACLE13="$HERE/../tasks/13-money-drift/oracle/run.sh"
SEED13="$HERE/../tasks/13-money-drift/seed"
FIX13="$HERE/../fixtures/oracle-13"
if [ -f "$ORACLE13" ] && [ -d "$FIX13" ] && command -v node >/dev/null 2>&1; then
  o13_score() { sh "$ORACLE13" "$1" 2>/dev/null | sed -n 's/.*"score":\([0-9]*\).*/\1/p'; }
  o13_ac()    { sh "$ORACLE13" "$1" 2>/dev/null | grep -c "\"$2\":\"pass\""; }

  seedcopy="$(mktemp -d)"; cp -R "$SEED13/." "$seedcopy/" 2>/dev/null || true
  [ "$(o13_ac "$seedcopy" AC2_reconciles)" = "0" ] \
    && pass "oracle-13 fails the unfixed seed (both live defects detected)" \
    || fail "oracle-13 passes AC2 on the seed — it cannot detect the defect it grades"
  rm -rf "$seedcopy"

  [ "$(o13_score "$FIX13/good")" = "7" ] \
    && pass "oracle-13 scores a correct cents-discipline fix 7/7" \
    || fail "oracle-13 scores the known-good fixture $(o13_score "$FIX13/good")/7"

  # The documented trap: invoice() sums its own rounded lines, orderTotal untouched.
  [ "$(o13_ac "$FIX13/trap-invoice" AC1_right_layer)" = "0" ] \
    && pass "oracle-13 catches the invoice-sums-its-own-lines trap" \
    || fail "oracle-13 passes AC1 for a fix that left orderTotal wrong"

  # Trap 3: converted to cents but reinterpreted the stored dollar amounts.
  [ "$(o13_ac "$FIX13/trap-cents-misread" AC5_persisted_data)" = "0" ] \
    && pass "oracle-13 catches stored-precision loss in orders.json" \
    || fail "oracle-13 passes AC5 for a solution that lost orders.json precision"
fi

# --- deterministic AC oracle (12-contact-search) -------------------------------
# The hard one: the ask is "give them a way to search it", so the search function's
# name and signature are unspecified and the oracle has to DISCOVER it. The third
# assertion is the subtle one — the task's own trap (`c.name.includes(q)`) throws on
# the name:null row for every query, so a naive discovery pass sees nothing and
# reports "no search delivered", which is the wrong diagnosis for the same score.
ORACLE12="$HERE/../tasks/12-contact-search/oracle/run.sh"
FIX12="$HERE/../fixtures/oracle-12"
if [ -f "$ORACLE12" ] && [ -d "$FIX12" ] && command -v node >/dev/null 2>&1; then
  o12() { sh "$ORACLE12" "$FIX12/$1" 2>/dev/null; }

  [ "$(o12 good | sed -n 's/.*"score":\([0-9]*\).*/\1/p')" = "5" ] \
    && pass "oracle-12 scores a correct search 5/5" \
    || fail "oracle-12 rejects the known-good fixture"

  [ "$(o12 good | grep -c '"search":"contacts.js:searchContacts"')" = "1" ] \
    && pass "oracle-12 discovers an unspecified search export by behaviour" \
    || fail "oracle-12 could not find the search function in the known-good fixture"

  [ "$(o12 naive | grep -c '"search":null')" = "0" ] \
    && pass "oracle-12 reports a throwing search as broken, not missing" \
    || fail "oracle-12 mis-diagnoses the null-unsafe trap as 'no search delivered'"

  [ "$(o12 naive | grep -c '"AC2_null_safe":"pass"')" = "0" ] \
    && pass "oracle-12 catches the name:null crash" \
    || fail "oracle-12 passes AC2 for a search that throws on the null-name row"

  [ "$(o12 naive | grep -c '"AC5_match_is_tested":"pass"')" = "0" ] \
    && pass "oracle-12 catches a happy-path-only test suite" \
    || fail "oracle-12 passes AC5 for a suite that stays green against a naive search"

  [ "$(o12 no-search | grep -c '"search":null')" = "1" ] \
    && pass "oracle-12 reports a genuinely missing search as missing" \
    || fail "oracle-12 invented a search function in the no-search fixture"
fi

# ═══════════════════════════════════════════════════════════════════════════
# THE FOURTH AXIS — context
# ═══════════════════════════════════════════════════════════════════════════
# The scorecard measured quality, speed and cost and reasoned about context it
# never recorded. These pin the axis that closes that gap, and they cost nothing:
# context comes off a transcript the CLI writes anyway, so the whole axis is
# testable against a canned session with no live run and no tokens.
# $FIX is re-pointed at fixtures/oracle-11 further up; this block needs the
# top-level fixtures dir, so it carries its own name rather than restoring a
# variable another section owns.
FIXB="$BENCH/fixtures"
CTXM="$BENCH/context-metrics.sh"
TDIR="$FIXB/transcript-dedup"

# --- the dedup trap: one API request, many transcript entries ----------------
# The transcript writes ONE entry per content block — thinking, text and each
# tool_use — and every one of them carries the SAME usage object. The fixture is
# 3 real requests written as 5 main-session entries plus a 2-request sub-agent
# written as 3. Summing entries instead of requests reports 13,936 input tokens
# where the truth is 7,319: a 1.9x overstatement, on the axis whose whole purpose
# is to explain the cost column. `profile-turns.sh` documents the same trap for
# turn counting ("the count reads ~65% high"); this is the same bug with a bigger
# blast radius, so it gets an exact-value test rather than a range.
if [ -f "$TDIR/session.jsonl" ]; then
  ctx="$(sh "$CTXM" --transcript "$TDIR/session.jsonl" 2>/dev/null)"
  assert_eq "context: requests are deduped by requestId" "5" "$(printf '%s' "$ctx" | jq -r '.ctx_reqs')"
  # 3 main requests: (10+1000+0) + (5+2000+100) + (2+3000+0) = 1010+2105+3002 = 6117
  assert_eq "context: main in_total counts each request once" "6117" "$(printf '%s' "$ctx" | jq -r '.ctx_main_in_total')"
  # 2 sub-agent requests: (1+500) + (1+700) = 501 + 701 = 1202
  assert_eq "context: sub-agent sessions are included" "1202" "$(printf '%s' "$ctx" | jq -r '.ctx_agent_in_total')"
  assert_eq "context: in_total is main + agents" "7319" "$(printf '%s' "$ctx" | jq -r '.ctx_in_total')"

  # boot is the FIRST main request — the resident floor a change to the playbook
  # moves. It must not average in the sub-agents, whose prompts are smaller and
  # would hide the number.
  assert_eq "context: boot is the first MAIN request only" "1010" "$(printf '%s' "$ctx" | jq -r '.ctx_boot')"
  # peak spans every session (here the main session holds it).
  assert_eq "context: peak is the max across all sessions" "3002" "$(printf '%s' "$ctx" | jq -r '.ctx_peak')"
  assert_eq "context: mean is per-request, not per-entry" "2039" "$(printf '%s' "$ctx" | jq -r '.ctx_mean')"
  assert_eq "context: out_total sums output per request" "70" "$(printf '%s' "$ctx" | jq -r '.ctx_out_total')"
  # (1000+2000+3000) + (500+700) = 7200 of 7319
  assert_eq "context: cache_hit is the cached share of input" "0.984" "$(printf '%s' "$ctx" | jq -r '.ctx_cache_hit')"
  assert_eq "context: sub-agent sessions are counted" "1" "$(printf '%s' "$ctx" | jq -r '.ctx_agents')"
  assert_eq "context: sub-agent is labelled from its meta file" "lead-design-0001" \
    "$(printf '%s' "$ctx" | jq -r '.agents[0].label')"

  # A missing transcript is a normal outcome — a sandbox dropped without --keep,
  # a CLI that wrote nowhere. It must yield found=false with NULL metrics, never
  # zeros: a zero would enter the medians and report a run that carried no
  # context, which is not a thing that can happen.
  miss="$(sh "$CTXM" /nonexistent-sandbox-xyz 2>/dev/null || true)"
  assert_eq "context: missing transcript reports found=false" "false" "$(printf '%s' "$miss" | jq -r '.found')"
  assert_eq "context: missing transcript nulls the metrics (never 0)" "null" "$(printf '%s' "$miss" | jq -r '.ctx_in_total')"
  if printf '%s' "$miss" | jq -e . >/dev/null 2>&1; then
    pass "context: missing transcript still emits parseable JSON"
  else fail "context: missing transcript emitted non-JSON — a caller cannot record the miss"; fi
else
  fail "context: fixture $TDIR/session.jsonl is missing"
fi

# --- aggregate carries the context axis --------------------------------------
cagg="$(sh "$AGG" "$FIXB/ctx-before.jsonl")"
assert_eq "aggregate: ctx_boot median"     "48000"    "$(printf '%s' "$cagg" | jq -r '.[0].ctx_boot')"
assert_eq "aggregate: ctx_in_total median" "15000000" "$(printf '%s' "$cagg" | jq -r '.[0].ctx_in_total')"
assert_eq "aggregate: n_ctx counts rows with a measurement" "3" "$(printf '%s' "$cagg" | jq -r '.[0].n_ctx')"
# An unmeasured axis must read as absent, not as zero — the same rule the row
# level enforces, re-checked after the median folds three rows into one.
nagg="$(sh "$AGG" "$FIXB/ctx-before-noctx.jsonl")"
assert_eq "aggregate: no ctx rows => null, not 0" "null" "$(printf '%s' "$nagg" | jq -r '.[0].ctx_in_total')"
assert_eq "aggregate: no ctx rows => n_ctx 0"     "0"    "$(printf '%s' "$nagg" | jq -r '.[0].n_ctx')"

# --- the envelope fields that lie are no longer summarised -------------------
# `duration_ms` timed an 841s run at 72s (it cannot see sub-agent time) and
# `in_tokens` read 186 on a run that carried 14.4M. Both used to be medianned
# beside the honest wall_s with nothing marking which to trust. Speed is wall_s;
# tokens are ctx_*. If either name comes back into the aggregate output, some
# reader will quote it.
if printf '%s' "$cagg" | jq -e 'has("duration_ms") or .[0] | has("duration_ms")' >/dev/null 2>&1; then
  fail "aggregate: duration_ms is summarised again — it timed an 841s run at 72s"
else pass "aggregate: the envelope clock is not summarised as speed"; fi
if printf '%s' "$cagg" | jq -e '.[0] | has("out_tokens")' >/dev/null 2>&1; then
  fail "aggregate: out_tokens is summarised again — the envelope sees the top session only"
else pass "aggregate: envelope token fields are not summarised as tokens"; fi

# --- the ratchet guards context ---------------------------------------------
# ctx_boot is near-deterministic for a fixed tree, so it gets the tight band: a
# resident floor that grew is a playbook that grew, whether or not this
# particular run came in cheap.
if sh "$CMP" --ratchet "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-boot-grew.jsonl" >/dev/null 2>&1; then
  fail "ratchet: a 10% larger resident floor passed"
else pass "ratchet: FAILS when ctx_boot grows past the tolerance"; fi
out="$(sh "$CMP" --ratchet "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-boot-grew.jsonl" 2>&1 || true)"
assert_contains "ratchet: names ctx_boot as the regression" "$out" "ctx_boot"

# A guard that could not run must SAY so. Silence about an unevaluated guard is
# indistinguishable from a guard that passed, which is how a context regression
# ships against a baseline that predates the axis.
out="$(sh "$CMP" --ratchet "$FIXB/ctx-before-noctx.jsonl" "$FIXB/ctx-before.jsonl" 2>&1 || true)"
assert_contains "ratchet: names the guards it could not evaluate" "$out" "NOT GUARDED"

# --- quality is oracle-first -------------------------------------------------
# THE test for the quality axis. On 11-recent-window the judge scored twelve
# diffs 8-10 and passed all twelve while a deterministic oracle showed every one
# failing AC4 — and it ranked the plain baseline HIGHER than /dev on a task where
# both were objectively identical. So when both sides carry an oracle, the oracle
# gates: this fixture drops oracle 5->4 while RAISING judge 9->10, and a
# judge-driven ratchet would call that an improvement.
if sh "$CMP" --ratchet "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-oracle-drop.jsonl" >/dev/null 2>&1; then
  fail "ratchet: an oracle drop passed because the judge went up — the exact blindness this axis exists to fix"
else pass "ratchet: FAILS on an oracle drop even when the judge score rises"; fi
out="$(sh "$CMP" --ratchet "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-oracle-drop.jsonl" 2>&1 || true)"
assert_contains "ratchet: labels which grader decided" "$out" "quality[oracle]"

# With no oracle on either side the judge still gates — but the report must name
# it as an opinion, so a verdict cannot be quoted as "the criteria are met".
out="$(sh "$AGG" "$FIXB/before.jsonl" --table 2>&1 || true)"
assert_contains "aggregate: flags judge-only quality" "$out" "JUDGE ONLY"

# --- the oracle names WHICH criterion fails ---------------------------------
# "AC4 failed 6/6" is a finding; "quality 5/6" is a number. Surfacing the
# criterion is what turned the judge blindness from an anecdote into a fact.
oagg="$(sh "$AGG" "$FIXB/oracle-blind.jsonl")"
assert_eq "aggregate: oracle median over 6 runs" "5" "$(printf '%s' "$oagg" | jq -r '.[0].oracle_score')"
assert_eq "aggregate: oracle max ships with the score" "6" "$(printf '%s' "$oagg" | jq -r '.[0].oracle_max')"
assert_eq "aggregate: oracle pass rate is 0 despite judge 9" "0" "$(printf '%s' "$oagg" | jq -r '.[0].oracle_pass_rate')"
assert_eq "aggregate: judge still recorded beside it" "9" "$(printf '%s' "$oagg" | jq -r '.[0].judge_score')"
assert_eq "aggregate: the failing criterion is named and counted" "6" \
  "$(printf '%s' "$oagg" | jq -r '.[0].oracle_fail_acs.AC4_no_fractional')"
out="$(sh "$AGG" "$FIXB/oracle-blind.jsonl" --table 2>&1 || true)"
assert_contains "aggregate: prints the failing criteria line" "$out" "failing criteria"
# A task with no oracle must not be reported as one that failed its oracle.
assert_eq "aggregate: absent oracle is null, not a failure" "null" \
  "$(sh "$AGG" "$FIXB/before.jsonl" | jq -r '.[0].oracle_score')"
assert_eq "aggregate: absent oracle contributes no pass rate" "null" \
  "$(sh "$AGG" "$FIXB/before.jsonl" | jq -r '.[0].oracle_pass_rate')"

# ═══════════════════════════════════════════════════════════════════════════
# `blocked` IS THE PIPELINE SUCCEEDING
# ═══════════════════════════════════════════════════════════════════════════
# A /dev run that halts to ask a human about a real contradiction does the one
# thing a plain prompt cannot — and it used to score exactly like a crash, which
# is why README says "the harness cannot currently observe /dev succeeding at its
# actual job". It still stays out of the medians (no delivered code to grade) but
# it now has its own count, and it is NOT in the failure tally.
bagg="$(sh "$AGG" "$FIXB/outcome-blocked.jsonl")"
assert_eq "blocked: counted in its own column" "1" "$(printf '%s' "$bagg" | jq -r '.[0].n_blocked')"
assert_eq "blocked: still excluded from the medians" "1" "$(printf '%s' "$bagg" | jq -r '.[0].n_ok')"
assert_eq "blocked: NOT listed as a failure reason" "null" \
  "$(printf '%s' "$bagg" | jq -r '.[0].fail_reasons.blocked_at_implement // "null"')"
assert_eq "blocked: a real failure IS still listed" "1" \
  "$(printf '%s' "$bagg" | jq -r '.[0].fail_reasons.timeout')"
out="$(sh "$AGG" "$FIXB/outcome-blocked.jsonl" --table 2>&1 || true)"
assert_contains "blocked: the table says it is not a failure" "$out" "not a failure"

# Rows recorded before `outcome` existed must classify the same way, or the whole
# recorded history of this suite keeps reading its own design-phase wins as crashes.
lagg="$(sh "$AGG" "$FIXB/outcome-legacy-blocked.jsonl")"
assert_eq "blocked: derived from fail_reason on legacy rows" "1" "$(printf '%s' "$lagg" | jq -r '.[0].n_blocked')"
assert_eq "blocked: legacy blocked row is not a failure either" "null" "$(printf '%s' "$lagg" | jq -r '.[0].fail_reasons')"

# --- run-bench classifies the outcome in one place --------------------------
# The mapping lives in classify_outcome(); check the source states it rather than
# spawning a live run. A `blocked_*` reason that stopped mapping to `blocked`
# would silently restore the old conflation.
RB="$BENCH/run-bench.sh"
assert_file_contains "run-bench: has one outcome classifier" "$RB" "classify_outcome()"
assert_file_contains "run-bench: blocked_at_* maps to blocked" "$RB" "blocked_at_*)         printf 'blocked'"
assert_file_contains "run-bench: calls the oracle, not just the judge" "$RB" "grade-oracle.sh"
assert_file_contains "run-bench: measures context every run" "$RB" "context-metrics.sh"
assert_file_contains "run-bench: warns when the two graders disagree" "$RB" "graders DISAGREE"
# The envelope's token/clock fields must stay under names nobody can misread.
assert_file_contains "run-bench: envelope clock is renamed, not trusted" "$RB" "envelope_ms:"
assert_file_contains "run-bench: envelope tokens are renamed, not trusted" "$RB" "envelope_in_tokens:"
# Provenance: a row that cannot name its own sandbox cannot be re-measured, which
# is why every pre-existing baseline needs a guess to recover its context.
assert_file_contains "run-bench: records the sandbox for later re-measurement" "$RB" "sandbox:(if \$sandbox"

# --- gain reports context beside cost ---------------------------------------
# A cost saving whose context did not move has no mechanism behind it, and on a
# suite whose resolution floor is ~23% that is usually noise. The report says so.
out="$(sh "$CMP" --gain "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-cost-only.jsonl" 2>&1 || true)"
assert_contains "gain: reports the context delta" "$out" "in_total"
assert_contains "gain: flags a cost drop that context does not explain" "$out" "suspect noise"
out="$(sh "$CMP" --gain "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-real-saving.jsonl" 2>&1 || true)"
assert_contains "gain: a context-backed saving is not flagged" "$out" "gain: PASS"

# --- --context separates "read less" from "did less" ------------------------
# Three numbers, one story. rationale.md records a change that cut ~26 KB of
# resident instructions and raised cost 16.4%: boot fell, in_total rose because
# the run took more turns. A guard watching only boot would have called it a win,
# so the mode must name that shape explicitly.
out="$(sh "$CMP" --context "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-relocated.jsonl" 2>&1 || true)"
assert_contains "context mode: names a relocated saving" "$out" "relocated, not made"
out="$(sh "$CMP" --context "$FIXB/ctx-before.jsonl" "$FIXB/ctx-after-real-saving.jsonl" 2>&1 || true)"
assert_contains "context mode: names a real saving" "$out" "real context saving"
out="$(sh "$CMP" --context "$FIXB/ctx-before-noctx.jsonl" "$FIXB/ctx-before.jsonl" 2>&1 || true)"
assert_contains "context mode: refuses to compare against an unmeasured side" "$out" "NOT MEASURED"

# ═══════════════════════════════════════════════════════════════════════════
# THE ROW ITSELF — run the runner behind a `claude` stub
# ═══════════════════════════════════════════════════════════════════════════
# Everything above tests the math over hand-written rows. Nothing tested that
# run-bench.sh still PRODUCES those rows, and `emit()` now merges four blocks
# (base fields + context + oracle + outcome) with five values arriving as globals.
# A broken emit yields an empty scorecard, which looks exactly like a run that
# failed — after 30 minutes and real money. This drives the whole path with a stub
# on PATH: no tokens, no network, one row out.
if command -v jq >/dev/null 2>&1; then
  STUB2="$TMPROOT/stub2"; mkdir -p "$STUB2"
  # Two callers, two behaviours. `--output-format json` is the run itself: write a
  # file so there is a diff to grade, then print a well-formed envelope. Anything
  # else is judge-outcome.sh asking for a grade on stdin.
  cat > "$STUB2/claude" <<'STUB'
#!/bin/sh
case " $* " in
  *" --output-format json "*)
    echo "module.exports = function(){ return []; };" > solution.js
    printf '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":1.23,"num_turns":7,"duration_ms":4567,"usage":{"input_tokens":11,"output_tokens":222}}\n'
    ;;
  *)
    cat > /dev/null
    printf '{"score":8,"subscores":{"fit":8},"verdict":"pass","notes":"stub"}\n'
    ;;
esac
STUB
  chmod +x "$STUB2/claude"
  ROW="$TMPROOT/row.jsonl"
  # baseline arm: a bare sandbox, so no .claude copy and no state.json to read —
  # the smallest path that still exercises envelope parse, judge, context and emit.
  ( PATH="$STUB2:$PATH"; export PATH
    sh "$BENCH/run-bench.sh" --run --tasks 01-task-list --arm baseline --repeats 1 \
      --out "$ROW" ) >"$TMPROOT/row.log" 2>&1 || true

  if [ -s "$ROW" ]; then
    pass "run-bench: emits a scorecard row end to end"
    n_rows="$(grep -c '' "$ROW" 2>/dev/null || echo 0)"
    assert_eq "run-bench: exactly one row for one run" "1" "$n_rows"
    if jq -e . "$ROW" >/dev/null 2>&1; then pass "run-bench: the row is valid JSON"
    else fail "run-bench: emitted malformed JSON — $(cat "$ROW")"; fi

    # Cost and speed come from the two different clocks on purpose.
    assert_eq "row: cost from the envelope"      "1.23" "$(jq -r '.cost_usd' "$ROW")"
    assert_eq "row: turns from the envelope"     "7"    "$(jq -r '.turns' "$ROW")"
    assert_eq "row: outcome word present"        "ok"   "$(jq -r '.outcome' "$ROW")"
    assert_eq "row: judge score parsed"          "8"    "$(jq -r '.judge_score' "$ROW")"
    # 01-task-list has no oracle — that must read as absent, never as failed.
    assert_eq "row: no oracle => null, not a failure" "null" "$(jq -r '.oracle_score' "$ROW")"
    # No transcript exists for a stubbed sandbox, so context is honestly absent.
    # This is the null path in a REAL row rather than a hand-written fixture.
    assert_eq "row: unmeasured context is null"  "null" "$(jq -r '.ctx_in_total' "$ROW")"
    # Provenance: without this the row cannot be re-measured later, which is the
    # defect every pre-existing baseline in this repo has.
    if [ "$(jq -r '.sandbox // "null"' "$ROW")" = "null" ]; then
      fail "row: no sandbox recorded — the context axis cannot be recovered for this row"
    else pass "row: records its own sandbox path"; fi
    if [ "$(jq -r '.started_at // "null"' "$ROW")" = "null" ]; then
      fail "row: no started_at recorded"
    else pass "row: records when it started"; fi

    # The envelope's misleading fields must be present under their honest names
    # and ABSENT under the names that invite misreading.
    assert_eq "row: envelope clock kept as envelope_ms" "4567" "$(jq -r '.envelope_ms' "$ROW")"
    if jq -e 'has("duration_ms")' "$ROW" >/dev/null 2>&1; then
      fail "row: duration_ms is back — it timed an 841s run at 72s"
    else pass "row: no duration_ms field to mistake for the run duration"; fi
    if jq -e 'has("in_tokens")' "$ROW" >/dev/null 2>&1; then
      fail "row: in_tokens is back — the envelope reported 186 on a 14.4M-token run"
    else pass "row: no in_tokens field to mistake for the token truth"; fi
    assert_eq "row: envelope tokens kept for forensics" "11" "$(jq -r '.envelope_in_tokens' "$ROW")"
  else
    fail "run-bench: produced NO row behind the stub — see $TMPROOT/row.log"
  fi
fi

# --- the diagnostics stopped needing a paid run -----------------------------
# profile-turns.sh used to spend a FULL live run purely to see a tool inventory
# the transcript of an earlier run already contained. It reads that file now.
# The jq here is worth pinning for a reason that bit once: in jq,
# `EXPR | length as $v | BODY` runs BODY with `.` set to EXPR's OUTPUT, so an
# unparenthesised binding rebinds `.` to the array of requestIds and every later
# filter indexes strings. The fixture transcript exercises the whole path.
PT="$BENCH/profile-turns.sh"
assert_file_contains "profile-turns: has a free transcript mode" "$PT" "--transcript)"
assert_file_contains "profile-turns: has a free sandbox mode" "$PT" "--sandbox)"
assert_file_contains "profile-turns: warns that live mode costs a run" "$PT" "LIVE mode"
pt="$(sh "$PT" --transcript "$TDIR/session.jsonl" 2>&1 || true)"
assert_contains "profile-turns: free mode runs without a live call" "$pt" "from transcript"
# 3 unique requestIds in the fixture — NOT the 5 assistant entries.
assert_contains "profile-turns: round-trips are deduped API requests" "$pt" "re-sends): 3"
if printf '%s' "$pt" | grep -q "jq: error"; then
  fail "profile-turns: free mode emitted a jq error — the \`as\` binding rebound '.'"
else pass "profile-turns: free mode parses the transcript cleanly"; fi

# --- run-parallel rows are distinguishable ----------------------------------
# Every child ran with `--repeats 1`, so all merged rows carried `repeat: 1` and
# named their sandbox `<task>-<arm>-1`. Three rows from three different sandboxes
# were identical in the scorecard, which is also why backfill has to guess.
assert_file_contains "run-bench: accepts a repeat base" "$BENCH/run-bench.sh" "--repeat-base)"
assert_file_contains "run-parallel: stamps a distinct repeat per child" "$BENCH/run-parallel.sh" '--repeat-base "$i"'

# --- backfill recovers the axis without spending a run ---------------------
# Every baseline in this repo predates ctx_*, and those runs left transcripts on
# disk. Backfill reads them. The rule that matters is that it REFUSES to guess:
# a dozen directories match `…-11-recent-window-workflow-1` because that
# task/arm/repeat was run over and over, and filling one row from another
# session's transcript is the same class of error as README > "Re-baseline before
# crediting yourself with someone else's numbers".
BFL="$BENCH/backfill-context.sh"
assert_file_exists "backfill: script ships" "$BFL"
assert_file_contains "backfill: tags how each row was matched" "$BFL" "ctx_source"
assert_file_contains "backfill: the guess is opt-in and labelled" "$BFL" "mtime-heuristic"
assert_file_contains "backfill: keeps the original scorecard" "$BFL" ".pre-context.bak"
# Report-only by default: a measurement record must not change because someone
# ran a diagnostic over it.
bf_tmp="$TMPROOT/bf.jsonl"; cp "$FIXB/ctx-before-noctx.jsonl" "$bf_tmp"
before_sum="$(cksum < "$bf_tmp")"
sh "$BFL" "$bf_tmp" >/dev/null 2>&1 || true
assert_eq "backfill: default run does not modify the file" "$before_sum" "$(cksum < "$bf_tmp")"

finish "benchmark tests"
