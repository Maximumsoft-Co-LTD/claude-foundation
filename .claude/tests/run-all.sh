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
run "composition-root wiring" sh "$HERE/harness/run-wiring-tests.sh"
run "single-source tables" node "$HERE/harness/run-single-source-tests.mjs"
run "context budgets" sh "$HERE/harness/run-context-budget-tests.sh"
run "agent contracts" sh "$HERE/harness/run-agent-contract-tests.sh"
run "human interaction contracts" sh "$HERE/interview/run-interview-tests.sh"
run "workflow documentation contracts" sh "$HERE/docs/run-doc-consistency.sh"
run "packet scaling" sh "$HERE/harness/run-packet-scaling-tests.sh"
run "telemetry concurrency" sh "$HERE/harness/run-telemetry-concurrency-tests.sh"
run "upgrade compatibility" sh "$HERE/harness/run-upgrade-compat-tests.sh"
run "feedback isolation" sh "$HERE/harness/run-feedback-isolation-tests.sh"
run "feedback review" sh "$HERE/harness/run-feedback-review-tests.sh"
run "harness contracts" sh "$HERE/harness/run-harness-tests.sh"
run "installer smoke" sh "$HERE/harness/run-installer-tests.sh"
run "current hook contracts" sh "$HERE/hooks/run-hook-tests.sh"
run "phase mutation guard" sh "$HERE/hooks/run-phase-mutation-guard-tests.sh"
run "instruction contracts" sh "$HERE/harness/run-instruction-contract-tests.sh"
run "instruction provenance and host execution" sh "$HERE/harness/run-provenance-contract-tests.sh"
run "bounded infrastructure retry" node "$HERE/harness/run-bounded-retry-tests.mjs"
run "blocked decision contracts" node "$HERE/harness/run-blocked-decision-tests.mjs"
run "next-step contracts" node "$HERE/harness/run-next-step-tests.mjs"
run "workspace surface" node "$HERE/harness/run-workspace-surface-tests.mjs"
run "proof loop end to end" sh "$HERE/harness/run-proof-loop-tests.sh"
run "change loop seams" sh "$HERE/harness/run-changeloop-seam-tests.sh"
run "openspec version policy" node "$HERE/harness/run-openspec-version-tests.mjs"
run "model tier drift" node "$HERE/harness/run-model-drift-tests.mjs"
run "model tier drift join" node "$HERE/harness/run-model-drift-join-tests.mjs"
run "model drift land gate" node "$HERE/harness/run-drift-gate-tests.mjs"
run "spec sync verification" node "$HERE/harness/run-spec-sync-verify-tests.mjs"
run "spec sync land gate" sh "$HERE/harness/run-specsync-gate-tests.sh"
run "dashboard contracts" npm --prefix "$ROOT/dashboard" test

if [ "$failed" -eq 0 ]; then
  echo "foundation tests: ALL SUITES PASS"
  exit 0
fi
echo "foundation tests: SOME SUITES FAILED" >&2
exit 1
