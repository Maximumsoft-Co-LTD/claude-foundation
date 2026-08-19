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
assert_file_contains "agent contract selectively loads update policy" \
  "$ROOT/.claude/harness/AGENT.md" 'For non-empty `update.actions`, load the agent update policy'
assert_file_contains "update policy suppresses the duplicate Change notice" \
  "$ROOT/.claude/harness/README.md" "suppress the duplicate notice at Change"
assert_file_contains "update policy reminds before every Build entry" \
  "$ROOT/.claude/harness/README.md" "Immediately before every Build entry"
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
  '.version == 7 and .packetType == "task" and (.claims | length) > 0 and (.providers | length) > 0' \
  >/dev/null; then
  pass "task packet is JSON with claim and provider authority"
else
  fail "task packet is JSON with claim and provider authority"
fi
recorded="$(find .foundation/logs/agent-contract/context-events \
  -type f -name '*.json' -print | sort | tail -1)"
actual_bytes="$(printf '%s\n' "$task_packet" | wc -c | tr -d ' ')"
assert_eq "context metric equals emitted task packet bytes" "$actual_bytes" \
  "$(jq -r '.bytes' "$recorded")"

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
