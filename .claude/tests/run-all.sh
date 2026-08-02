#!/usr/bin/env sh
# Deterministic verification for the OpenSpec-native harness.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
failed=0

run() {
  label="$1"; shift
  printf '▶ %s\n' "$label"
  if "$@"; then printf '✓ %s\n\n' "$label"
  else printf '✗ %s\n\n' "$label" >&2; failed=1
  fi
}

run "runtime syntax" node --check "$ROOT/.claude/harness/foundation.mjs"
run "context budgets" sh "$HERE/harness/run-context-budget-tests.sh"
run "agent contracts" sh "$HERE/harness/run-agent-contract-tests.sh"
run "packet scaling" sh "$HERE/harness/run-packet-scaling-tests.sh"
run "telemetry concurrency" sh "$HERE/harness/run-telemetry-concurrency-tests.sh"
run "upgrade compatibility" sh "$HERE/harness/run-upgrade-compat-tests.sh"
run "feedback isolation" sh "$HERE/harness/run-feedback-isolation-tests.sh"
run "feedback review" sh "$HERE/harness/run-feedback-review-tests.sh"
run "harness contracts" sh "$HERE/harness/run-harness-tests.sh"
run "installer smoke" sh "$HERE/harness/run-installer-tests.sh"
run "current hook contracts" sh "$HERE/hooks/run-hook-tests.sh"
run "dashboard contracts" npm --prefix "$ROOT/dashboard" test

if [ "$failed" -eq 0 ]; then
  echo "foundation tests: ALL SUITES PASS"
  exit 0
fi
echo "foundation tests: SOME SUITES FAILED" >&2
exit 1
