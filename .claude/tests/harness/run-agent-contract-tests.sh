#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
. "$ROOT/.claude/tests/lib/harness-fixture.sh"

assert_file_contains "agent contract translates machine output for users" \
  "$ROOT/.claude/harness/AGENT.md" "Harness output is a machine handoff"
assert_file_contains "agent contract executes deterministic recovery" \
  "$ROOT/.claude/harness/AGENT.md" 'authorized `automaticRecovery`'
assert_file_contains "agent contract forbids pass-biased decisions" \
  "$ROOT/.claude/harness/AGENT.md" "never present only the option that makes the workflow"
assert_file_contains "build treats spawn groups as concurrent authority" \
  "$ROOT/.claude/commands/build.md" 'Treat `spawn-group` as concurrent authority'
assert_file_contains "build handles singleton frontiers in the parent under lease" \
  "$ROOT/.claude/commands/build.md" '`run-leased-in-session`'
assert_file_contains "dispatch preserves lease authority for singleton frontiers" \
  "$ROOT/.claude/commands/references/build-dispatch.md" \
  'singleton runnable frontier out of a new worker'
assert_file_contains "build forbids serializing a spawn group in the parent" \
  "$ROOT/.claude/commands/build.md" 'serialize that group in the parent'
assert_file_contains "dispatch spawns the leased group before waiting" \
  "$ROOT/.claude/commands/references/build-dispatch.md" \
  'successfully leased worker before waiting for any worker'
assert_file_contains "dispatch makes the parent the join owner" \
  "$ROOT/.claude/commands/references/build-dispatch.md" \
  'the parent is the orchestrator and join owner'
assert_file_contains "dispatch keeps workers away from the task ledger" \
  "$ROOT/.claude/harness/runtime/workflow/packet-runtime.mjs" 'edit-task-ledger'
assert_file_contains "dispatch keeps worker reports non-authoritative" \
  "$ROOT/.claude/commands/references/build-dispatch.md" 'report is not evidence'
assert_file_contains "dispatch acquires only immediately spawnable workers" \
  "$ROOT/.claude/commands/references/build-dispatch.md" \
  'Never acquire a lease that cannot be spawned immediately'
assert_file_contains "agent contract selectively loads update policy" \
  "$ROOT/.claude/harness/AGENT.md" 'For `notification.surface: true`, load `README.md`'
assert_file_contains "update policy suppresses the duplicate Change notice" \
  "$ROOT/.claude/harness/README.md" "harness owns the phase timing and session-level"
assert_file_contains "update policy reminds before every Build entry" \
  "$ROOT/.claude/harness/README.md" "reminder immediately before that Build entry"
assert_file_contains "update policy keeps later phases quiet" \
  "$ROOT/.claude/harness/README.md" "during Prove or Land"
assert_file_contains "prove command uses the authority bridge" \
  "$ROOT/.claude/skills/prove/references/workflow.md" "authority request"
assert_file_contains "prove command forbids raw readiness output" \
  "$ROOT/.claude/skills/prove/references/workflow.md" "Never expose raw readiness JSON"
assert_file_contains "change command requires canonical spec comparison" \
  "$ROOT/.claude/skills/change/references/workflow.md" 'Do not default to `ADDED`'
assert_file_contains "change command defines complete modified deltas" \
  "$ROOT/.claude/skills/change/references/workflow.md" "copy the complete requirement and every existing scenario"
assert_file_contains "change command requires removal migration consequence" \
  "$ROOT/.claude/skills/change/references/workflow.md" '`**Migration:**` or `**Compatibility:**`'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
install_harness_fixture "$ROOT" "$TMP/project"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
cp "$ROOT/foundation.json" "$TMP/project/"
jq '.workflow.grounding = "optional" |
    .workflow.reviewCircuit = "legacy" |
    .workflow.reviewPolicy = "legacy"' \
  "$TMP/project/foundation.json" > "$TMP/project/foundation.json.tmp"
mv "$TMP/project/foundation.json.tmp" "$TMP/project/foundation.json"
printf 'initial\n' > "$TMP/project/app.txt"
cd "$TMP/project"

RUNTIME=".claude/harness/foundation.mjs"
node "$RUNTIME" new 'Agent contract' --rapid >/dev/null
node "$RUNTIME" resolve agent-contract --impact low --coupling isolated >/dev/null
CHANGE="openspec/changes/agent-contract"
jq '.providers.test = {"adapter":"external"}' "$CHANGE/execution.yaml" \
  > "$CHANGE/execution.yaml.tmp"
mv "$CHANGE/execution.yaml.tmp" "$CHANGE/execution.yaml"
printf '%s\n' \
  '# Tasks' '' \
  '- [x] **T001** Completed prerequisite [kind:inventory]' \
  '- [ ] **T002** Security decision [kind:security] [depends:T001] [claims:agent-contract-outcome]' \
  > "$CHANGE/tasks.md"

plan="$(node "$RUNTIME" agent-plan agent-contract)"
if printf '%s' "$plan" | jq -e '.version == 4 and .taskCount == 1' >/dev/null; then
  pass "agent plan is JSON-only and accepts completed dependencies"
else
  fail "agent plan is JSON-only and accepts completed dependencies"
fi
assert_eq "mixed-risk single session selects deep model" "deep" \
  "$(printf '%s' "$plan" | jq -r '.sessionModel.tier')"

task_packet="$(node "$RUNTIME" agent-task agent-contract T002)"
if printf '%s' "$task_packet" | jq -e \
  '.version == 8 and .packetType == "task" and
    (.claims | length) > 0 and (.providers | length) > 0 and
    .workerContract.role == "leased-task-worker" and
    (.workerContract.mustNot | index("edit-task-ledger")) != null and
    (.workerContract.mustNot | index("dispatch-successors")) != null and
    (.workerContract.mustNot | index("claim-peer-results")) != null and
    .workerContract.resultAuthority == "observed-workspace-writes-and-lease-authority"' \
  >/dev/null; then
  pass "task packet carries claim, provider, and worker authority"
else
  fail "task packet carries claim, provider, and worker authority"
fi
recorded="$(find .foundation/logs/agent-contract/context-events \
  -type f -name '*.json' -print | sort | tail -1)"
actual_bytes="$(printf '%s\n' "$task_packet" | wc -c | tr -d ' ')"
assert_eq "context metric equals emitted task packet bytes" "$actual_bytes" \
  "$(jq -r '.bytes' "$recorded")"

# A corrupted or partially written lease file parses to an empty object; it
# must not grant leased authority without its fencing identity.
mkdir -p .foundation/leases/tasks/agent-contract
printf '{ "partial-write' > .foundation/leases/tasks/agent-contract/T002.json
corrupt_packet="$(node "$RUNTIME" agent-task agent-contract T002)"
assert_eq "corrupt lease file yields unleased authority" "unleased" \
  "$(printf '%s' "$corrupt_packet" | jq -r '.executionAuthority.status')"
printf '%s\n' \
  '{"leaseId":"lease-T002","fencingGeneration":1,"executionAttempt":1}' \
  > .foundation/leases/tasks/agent-contract/T002.json
leased_packet="$(node "$RUNTIME" agent-task agent-contract T002)"
assert_eq "intact lease file keeps leased authority" "leased" \
  "$(printf '%s' "$leased_packet" | jq -r '.executionAuthority.status')"
assert_eq "leased packet carries its fencing identity" "lease-T002" \
  "$(printf '%s' "$leased_packet" | jq -r '.executionAuthority.leaseId')"
rm -f .foundation/leases/tasks/agent-contract/T002.json

printf '%s\n' \
  '# Tasks' '' \
  '- [ ] **T002** Bad authority [kind:security] [claims:not-declared]' \
  > "$CHANGE/tasks.md"
if node "$RUNTIME" validate agent-contract >/dev/null 2>&1; then
  fail "unknown task claim is rejected"
else
  pass "unknown task claim is rejected"
fi

printf '%s\n' '# Tasks' '' \
  '- [x] **T001** Complete [kind:implementation]' > "$CHANGE/tasks.md"
plan="$(node "$RUNTIME" agent-plan agent-contract)"
assert_eq "completed change routes to proof" "proof-ready" \
  "$(printf '%s' "$plan" | jq -r '.recommendedExecution')"

node "$RUNTIME" new 'Competing root writer' --rapid >/dev/null
node "$RUNTIME" resolve competing-root-writer \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '# Tasks' '' \
  '- [ ] **T001** Valid task [claims:agent-contract-outcome]' > "$CHANGE/tasks.md"
if node "$RUNTIME" agent-task agent-contract T001 >/dev/null 2>&1; then
  fail "blocked plan cannot dispatch a task packet"
else
  pass "blocked plan cannot dispatch a task packet"
fi

finish "agent contracts"
