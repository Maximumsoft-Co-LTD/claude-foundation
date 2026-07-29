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
  # Acceptance is what both arms are judged against — it must carry criteria.
  if grep -qE '\bAC[0-9]' "$d/acceptance.txt" 2>/dev/null; then pass "task $t: acceptance lists AC ids"; else fail "task $t: acceptance has no AC ids"; fi
done

finish "benchmark tests"
