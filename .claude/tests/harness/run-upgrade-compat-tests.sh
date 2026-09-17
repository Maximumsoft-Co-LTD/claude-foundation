#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
. "$ROOT/.claude/tests/lib/harness-fixture.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

legacy="$TMP/legacy"
mkdir -p "$legacy"
printf '%s\n' \
  '{"version":1,"execution":{"maxParallelAgents":3,"packetBytes":65536,"leaseMinutes":45},"land":{"riskBasedCi":true}}' \
  > "$legacy/foundation.json"
legacy_upgrade="$(bash "$ROOT/install.sh" "$legacy" --source "$ROOT" --yes)"
assert_contains "installer diagnoses historical risk-based CI default" \
  "$legacy_upgrade" "historical-default-land-risk-based-ci"
assert_eq "historical risk-based CI value is preserved" "true" \
  "$(jq -r '.land.riskBasedCi' "$legacy/foundation.json")"
assert_eq "legacy task budget migrates" "8192" \
  "$(jq -r '.execution.packetBytes.task' "$legacy/foundation.json")"
assert_eq "legacy review budget migrates" "8192" \
  "$(jq -r '.execution.packetBytes.review' "$legacy/foundation.json")"
assert_eq "legacy repository budget migrates" "12288" \
  "$(jq -r '.execution.packetBytes.repository' "$legacy/foundation.json")"
assert_eq "legacy global budget migrates" "16384" \
  "$(jq -r '.execution.packetBytes.global' "$legacy/foundation.json")"

custom="$TMP/custom"
mkdir -p "$custom"
printf '%s\n' \
  '{"version":1,"execution":{"packetBytes":32768}}' \
  > "$custom/foundation.json"
assert_cmd_zero "installer preserves custom numeric policy" \
  bash "$ROOT/install.sh" "$custom" --source "$ROOT" --yes
assert_eq "custom numeric budget survives install" "32768" \
  "$(jq -r '.execution.packetBytes' "$custom/foundation.json")"
# These compatibility probes inspect policy migration, not a host's reviewer
# installation. Prove-stage doctor correctly requires the configured agent CLI,
# which a clean CI runner intentionally does not carry.
doctor="$(bash "$ROOT/cli.sh" --project "$custom" doctor --stage build)"
assert_contains "doctor reports legacy numeric policy" "$doctor" \
  "legacy numeric limit 32768"

partial="$TMP/partial"
mkdir -p "$partial/.claude/harness" "$partial/.claude/hooks" "$partial/openspec"
install_harness_fixture "$ROOT" "$partial"
cp "$ROOT/.claude/harness/commands.json" "$partial/.claude/harness/"
cp "$ROOT/.claude/harness/protocol.json" "$partial/.claude/harness/"
cp "$ROOT/.claude/hooks/protect-secrets.sh" "$partial/.claude/hooks/"
cp "$ROOT/.claude/hooks/lint.sh" "$partial/.claude/hooks/"
cp -R "$ROOT/openspec/schemas" "$partial/openspec/"
cp "$ROOT/openspec/config.yaml" "$partial/openspec/"
printf '%s\n' \
  '{"version":1,"execution":{"packetBytes":{"task":4096}}}' \
  > "$partial/foundation.json"
models="$(cd "$partial" && node .claude/harness/foundation.mjs models)"
assert_contains "partial scoped policy deep-merges defaults" "$models" '"fast"'
doctor="$(cd "$partial" && node .claude/harness/foundation.mjs doctor --stage build)"
assert_contains "partial policy retains custom task budget" "$doctor" "task=4096"
assert_contains "partial policy receives repository default" "$doctor" \
  "repository=12288"
assert_contains "partial policy receives review default" "$doctor" "review=8192"

# Exercise the real previous release rather than a hand-built policy fragment.
# An in-flight v3.2.19 change is a grandfathered migration exception: it stays
# readable and does not acquire an invented Decision Sheet. New changes created
# after upgrade use the current conditional-grounding default.
previous_source="$TMP/foundation-3.2.19"
previous_target="$TMP/previous-project"
current_version="$(cat "$ROOT/VERSION")"
mkdir -p "$previous_source" "$previous_target"
git -C "$ROOT" archive v3.2.19 | tar -x -C "$previous_source"
assert_cmd_zero "v3.2.19 installs into the upgrade fixture" \
  bash "$previous_source/install.sh" "$previous_target" \
    --source "$previous_source" --yes
assert_cmd_zero "v3.2.19 creates an active legacy change" \
  bash "$previous_source/cli.sh" --project "$previous_target" \
    change new "Legacy active upgrade" --rapid
assert_file_exists "legacy active state exists before upgrade" \
  "$previous_target/.foundation/runtime/legacy-active-upgrade.json"
previous_upgrade="$(bash "$ROOT/install.sh" "$previous_target" --source "$ROOT" --yes)"
assert_contains "upgrade reports active-change compatibility effects" \
  "$previous_upgrade" "active-change-effects:legacy-active-upgrade"
assert_contains "upgraded CLI reports the current version" \
  "$(bash "$ROOT/cli.sh" --project "$previous_target" version)" "$current_version"
assert_contains "upgraded runtime keeps the active legacy change readable" \
  "$(bash "$ROOT/cli.sh" --project "$previous_target" changes)" \
  "legacy-active-upgrade"
assert_eq "legacy active change is an explicit grounding migration exception" \
  "false" \
  "$(jq -r '(.groundingRequired // false)' \
    "$previous_target/.foundation/runtime/legacy-active-upgrade.json")"
assert_cmd_zero "post-upgrade change creation uses the new runtime" \
  bash "$ROOT/cli.sh" --project "$previous_target" \
    change new "Grounded after upgrade" --rapid
assert_file_absent "post-upgrade change receives no empty grounding artifact" \
  "$previous_target/openspec/changes/grounded-after-upgrade/grounding.yaml"
assert_eq "post-upgrade runtime keeps grounding optional" "null" \
  "$(jq -r '.groundingVersion' \
    "$previous_target/.foundation/runtime/grounded-after-upgrade.json")"

# Graph v2 allowed every task in one repository to run in the host session.
# Graph v3 requires leases once more than one task is ready. An in-flight
# v3.5.13 change therefore has no per-task lease results to invent on upgrade;
# its persisted single-session authority must either compare cleanly or return
# only the affected task to current verification.
graph_source="$TMP/foundation-3.5.13"
graph_target="$TMP/graph-upgrade-project"
mkdir -p "$graph_source" "$graph_target"
git -C "$ROOT" archive v3.5.13 | tar -x -C "$graph_source"
git -C "$graph_target" init -q
git -C "$graph_target" config user.email fixture@example.com
git -C "$graph_target" config user.name "Upgrade Fixture"
printf 'initial\n' > "$graph_target/app.txt"
git -C "$graph_target" add app.txt
git -C "$graph_target" commit -qm initial
assert_cmd_zero "v3.5.13 installs into the graph upgrade fixture" \
  bash "$graph_source/install.sh" "$graph_target" --source "$graph_source" --yes
(
  cd "$graph_target"
  node .claude/harness/foundation.mjs new "Graph upgrade" --rapid >/dev/null
  node .claude/harness/foundation.mjs resolve graph-upgrade \
    --impact low --coupling isolated --acceptance-not-required >/dev/null
  change="openspec/changes/graph-upgrade"
  printf '%s\n' \
    '# Tasks' '' \
    '- [ ] **T001** First [kind:code] [paths:app.txt] [claims:graph-upgrade-outcome]' \
    '- [ ] **T002** Second [kind:code] [paths:app.txt] [claims:graph-upgrade-outcome]' \
    > "$change/tasks.md"
  bash "$graph_source/cli.sh" --project "$graph_target" \
    sandbox create graph-upgrade >/dev/null
  bash "$graph_source/cli.sh" --project "$graph_target" \
    agents plan graph-upgrade >/dev/null
  workspace="$(node -p 'require("./.foundation/runtime/graph-upgrade.json").workspace.path')"
  sed -i.bak 's/- \[ \]/- [x]/g' \
    "$workspace/openspec/changes/graph-upgrade/tasks.md"
  rm -f "$workspace/openspec/changes/graph-upgrade/tasks.md.bak"

  node .claude/harness/foundation.mjs new "Graph reverify" --rapid >/dev/null
  node .claude/harness/foundation.mjs resolve graph-reverify \
    --impact low --coupling isolated --acceptance-not-required >/dev/null
  change="openspec/changes/graph-reverify"
  printf '%s\n' \
    '# Tasks' '' \
    '- [ ] **T001** First [kind:code] [paths:app.txt] [claims:graph-reverify-outcome]' \
    '- [ ] **T002** Second [kind:code] [paths:app.txt] [claims:graph-reverify-outcome]' \
    > "$change/tasks.md"
  bash "$graph_source/cli.sh" --project "$graph_target" \
    sandbox create graph-reverify >/dev/null
  bash "$graph_source/cli.sh" --project "$graph_target" \
    agents plan graph-reverify >/dev/null
  workspace="$(node -p 'require("./.foundation/runtime/graph-reverify.json").workspace.path')"
  sed -i.bak 's/- \[ \]/- [x]/g' \
    "$workspace/openspec/changes/graph-reverify/tasks.md"
  rm -f "$workspace/openspec/changes/graph-reverify/tasks.md.bak"
)
assert_eq "the previous release persisted graph-v2 execution authority" "2" \
  "$(jq -r '.graph.version' "$graph_target/.foundation/plans/graph-upgrade.json")"
rm "$graph_target/.foundation/plans/graph-reverify.json"
assert_file_absent "the recovery fixture has lost its historical plan" \
  "$graph_target/.foundation/plans/graph-reverify.json"
assert_cmd_zero "current runtime upgrades the completed graph-v2 change" \
  bash "$ROOT/install.sh" "$graph_target" --source "$ROOT" --yes
assert_cmd_zero "read-only planning preserves compatible historical authority" \
  bash "$ROOT/cli.sh" --project "$graph_target" agents plan graph-upgrade
assert_eq "the upgraded plan has no Build task to repeat" "0" \
  "$(jq -r '.tasks | length' "$graph_target/.foundation/plans/graph-upgrade.json")"
assert_eq "the upgraded plan retains its bounded graph-v2 authority snapshot" "2" \
  "$(jq -r '.legacyExecutionAuthority.graph.version' \
    "$graph_target/.foundation/plans/graph-upgrade.json")"
readiness="$(bash "$ROOT/cli.sh" --project "$graph_target" \
  proof readiness graph-upgrade || true)"
assert_contains "upgraded proof readiness reports no implementation work" \
  "$readiness" '"pendingTasks": []'
assert_not_contains "upgraded proof readiness does not demand synthetic lease results" \
  "$readiness" "accepted lease result"

# If the historical plan is missing, recovery remains Harness-owned: completion
# added after isolation returns to current leased verification without packet
# edits or a user decision, and accepted current results converge back to
# build-complete.
bash "$ROOT/cli.sh" --project "$graph_target" change waive graph-reverify \
  --capability review --reason fixture --decision-ref fixture-review >/dev/null
assert_cmd_zero "missing graph-v2 authority enters automatic verification" \
  bash "$ROOT/cli.sh" --project "$graph_target" agents plan graph-reverify
assert_eq "both completed tasks are queued for current verification" "2" \
  "$(jq -r '.tasks | length' "$graph_target/.foundation/plans/graph-reverify.json")"
for expected_task in T001 T002; do
  dispatch="$(bash "$ROOT/cli.sh" --project "$graph_target" \
    agents dispatch graph-reverify)"
  task_id="$(printf '%s' "$dispatch" | jq -r '.task.taskId')"
  owner="$(printf '%s' "$dispatch" | jq -r '.task.owner')"
  assert_eq "verification dispatch selects the next completed task" \
    "$expected_task" "$task_id"
  bash "$ROOT/cli.sh" --project "$graph_target" agents acquire \
    graph-reverify "$task_id" --owner "$owner" >/dev/null
  lease_id="$(jq -r '.leaseId' \
    "$graph_target/.foundation/leases/tasks/graph-reverify/$task_id.json")"
  bash "$ROOT/cli.sh" --project "$graph_target" agents release \
    graph-reverify "$task_id" --owner "$owner" --lease-id "$lease_id" >/dev/null
done
reverified_dispatch="$(bash "$ROOT/cli.sh" --project "$graph_target" \
  agents dispatch graph-reverify)"
assert_contains "accepted current results finish automatic verification" \
  "$reverified_dispatch" '"action":"build-complete"'
head_before="$(git -C "$graph_target" rev-parse HEAD)"
index_before="$(git -C "$graph_target" diff --cached --binary | shasum -a 256)"
bash "$ROOT/cli.sh" --project "$graph_target" change waive graph-upgrade \
  --capability review --reason fixture --decision-ref fixture-review >/dev/null
(
  cd "$graph_target"
  node .claude/harness/foundation.mjs receipt graph-upgrade test pass \
    --observed "fixture test passed" --source harness-test \
    --reference fixture://test >/dev/null
  node .claude/harness/foundation.mjs receipt graph-upgrade discovery pass \
    --observed "fixture discovery passed" --source harness-test \
    --reference fixture://discovery --discovered 1 --minimum 1 >/dev/null
  node .claude/harness/foundation.mjs prove graph-upgrade >/dev/null
)
delivered="$(bash "$ROOT/cli.sh" --project "$graph_target" \
  advance graph-upgrade --through archived --pretty)"
assert_contains "the upgraded graph-v2 change reaches archived" "$delivered" '"action": "DONE"'
assert_contains "the upgraded graph-v2 change reports delivery" "$delivered" '"userState": "DELIVERED"'
assert_eq "upgrade delivery preserves Git HEAD" "$head_before" \
  "$(git -C "$graph_target" rev-parse HEAD)"
assert_eq "upgrade delivery preserves the Git index" "$index_before" \
  "$(git -C "$graph_target" diff --cached --binary | shasum -a 256)"

(
  cd "$graph_target"
  node .claude/harness/foundation.mjs receipt graph-reverify test pass \
    --observed "fixture test passed" --source harness-test \
    --reference fixture://test >/dev/null
  node .claude/harness/foundation.mjs receipt graph-reverify discovery pass \
    --observed "fixture discovery passed" --source harness-test \
    --reference fixture://discovery --discovered 1 --minimum 1 >/dev/null
  node .claude/harness/foundation.mjs prove graph-reverify >/dev/null
)
reverified_delivery="$(bash "$ROOT/cli.sh" --project "$graph_target" \
  advance graph-reverify --through archived --pretty)"
assert_contains "automatic verification recovery reaches archived" \
  "$reverified_delivery" '"userState": "DELIVERED"'
assert_eq "verification recovery preserves Git HEAD" "$head_before" \
  "$(git -C "$graph_target" rev-parse HEAD)"
assert_eq "verification recovery preserves the Git index" "$index_before" \
  "$(git -C "$graph_target" diff --cached --binary | shasum -a 256)"

finish "upgrade compatibility"
