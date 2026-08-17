#!/usr/bin/env sh
# Deterministic verification for the OpenSpec-native harness.
#
# Suites run concurrently. Every suite builds its own fixture under `mktemp -d`
# and touches nothing in this repository, so nothing orders them — running them
# one at a time spent most of the wall clock with the machine idle.
#
# The exception is marked `!` in the table below. A mutation suite deliberately
# corrupts a file under `.claude/harness/` and restores it, so anything running
# beside it reads a source that is briefly wrong and fails for a reason that has
# nothing to do with it. Those run alone, after the rest.
#
# Output is buffered per suite and replayed in table order, so a parallel run
# reads exactly like a serial one and stays diffable. `FOUNDATION_TEST_JOBS`
# overrides the pool size; 1 restores fully serial execution.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# label|command — `!` prefixes a label that must run with the repository to
# itself. Commands are expanded by the child with $HERE and $ROOT in scope.
#
# Shared rows are listed longest-first: xargs hands them to the pool in table
# order, and starting the long suites first keeps the pool packed instead of
# leaving a long tail behind a late-started slow suite. Replay order below
# follows the same table, so the printed report order matches.
suites() {
  cat <<'TABLE'
harness contracts (evidence proof)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof
change loop seams|sh "$HERE/harness/run-changeloop-seam-tests.sh"
feedback review|sh "$HERE/harness/run-feedback-review-tests.sh"
installer smoke|sh "$HERE/harness/run-installer-tests.sh"
host instruction contract|node --test "$HERE/harness/run-host-instruction-tests.mjs"
harness contracts (sandbox land)|sh "$HERE/harness/run-harness-tests.sh" sandbox-land
harness contracts (change policy)|sh "$HERE/harness/run-harness-tests.sh" change-policy
harness contracts (topology planning)|sh "$HERE/harness/run-harness-tests.sh" multi-repository planning-diagnostics
feedback isolation|sh "$HERE/harness/run-feedback-isolation-tests.sh"
spec sync land gate|sh "$HERE/harness/run-specsync-gate-tests.sh"
apply conflict|node --test "$HERE/harness/run-apply-conflict-tests.mjs"
archive telemetry|node --test "$HERE/harness/run-archive-telemetry-tests.mjs"
proof loop end to end|sh "$HERE/harness/run-proof-loop-tests.sh"
proof service lifecycle|node "$HERE/harness/run-service-session-tests.mjs"
stale recovery hints|node --test "$HERE/harness/run-stale-recovery-tests.mjs"
workspace surface|node "$HERE/harness/run-workspace-surface-tests.mjs"
target drift|sh "$HERE/harness/run-target-drift-tests.sh"
branch warning|node --test "$HERE/harness/run-branch-warning-tests.mjs"
packet scaling|sh "$HERE/harness/run-packet-scaling-tests.sh"
upgrade compatibility|sh "$HERE/harness/run-upgrade-compat-tests.sh"
dashboard contracts|npm --prefix "$ROOT/dashboard" test
runtime syntax|node --check "$ROOT/.claude/harness/foundation.mjs"
composition-root wiring|sh "$HERE/harness/run-wiring-tests.sh"
architecture boundaries|node "$HERE/harness/run-architecture-tests.mjs"
single-source tables|node "$HERE/harness/run-single-source-tests.mjs"
context budgets|sh "$HERE/harness/run-context-budget-tests.sh"
agent contracts|sh "$HERE/harness/run-agent-contract-tests.sh"
human interaction contracts|sh "$HERE/interview/run-interview-tests.sh"
workflow documentation contracts|sh "$HERE/docs/run-doc-consistency.sh"
user guidance contracts|sh "$HERE/harness/run-user-guidance-tests.sh"
telemetry concurrency|sh "$HERE/harness/run-telemetry-concurrency-tests.sh"
telemetry truth|node --test "$HERE/harness/run-telemetry-truth-tests.mjs"
v3.3 review policy|node "$HERE/harness/run-v33-policy-tests.mjs"
risk-tiered review contract|node "$HERE/harness/run-risk-tiered-review-tests.mjs"
risk-tiered review mutation|node "$HERE/harness/run-risk-tiered-review-mutation.mjs"
configured reviewer adapters|node "$ROOT/.claude/harness/tests/configured-reviewer.test.mjs"
external operation handoff|node "$ROOT/.claude/harness/tests/handoff-policy.test.mjs"
bounded review repair closure|node "$ROOT/.claude/harness/tests/review-repair-closure.test.mjs"
review guard reconciliation|node "$HERE/harness/run-review-guard-fix-tests.mjs"
current hook contracts|sh "$HERE/hooks/run-hook-tests.sh"
phase mutation guard|sh "$HERE/hooks/run-phase-mutation-guard-tests.sh"
instruction contracts|sh "$HERE/harness/run-instruction-contract-tests.sh"
instruction provenance and host execution|sh "$HERE/harness/run-provenance-contract-tests.sh"
bounded infrastructure retry|node "$HERE/harness/run-bounded-retry-tests.mjs"
blocked decision contracts|node "$HERE/harness/run-blocked-decision-tests.mjs"
next-step contracts|node "$HERE/harness/run-next-step-tests.mjs"
land surface|node --test "$HERE/harness/run-land-surface-tests.mjs"
dag cycle diagnostics|node --test "$HERE/harness/run-dag-cycle-tests.mjs"
proof fixit recovery|node --test "$HERE/harness/run-proof-fixit-tests.mjs"
openspec version policy|node "$HERE/harness/run-openspec-version-tests.mjs"
model tier drift|node "$HERE/harness/run-model-drift-tests.mjs"
model tier drift join|node "$HERE/harness/run-model-drift-join-tests.mjs"
model drift land gate|node "$HERE/harness/run-drift-gate-tests.mjs"
spec sync verification|node "$HERE/harness/run-spec-sync-verify-tests.mjs"
!land surface mutation|sh "$HERE/harness/run-land-surface-mutation.sh"
!target drift mutation|sh "$HERE/harness/run-target-drift-mutation.sh"
!evidence binding mutation|sh "$HERE/harness/run-evidence-binding-mutation.sh"
TABLE
}

nth() { suites | sed -n "${1}p"; }
label_of() { _l="${1%%|*}"; printf '%s' "${_l#!}"; }
exclusive() { case "$1" in !*) return 0 ;; *) return 1 ;; esac; }

# One suite, into its own buffer. Re-entered as a child so the pool below can be
# a plain `xargs -P`; nothing else calls this form.
if [ "${1:-}" = "--suite" ]; then
  index="$2"; work="$3"
  line="$(nth "$index")"
  if eval "${line#*|}" > "$work/$index.out" 2>&1
  then echo 0 > "$work/$index.status"
  else echo 1 > "$work/$index.status"
  fi
  exit 0
fi

pool_size() {
  [ -n "${FOUNDATION_TEST_JOBS:-}" ] && { echo "$FOUNDATION_TEST_JOBS"; return; }
  cores="$( { nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null; } | head -1 )"
  case "$cores" in "" | *[!0-9]*) cores=4 ;; esac
  [ "$cores" -gt 12 ] && cores=12
  [ "$cores" -lt 1 ] && cores=1
  echo "$cores"
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
TOTAL="$(suites | wc -l | tr -d ' ')"
JOBS="$(pool_size)"

shared=""
alone=""
index=1
while [ "$index" -le "$TOTAL" ]; do
  if exclusive "$(nth "$index")"; then alone="$alone $index"; else shared="$shared $index"; fi
  index=$((index + 1))
done

printf '%s\n' $shared | xargs -P "$JOBS" -I@ sh "$0" --suite @ "$WORK"

# The mutation suites prove their detector suites pass before injecting a
# fault. The pool just ran those detectors against the same unmutated tree in
# hermetic fixtures, so re-running them as baselines only repeats work. Vouch
# for each detector row that passed; a mutation script skips its baseline when
# its detector's token is present and runs it in full when invoked standalone.
vouch() {
  _vouch_index=1
  while [ "$_vouch_index" -le "$TOTAL" ]; do
    if [ "$(label_of "$(nth "$_vouch_index")")" = "$1" ] &&
       [ "$(cat "$WORK/$_vouch_index.status" 2>/dev/null || echo 1)" -eq 0 ]; then
      FOUNDATION_PREPROVEN_SUITES="${FOUNDATION_PREPROVEN_SUITES:+$FOUNDATION_PREPROVEN_SUITES }$2"
    fi
    _vouch_index=$((_vouch_index + 1))
  done
}
vouch 'harness contracts (evidence proof)' evidence-proof
vouch 'feedback review' feedback-review
export FOUNDATION_PREPROVEN_SUITES="${FOUNDATION_PREPROVEN_SUITES:-}"

for index in $alone; do sh "$0" --suite "$index" "$WORK"; done

# Replayed in table order: a parallel run has to read like a serial one.
failed=0
index=1
while [ "$index" -le "$TOTAL" ]; do
  label="$(label_of "$(nth "$index")")"
  printf '▶ %s\n' "$label"
  [ -f "$WORK/$index.out" ] && cat "$WORK/$index.out"
  if [ "$(cat "$WORK/$index.status" 2>/dev/null || echo 1)" -eq 0 ]
  then printf '✓ %s\n\n' "$label"
  else printf '✗ %s\n\n' "$label" >&2; failed=1
  fi
  index=$((index + 1))
done

if [ "$failed" -eq 0 ]; then
  echo "foundation tests: ALL SUITES PASS ($TOTAL suites, ${JOBS}-way)"
  exit 0
fi
echo "foundation tests: SOME SUITES FAILED" >&2
exit 1
