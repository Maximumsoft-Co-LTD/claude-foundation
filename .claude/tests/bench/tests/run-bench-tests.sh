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

echo "Running benchmark self-test..."
echo

# --- aggregate: medians over the 3 'before' repeats -------------------------
agg="$(sh "$AGG" "$FIX/before.jsonl")"
assert_eq "aggregate n"           "3"    "$(printf '%s' "$agg" | jq -r '.[0].n')"
# jq 1.7 preserves number literals (0.10 stays 0.10), so compare numerically.
if printf '%s' "$agg" | jq -e '.[0].cost_usd == 0.10' >/dev/null; then pass "aggregate cost median (== 0.10)"; else fail "aggregate cost median — expected 0.10, got $(printf '%s' "$agg" | jq -r '.[0].cost_usd')"; fi
assert_eq "aggregate spawn median" "5"   "$(printf '%s' "$agg" | jq -r '.[0].spawn_count')"
assert_eq "aggregate judge median" "8"   "$(printf '%s' "$agg" | jq -r '.[0].judge_score')"

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
