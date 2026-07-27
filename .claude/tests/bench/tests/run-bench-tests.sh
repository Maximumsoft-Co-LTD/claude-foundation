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

finish "benchmark tests"
