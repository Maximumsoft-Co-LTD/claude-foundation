#!/usr/bin/env sh
# run-all.sh — single entry point for the whole workflow test harness.
#
# Runs every deterministic suite in order and reports a combined verdict. The
# live e2e suite is OFF by default (it costs tokens and needs the `claude` CLI);
# set CLAUDE_E2E=1 to include it.
#
#   sh .claude/tests/run-all.sh              # deterministic suites only
#   CLAUDE_E2E=1 sh .claude/tests/run-all.sh # + live /dev e2e smoke
#
# Dependency: jq (the hook + scenario suites use it; without it the hook suite
# reports SKIP as a nonzero exit and this runner marks it failed).

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

fail=0
run() {  # $1 = label, $2 = script, $3.. = args
  label="$1"; script="$2"; shift 2
  echo "══════════════════════════════════════════════════════════"
  echo "▶ $label"
  echo "══════════════════════════════════════════════════════════"
  if sh "$script" "$@"; then
    echo "✓ $label"
  else
    echo "✗ $label" >&2
    fail=1
  fi
  echo
}

run "hooks"            "$ROOT/.claude/hooks/tests/run-hook-tests.sh"
run "artifact-lint"    "$ROOT/.claude/hooks/tests/run-artifact-lint-tests.sh"
run "scenarios"        "$HERE/scenarios/run-scenario-tests.sh"
run "doc-consistency"  "$HERE/docs/run-doc-consistency.sh"
run "bench-logic"      "$HERE/bench/tests/run-bench-tests.sh"
run "ledger"           "$HERE/ledger/run-ledger-tests.sh"
run "interview"        "$HERE/interview/run-interview-tests.sh"

if [ "${CLAUDE_E2E:-0}" = "1" ]; then
  run "e2e (live)"     "$HERE/e2e/run-e2e.sh" --run
else
  echo "▶ e2e (live) — SKIPPED. Set CLAUDE_E2E=1 to run live /dev scenarios (costs tokens)."
  echo "    Preview the plan with: sh $HERE/e2e/run-e2e.sh"
  echo
fi

# The interview replay is a SEPARATE live opt-in from e2e, deliberately. e2e runs
# fully-specified prompts that suppress the interview; the replay runs vague ones
# that force it and answers from a recorded bank, so the two exercise opposite
# halves of Phase 1 and one is not a substitute for the other.
if [ "${CLAUDE_REPLAY:-0}" = "1" ]; then
  run "interview replay (live)" "$HERE/interview/run-replay.sh" --run
else
  echo "▶ interview replay (live) — SKIPPED. Set CLAUDE_REPLAY=1 to drive a real interview + gate (costs tokens)."
  echo "    Preview the plan with: sh $HERE/interview/run-replay.sh"
  echo "    Test the gate's reject path with: sh $HERE/interview/run-replay.sh --run --gate reject"
  echo
fi

echo "══════════════════════════════════════════════════════════"
if [ "$fail" -eq 0 ]; then
  echo "workflow tests: ALL SUITES PASS"
  exit 0
else
  echo "workflow tests: SOME SUITES FAILED" >&2
  exit 1
fi
