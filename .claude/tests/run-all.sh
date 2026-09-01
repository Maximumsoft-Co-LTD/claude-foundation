#!/usr/bin/env sh
# Deterministic verification for the OpenSpec-native harness.
#
# Suites run concurrently. Every suite builds its own fixture under `mktemp -d`
# and touches nothing in this repository, so nothing orders them — running them
# one at a time spent most of the wall clock with the machine idle.
#
# Mutation suites inject faults only into private source fixtures. They can run
# in the shared pool without exposing another suite—or the checkout—to a mutant.
#
# Output is buffered per suite and replayed in table order, so a parallel run
# reads exactly like a serial one and stays diffable. `FOUNDATION_TEST_JOBS`
# overrides the pool size; 1 restores fully serial execution.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# The session-context hook exports the interactive Claude session's identity
# into agent shells; node --test suites inherit it and the runtime then
# prefers it over fixture ids. Deterministic suites must never see it.
unset FOUNDATION_CLAUDE_SESSION_ID FOUNDATION_CLAUDE_TRANSCRIPT_PATH

selection_mode="full"
list_mode=0
if [ "${1:-}" = "--affected" ]; then
  selection_mode="affected"
  shift
elif [ "${1:-}" = "--list" ]; then
  list_mode=1
  shift
fi

# label|command — `!` prefixes a label that must run with the repository to
# itself. Commands are expanded by the child with $HERE and $ROOT in scope.
#
# Shared rows are listed longest-first: xargs hands them to the pool in table
# order, and starting the long suites first keeps the pool packed instead of
# leaving a long tail behind a late-started slow suite. Replay order below
# follows the same table, so the printed report order matches.
suites() {
  cat <<'TABLE'
evidence binding mutation|sh "$HERE/harness/run-evidence-binding-mutation.sh"
target drift mutation|sh "$HERE/harness/run-target-drift-mutation.sh"
land surface mutation|sh "$HERE/harness/run-land-surface-mutation.sh"
shipping boundary mutation|node "$ROOT/scripts/quality/run-shipping-semantic-mutation.mjs"
harness contracts (evidence recovery)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-a2-recovery
harness contracts (evidence telemetry)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-c-telemetry
harness contracts (evidence execution)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-b-execution
harness contracts (evidence lifecycle)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-a1-core
harness contracts (evidence review)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-a2-review
harness contracts (evidence binding)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-b-binding
harness contracts (evidence CI)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-a1-ci
harness contracts (evidence browser)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-c-browser
harness contracts (evidence cache)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-a2-cache
harness contracts (evidence waiver)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-c-waive
harness contracts (evidence service)|sh "$HERE/harness/run-harness-tests.sh" evidence-proof-b-service
change loop seams|sh "$HERE/harness/run-changeloop-seam-tests.sh"
feedback review|sh "$HERE/harness/run-feedback-review-tests.sh"
installer smoke|sh "$HERE/harness/run-installer-tests.sh"
host instruction contract|FOUNDATION_UPDATE_CHECK=0 node --test "$HERE/harness/run-host-instruction-tests.mjs"
update advisory contract|sh "$HERE/harness/run-update-advisory-tests.sh"
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
base-move rebind|sh "$HERE/harness/run-base-move-rebind-tests.sh"
base-move attempt reset|node --test "$ROOT/.claude/harness/tests/base-move-attempt-reset.test.mjs"
sandbox diff identity|node --test "$ROOT/.claude/harness/tests/sandbox-diff-identity.test.mjs"
authority request operation|node --test "$ROOT/.claude/harness/tests/authority-request-operation.test.mjs"
proof request summary|node --test "$ROOT/.claude/harness/tests/proof-request-summary.test.mjs"
proof execution boundaries|node --test "$ROOT/.claude/harness/tests/proof-execution-boundaries.test.mjs"
durable decision metadata|node --test "$ROOT/.claude/harness/tests/durable-decision-metadata.test.mjs"
carried unchanged|node --test "$ROOT/.claude/harness/tests/carried-unchanged.test.mjs"
reviewer config|node --test "$ROOT/.claude/harness/tests/reviewer-config.test.mjs"
claude review operation|node --test "$ROOT/.claude/harness/tests/claude-review-operation.test.mjs"
review closure helpers|node --test "$ROOT/.claude/harness/tests/review-closure-helpers.test.mjs"
review dispatch helpers|node --test "$ROOT/.claude/harness/tests/review-dispatch-helpers.test.mjs"
agent repository conflicts|node --test "$ROOT/.claude/harness/tests/agent-repository-conflicts.test.mjs"
lease acquisition helpers|node --test "$ROOT/.claude/harness/tests/lease-acquisition-helpers.test.mjs"
required providers|node --test "$ROOT/.claude/harness/tests/required-providers.test.mjs"
instruction recorder|node --test "$ROOT/.claude/harness/tests/instruction-recorder.test.mjs"
land journal recovery helpers|node --test "$ROOT/.claude/harness/tests/land-journal-recovery-helpers.test.mjs"
repository head|node --test "$ROOT/.claude/harness/tests/repository-head.test.mjs"
proof readiness value|node --test "$ROOT/.claude/harness/tests/proof-readiness-value.test.mjs"
provider claim scope|node --test "$ROOT/.claude/harness/tests/provider-claim-scope.test.mjs"
harness reliability gaps|sh "$HERE/harness/run-reliability-gap-tests.sh"
branch warning|node --test "$HERE/harness/run-branch-warning-tests.mjs"
packet scaling|sh "$HERE/harness/run-packet-scaling-tests.sh"
packet value|node "$ROOT/.claude/harness/tests/packet-value.test.mjs"
upgrade compatibility|sh "$HERE/harness/run-upgrade-compat-tests.sh"
dashboard contracts|npm --prefix "$ROOT/dashboard" test
quality tooling|node --test "$ROOT"/scripts/quality/test/*.test.mjs && node "$ROOT/scripts/quality/validate-config.mjs" && node "$ROOT/scripts/quality/validate-exceptions.mjs" && bash "$ROOT/scripts/quality/check-static-surfaces.sh"
consumer quality protocols|node --test "$HERE/harness/run-quality-protocol-tests.mjs"
consumer quality policy|node --test "$HERE/harness/run-quality-policy-tests.mjs"
consumer quality discovery|node --test "$HERE/harness/run-quality-discovery-tests.mjs"
consumer quality runtime|node --test "$ROOT/.claude/harness/tests/quality-runtime.test.mjs"
consumer quality adapters|node --test "$ROOT/.claude/harness/tests/quality-adapters.test.mjs"
runtime syntax|node --check "$ROOT/.claude/harness/foundation.mjs"
runtime environment policy|node --test "$HERE/harness/run-runtime-environment-policy-tests.mjs"
state runtime helpers|node --test "$ROOT/.claude/harness/tests/state-runtime-helpers.test.mjs"
receipt runtime|node --test "$HERE/harness/run-receipt-runtime-tests.mjs"
artifact store|node --test "$ROOT/.claude/harness/tests/artifact-store.test.mjs"
apply inputs|node --test "$ROOT/.claude/harness/tests/apply-inputs.test.mjs"
evidence upgrade|node --test "$ROOT/.claude/harness/tests/evidence-upgrade.test.mjs"
evidence contract|node --test "$HERE/harness/run-evidence-contract-tests.mjs"
evidence contract values|node --test "$ROOT/.claude/harness/tests/evidence-contract-values.test.mjs"
environment descriptor|node --test "$ROOT/.claude/harness/tests/environment-descriptor.test.mjs"
review policy|node --test "$ROOT/.claude/harness/tests/review-policy.test.mjs"
traceability|node --test "$ROOT/.claude/harness/tests/traceability.test.mjs"
telemetry record event|node --test "$ROOT/.claude/harness/tests/telemetry-record-event.test.mjs"
host execution contract|node --test "$ROOT/.claude/harness/tests/host-execution-contract.test.mjs"
openspec benchmark matrix|node --test "$ROOT/.claude/tests/bench/tests/openspec-native-matrix.test.mjs"
!openspec native benchmark|node --test "$ROOT/.claude/tests/bench/tests/openspec-native-scorecard.test.mjs" "$ROOT/.claude/tests/bench/tests/openspec-native-runner.test.mjs"
signed CI|node --test "$ROOT/.claude/harness/tests/signed-ci.test.mjs"
adapter fingerprint|node --test "$ROOT/.claude/harness/tests/adapter-fingerprint.test.mjs"
provider workspace hash|node --test "$ROOT/.claude/harness/tests/provider-workspace-hash.test.mjs"
agent plan view|node --test "$ROOT/.claude/harness/tests/agent-plan-view.test.mjs"
agent dispatch|node --test "$ROOT/.claude/harness/tests/agent-dispatch.test.mjs"
budget continuation|node --test "$ROOT/.claude/harness/tests/budget-continuation.test.mjs"
budget runtime|node --test "$ROOT/.claude/harness/tests/budget-runtime.test.mjs"
repository topology|node --test "$ROOT/.claude/harness/tests/repository-topology.test.mjs"
evidence bootstrap|node --test "$ROOT/.claude/harness/tests/evidence-bootstrap.test.mjs" "$ROOT/.claude/harness/tests/evidence-input-coverage.test.mjs"
command registry|node --test "$ROOT/.claude/harness/tests/command-registry.test.mjs"
process runtime|node --test "$ROOT/.claude/harness/tests/process-runtime.test.mjs"
observed exec runtime|node --test "$ROOT/.claude/harness/tests/exec-runtime.test.mjs"
change policy surface|node --test "$ROOT/.claude/harness/tests/change-policy-surface.test.mjs"
sandbox replay preparation|node --test "$ROOT/.claude/harness/tests/sandbox-replay-preparation.test.mjs"
evidence results|node --test "$ROOT/.claude/harness/tests/evidence-results.test.mjs"
telemetry append|node --test "$ROOT/.claude/harness/tests/telemetry-append.test.mjs"
operation profiling|node --test "$ROOT/.claude/harness/tests/operation-profile.test.mjs"
verification planning|node --test "$ROOT/.claude/harness/tests/verification-plan.test.mjs"
change draft materialization|node --test "$ROOT/.claude/harness/tests/change-draft-materialization.test.mjs"
atomic change start|node --test "$ROOT/.claude/harness/tests/change-atomic-start.test.mjs"
land root pointers|node --test "$ROOT/.claude/harness/tests/land-root-pointers.test.mjs"
telemetry phase context|node --test "$ROOT/.claude/harness/tests/telemetry-phase-context.test.mjs"
adapter runtime|node --test "$HERE/harness/run-adapter-runtime-tests.mjs"
run provider|node --test "$ROOT/.claude/harness/tests/run-provider.test.mjs"
grounding policy|node "$ROOT/.claude/harness/tests/grounding-policy.test.mjs"
receipt validity|node "$ROOT/.claude/harness/tests/receipt-validity.test.mjs"
attestation validity|node "$ROOT/.claude/harness/tests/attestation-validity.test.mjs"
security boundary|node --test "$ROOT/.claude/harness/tests/security-boundary.test.mjs"
abandon runtime|node "$ROOT/.claude/harness/tests/abandon-runtime.test.mjs"
repository land record|node "$ROOT/.claude/harness/tests/repository-land-record.test.mjs"
repository snapshot|node --test "$ROOT/.claude/harness/tests/repository-snapshot.test.mjs"
task node proof|node "$ROOT/.claude/harness/tests/task-node-proof.test.mjs"
proof finalize|node "$ROOT/.claude/harness/tests/proof-finalize.test.mjs"
proof advance runtime|node "$ROOT/.claude/harness/tests/proof-advance.test.mjs"
external evidence recovery|node --test "$ROOT/.claude/harness/tests/external-evidence-recovery.test.mjs"
repository infrastructure issues|node --test "$ROOT/.claude/harness/tests/repository-infrastructure-issues.test.mjs"
proof preflight|node --test "$ROOT/.claude/harness/tests/proof-preflight.test.mjs"
telemetry import and sync|node --test "$ROOT/.claude/harness/tests/telemetry-import-sync.test.mjs"
land journal apply entry|node --test "$ROOT/.claude/harness/tests/land-journal-apply-entry.test.mjs"
verified CI recording|node --test "$ROOT/.claude/harness/tests/verified-ci-recording.test.mjs"
authority response validation|node --test "$ROOT/.claude/harness/tests/authority-response-validation.test.mjs"
proof topology issues|node --test "$ROOT/.claude/harness/tests/proof-topology-issues.test.mjs"
subject provenance|node --test "$ROOT/.claude/harness/tests/subject-provenance.test.mjs"
handoff operation normalization|node --test "$ROOT/.claude/harness/tests/handoff-operation-normalization.test.mjs"
relocated sandbox rebind|node --test "$ROOT/.claude/harness/tests/relocated-sandbox-rebind.test.mjs"
provider input identity|node --test "$ROOT/.claude/harness/tests/provider-input-identity.test.mjs"
telemetry source cursor|node --test "$ROOT/.claude/harness/tests/telemetry-source-cursor.test.mjs"
proof audit|node "$ROOT/.claude/harness/tests/proof-audit.test.mjs"
change draft loading|node "$ROOT/.claude/harness/tests/change-draft-loading.test.mjs"
change creation|node --test "$ROOT/.claude/harness/tests/change-creation.test.mjs"
change resolution|node "$ROOT/.claude/harness/tests/change-resolution.test.mjs"
diagnostics runtime|node "$ROOT/.claude/harness/tests/diagnostics-runtime.test.mjs"
diagnostics changes|node --test "$ROOT/.claude/harness/tests/diagnostics-changes.test.mjs"
authority workflow policy|node --test "$ROOT/.claude/harness/tests/workflow-policy.test.mjs"
apply archive runtime|node --test "$ROOT/.claude/harness/tests/apply-runtime-archive.test.mjs"
apply sandbox operation|node --test "$ROOT/.claude/harness/tests/apply-sandbox-operation.test.mjs"
recover pending apply|node --test "$ROOT/.claude/harness/tests/recover-pending-apply.test.mjs"
sandbox sync runtime|node --test "$ROOT/.claude/harness/tests/sandbox-runtime-sync.test.mjs"
sandbox cleanup|node --test "$ROOT/.claude/harness/tests/sandbox-cleanup.test.mjs"
workspace inspection|node --test "$ROOT/.claude/harness/tests/workspace-inspection.test.mjs"
sandbox create phases|node --test "$ROOT/.claude/harness/tests/sandbox-create-phases.test.mjs"
change validation phases|node --test "$ROOT/.claude/harness/tests/change-validation-phases.test.mjs"
semantic invariant validation|node --test "$ROOT/.claude/harness/tests/semantic-invariant-issues.test.mjs"
waive gate|node --test "$ROOT/.claude/harness/tests/waive-gate.test.mjs"
land check phases|node --test "$ROOT/.claude/harness/tests/land-check-phases.test.mjs"
land repository plan|node --test "$ROOT/.claude/harness/tests/land-repository-plan.test.mjs"
run-all process control|sh "$HERE/harness/run-run-all-control-tests.sh"
affected test selection|node --test "$HERE/harness/affected-suite-selector.test.mjs"
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
context rollup drain|node --test "$HERE/harness/run-context-rollup-drain-tests.mjs"
actionable validation and telemetry|sh "$HERE/harness/run-actionable-validation-telemetry-tests.sh"
v3.3 review policy|node "$HERE/harness/run-v33-policy-tests.mjs"
risk-tiered review contract|node "$HERE/harness/run-risk-tiered-review-tests.mjs"
risk-tiered review protocol|node --test "$HERE/harness/run-review-protocol-tests.mjs"
risk-tiered review mutation|node "$HERE/harness/run-risk-tiered-review-mutation.mjs"
configured reviewer adapters|node "$ROOT/.claude/harness/tests/configured-reviewer.test.mjs"
external operation handoff|node "$ROOT/.claude/harness/tests/handoff-policy.test.mjs"
bounded review repair closure|node "$ROOT/.claude/harness/tests/review-repair-closure.test.mjs"
review repair attempt store|node --test "$ROOT/.claude/harness/tests/review-repair-attempt.test.mjs"
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
critical case readiness|node --test "$HERE/harness/run-critical-case-readiness-tests.mjs"
openspec version policy|node "$HERE/harness/run-openspec-version-tests.mjs"
model tier drift|node "$HERE/harness/run-model-drift-tests.mjs"
model task routing|node --test "$ROOT/.claude/harness/tests/model-for-task.test.mjs"
model tier drift join|node "$HERE/harness/run-model-drift-join-tests.mjs"
model drift land gate|node "$HERE/harness/run-drift-gate-tests.mjs"
spec sync verification|node "$HERE/harness/run-spec-sync-verify-tests.mjs"
TABLE
}

nth() { suites | sed -n "${1}p"; }
label_of() { _l="${1%%|*}"; printf '%s' "${_l#!}"; }
exclusive() { case "$1" in !*) return 0 ;; *) return 1 ;; esac; }

if [ "$list_mode" -eq 1 ]; then
  suites | while IFS='|' read -r label _command; do
    label_of "$label"
    printf '\n'
  done
  exit 0
fi

# Recursively stop descendants before their parent. macOS has no `setsid`, so
# signalling only the wrapper PID leaves node/npm grandchildren running and
# can strand an in-place mutation after a timeout or interrupted run.
kill_tree() {
  kill -0 "$1" 2>/dev/null || return 0
  for _tree_child in $(pgrep -P "$1" 2>/dev/null || true); do
    kill_tree "$_tree_child"
  done
  kill -TERM "$1" 2>/dev/null || true
}

repository_status() {
  git -C "$1" status --porcelain=v1 --untracked-files=all
}

assert_repository_unchanged() {
  _repository="$1"
  _before="$2"
  _after="$3"
  repository_status "$_repository" > "$_after" || return 2
  cmp -s "$_before" "$_after" && return 0
  echo "repository residue detected after foundation tests" >&2
  diff -u "$_before" "$_after" >&2 || true
  return 1
}

if [ "${1:-}" = "--kill-tree" ]; then
  [ -n "${2:-}" ] || { echo "--kill-tree requires a PID" >&2; exit 2; }
  kill_tree "$2"
  exit 0
fi

if [ "${1:-}" = "--assert-repository-unchanged" ]; then
  [ -n "${2:-}" ] && [ -n "${3:-}" ] || {
    echo "--assert-repository-unchanged requires a repository and baseline" >&2
    exit 2
  }
  _status_after="$(mktemp)"
  trap 'rm -f "$_status_after"' EXIT
  assert_repository_unchanged "$2" "$3" "$_status_after"
  exit $?
fi

# One suite, into its own buffer. Re-entered as a child so the pool below can be
# a plain `xargs -P`; nothing else calls this form.
if [ "${1:-}" = "--suite" ]; then
  index="$2"; work="$3"
  runner_pid_file="$work/$index.runner-pid"
  echo "$$" > "$runner_pid_file"
  trap 'rm -f "$runner_pid_file"' EXIT
  line="$(nth "$index")"
  started="$(date +%s)"
  echo "$started" > "$work/$index.started"
  if exclusive "$line"; then
    # Mutation suites own their cleanup traps. Keep them in the foreground so
    # HUP/INT/TERM reaches the mutator itself and it can restore source bytes.
    if eval "${line#*|}" > "$work/$index.out" 2>&1; then result=0; else result=1; fi
  else
    ( eval "${line#*|}" ) > "$work/$index.out" 2>&1 &
    child=$!
    timeout="${FOUNDATION_SUITE_TIMEOUT_SECONDS:-300}"
    (
      sleep "$timeout"
      if kill -0 "$child" 2>/dev/null; then
        printf 'suite exceeded %ss and was terminated\n' "$timeout" >> "$work/$index.out"
        echo timeout > "$work/$index.timeout"
        kill_tree "$child"
      fi
    ) &
    watchdog=$!
    cleanup_suite() {
      kill_tree "$child"
      kill_tree "$watchdog"
      wait "$child" 2>/dev/null || true
      wait "$watchdog" 2>/dev/null || true
    }
    trap 'cleanup_suite; exit 130' HUP INT TERM
    if wait "$child"; then result=0; else result=1; fi
    kill_tree "$watchdog"
    wait "$watchdog" 2>/dev/null || true
  fi
  echo $(( $(date +%s) - started )) > "$work/$index.duration"
  echo "$result" > "$work/$index.status"
  exit 0
fi

pool_size() {
  [ -n "${FOUNDATION_TEST_JOBS:-}" ] && { echo "$FOUNDATION_TEST_JOBS"; return; }
  cores="$( { nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null; } | head -1 )"
  case "$cores" in "" | *[!0-9]*) cores=4 ;; esac
  # These suites spend substantial time in short-lived Node/git children and
  # filesystem waits. Two workers per logical core keeps those gaps filled;
  # the cap prevents an unusually large host from flooding its process table.
  jobs=$((cores * 2))
  [ "$jobs" -gt 24 ] && jobs=24
  [ "$jobs" -lt 1 ] && jobs=1
  echo "$jobs"
}

WORK="$(mktemp -d)"
repository_status "$ROOT" > "$WORK/repository-before.status" || {
  echo "unable to capture repository status before foundation tests" >&2
  exit 1
}
# Repeated CLI assertions load the same ESM graph from one fixture path. Newer
# Node releases reuse its compiled bytecode here; older supported releases
# safely ignore the environment variable.
NODE_COMPILE_CACHE="$WORK/node-compile-cache"
export NODE_COMPILE_CACHE
pool_pid=""
monitor_pid=""
cleanup() {
  [ -n "$monitor_pid" ] && kill_tree "$monitor_pid"
  [ -n "$pool_pid" ] && kill_tree "$pool_pid"
  for runner_file in "$WORK"/*.runner-pid; do
    [ -f "$runner_file" ] || continue
    kill_tree "$(cat "$runner_file")"
  done
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
TOTAL="$(suites | wc -l | tr -d ' ')"
JOBS="$(pool_size)"

selected_labels=""
if [ "$selection_mode" = "affected" ]; then
  suite_registry="$(suites)"
  suite_labels="$(printf '%s\n' "$suite_registry" | while IFS='|' read -r label _command; do label_of "$label"; printf '\n'; done)"
  selected_labels="$(FOUNDATION_SUITE_LABELS="$suite_labels" \
    FOUNDATION_SUITE_REGISTRY="$suite_registry" \
    node "$HERE/affected-suite-selector.mjs" "$ROOT")"
fi

shared=""
alone=""
selected=""
index=1
while [ "$index" -le "$TOTAL" ]; do
  line="$(nth "$index")"
  label="$(label_of "$line")"
  if [ "$selection_mode" = "affected" ] &&
     ! printf '%s\n' "$selected_labels" | grep -qFx -- "$label"; then
    index=$((index + 1))
    continue
  fi
  selected="$selected $index"
  if exclusive "$line"; then alone="$alone $index"; else shared="$shared $index"; fi
  index=$((index + 1))
done
SELECTED_TOTAL="$(printf '%s\n' $selected | wc -l | tr -d ' ')"

# Full runs already schedule both detector baselines in this same gate. The
# private mutation fixture cannot affect them, so the mutation row may avoid
# repeating their work; a standalone mutation invocation still proves both.
if [ "$selection_mode" = "full" ]; then
  FOUNDATION_PREPROVEN_SUITES="feedback-review land-surface"
  export FOUNDATION_PREPROVEN_SUITES
fi

printf '%s\n' $shared | xargs -P "$JOBS" -I@ sh "$0" --suite @ "$WORK" &
pool_pid=$!
(
  monitor_ticks=0
  while kill -0 "$pool_pid" 2>/dev/null; do
    sleep 1
    kill -0 "$pool_pid" 2>/dev/null || exit 0
    monitor_ticks=$((monitor_ticks + 1))
    [ "$monitor_ticks" -lt 15 ] || monitor_ticks=0
    [ "$monitor_ticks" -eq 0 ] || continue
    completed="$(find "$WORK" -name '*.status' -type f 2>/dev/null | wc -l | tr -d ' ')"
    running=""
    for started_file in "$WORK"/*.started; do
      [ -f "$started_file" ] || continue
      running_index="${started_file##*/}"
      running_index="${running_index%.started}"
      [ -f "$WORK/$running_index.status" ] ||
        running="${running}${running:+, }$(label_of "$(nth "$running_index")")"
    done
    printf '… foundation tests: %s/%s shared suites complete%s\n' \
      "$completed" "$(printf '%s\n' $shared | wc -l | tr -d ' ')" \
      "${running:+; running: $running}" >&2
  done
) &
monitor_pid=$!
wait "$pool_pid"
pool_pid=""
wait "$monitor_pid" 2>/dev/null || true
monitor_pid=""

for index in $alone; do sh "$0" --suite "$index" "$WORK"; done

# Replayed in table order: a parallel run has to read like a serial one.
failed=0
for index in $selected; do
  label="$(label_of "$(nth "$index")")"
  duration="$(cat "$WORK/$index.duration" 2>/dev/null || echo '?')"
  printf '▶ %s (%ss)\n' "$label" "$duration"
  [ -f "$WORK/$index.out" ] && cat "$WORK/$index.out"
  if [ "$(cat "$WORK/$index.status" 2>/dev/null || echo 1)" -eq 0 ]
  then printf '✓ %s\n\n' "$label"
  else printf '✗ %s\n\n' "$label" >&2; failed=1
  fi
done

if ! assert_repository_unchanged \
  "$ROOT" "$WORK/repository-before.status" "$WORK/repository-after.status"
then
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "foundation tests: ALL SUITES PASS ($SELECTED_TOTAL suites, ${JOBS}-way${selection_mode:+, $selection_mode})"
  exit 0
fi
echo "foundation tests: SOME SUITES FAILED" >&2
exit 1
