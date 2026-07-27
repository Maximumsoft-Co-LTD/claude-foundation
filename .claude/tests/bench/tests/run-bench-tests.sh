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
