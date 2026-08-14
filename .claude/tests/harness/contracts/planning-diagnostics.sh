# Planning, diagnostics, abandon, and lease contracts.
# Large brownfield plans remain navigable without injecting every task into the
# orchestrator context. Full detail stays in the persisted plan and task packet.
large_workspace="$(jq -r '.workspace.path' \
  .foundation/runtime/cross-repository-profile.json)"
large_tasks="$large_workspace/openspec/changes/cross-repository-profile/tasks.md"
printf '%s\n' '# Tasks' '' > "$large_tasks"
task_number=1
while [ "$task_number" -le 100 ]; do
  task_id="$(printf 'T%03d' "$task_number")"
  printf '%s\n' \
    "- [ ] **$task_id** Brownfield task $task_number [repo:api] [kind:implementation] [paths:api.txt]" \
    >> "$large_tasks"
  task_number=$((task_number + 1))
done
large_plan="$(node .claude/harness/foundation.mjs agent-plan \
  cross-repository-profile)"
assert_contains "large plan reports all tasks" "$large_plan" '"taskCount":100'
assert_contains "large plan compacts group details" "$large_plan" '"preview":'
if [ "$(printf '%s' "$large_plan" | wc -c | tr -d ' ')" -le 4096 ]; then
  pass "100-task plan summary stays within 4 KiB"
else
  fail "100-task plan summary stays within 4 KiB"
fi
large_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile)"
if [ "$(printf '%s' "$large_packet" | wc -c | tr -d ' ')" -le 16384 ]; then
  pass "100-task global packet stays within 16 KiB"
else
  fail "100-task global packet stays within 16 KiB"
fi
context_metrics="$(node .claude/harness/foundation.mjs metrics \
  cross-repository-profile)"
assert_contains "metrics expose context byte totals" \
  "$context_metrics" '"estimatedTokens":'
assert_contains "metrics separate plan and packet context" \
  "$context_metrics" '"agent-plan-summary":'
assert_contains "context estimate declares its measurement scope" \
  "$context_metrics" '"emitted-plan-and-packet-bytes-only"'

# Runtime state whose active OpenSpec directory disappeared must remain visible
# and diagnosable instead of being silently omitted from `changes`.
printf '%s\n' \
  '{"id":"orphan-fixture","status":"change","schema":"foundation-rapid"}' \
  > .foundation/runtime/orphan-fixture.json
changes_with_orphan="$(node .claude/harness/foundation.mjs changes)"
assert_contains "changes exposes orphan runtime state" \
  "$changes_with_orphan" 'orphan-fixture'
assert_contains "changes classifies orphan runtime state" \
  "$changes_with_orphan" 'orphan-runtime'
doctor_with_orphan="$(node .claude/harness/foundation.mjs doctor \
  --stage prove --change orphan-fixture 2>/dev/null || true)"
assert_contains "doctor gives an explicit orphan error" \
  "$doctor_with_orphan" 'ERROR change:orphan-fixture'
assert_contains "doctor gives a recoverable orphan action" \
  "$doctor_with_orphan" 'change abandon'

# An inferred capability that does not name the file that pulled it in can only
# be diagnosed by reading the runtime source, which is what this prevents.
mkdir -p "$TMP/policy-trigger"
cd "$TMP/policy-trigger"
cp -R "$TMP/project/.claude" .
cp -R "$TMP/project/openspec" .
rm -rf openspec/changes .foundation
printf 'x\n' > app.txt
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git add . >/dev/null
git commit -qm "policy fixture"
node .claude/harness/foundation.mjs new 'Touch a contract' >/dev/null
# Written after the change exists, because that is what "touch a contract"
# means. A file already sitting in the tree when the change began is not this
# change's surface — that is what stopped a stray stylesheet from demanding
# accessibility evidence — so a fixture that wrote it first would be asserting
# the opposite of the behaviour it names.
mkdir -p openspec/contracts
printf 'openapi: 3.0.0\n' > openspec/contracts/pay.yaml
node .claude/harness/foundation.mjs resolve touch-a-contract \
  --impact low --coupling isolated >/dev/null
policy_doctor="$(node .claude/harness/foundation.mjs doctor \
  --stage change --change touch-a-contract 2>&1 || true)"
assert_contains "an inferred capability names the path that triggered it" \
  "$policy_doctor" 'compatibility (from root/openspec/contracts/pay.yaml)'

# `mutation` is the only capability that answers whether the other gates detect
# a fault at all, and no file pattern can infer it — nothing about a path says
# the suite around it is load-bearing. So it is named rather than required: a
# high-impact change that omitted it must not read like one that weighed it.
if printf '%s' "$policy_doctor" | grep -qF "mutation-coverage"; then
  fail "a low-impact change is not asked to prove its gates detect faults"
else
  pass "a low-impact change is not asked to prove its gates detect faults"
fi
node .claude/harness/foundation.mjs new 'Rework the pricing engine' >/dev/null
node .claude/harness/foundation.mjs resolve rework-the-pricing-engine \
  --impact high --coupling isolated >/dev/null
mutation_doctor="$(node .claude/harness/foundation.mjs doctor \
  --stage change --change rework-the-pricing-engine 2>&1 || true)"
assert_contains "a high-impact change without a mutation provider is named, not failed" \
  "$mutation_doctor" "mutation-coverage"
assert_contains "the warning says what is unproven rather than what is forbidden" \
  "$mutation_doctor" "detects a deliberate fault"
if printf '%s' "$mutation_doctor" | grep -qE "^(FAIL|error)"; then
  fail "naming missing mutation coverage does not fail the change"
else
  pass "naming missing mutation coverage does not fail the change"
fi
jq '.claims[0].capabilities += ["mutation"]' \
  openspec/changes/rework-the-pricing-engine/evidence.yaml > "$TMP/mutation-claims.json"
cp "$TMP/mutation-claims.json" openspec/changes/rework-the-pricing-engine/evidence.yaml
covered_doctor="$(node .claude/harness/foundation.mjs doctor \
  --stage change --change rework-the-pricing-engine 2>&1 || true)"
if printf '%s' "$covered_doctor" | grep -qF "mutation-coverage"; then
  fail "declaring a mutation provider clears the warning"
else
  pass "declaring a mutation provider clears the warning"
fi

# Abandon. Until this existed, a change nobody could prove had no terminal state
# at all: the only exit was deleting runtime files by hand, which no part of the
# workflow told anyone was allowed.
mkdir -p "$TMP/abandon"
cd "$TMP/abandon"
cp -R "$TMP/project/.claude" .
cp -R "$TMP/project/openspec" .
rm -rf openspec/changes .foundation
printf 'x\n' > app.txt
node .claude/harness/foundation.mjs new 'Retire an unprovable change' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve retire-an-unprovable-change \
  --impact low --coupling isolated >/dev/null
assert_cmd_fails_with "abandon requires a reason" "--reason" \
  node .claude/harness/foundation.mjs abandon retire-an-unprovable-change
assert_cmd_fails_with "abandon requires a recorded user decision" "--decision-ref" \
  node .claude/harness/foundation.mjs abandon retire-an-unprovable-change \
    --reason 'evidence contract cannot be satisfied'

# An applied workspace is the user's to keep or undo; abandon never guesses.
jq '.workspace = {"applied": true, "mode": "copy",
  "apply": {"transactionId": "t-missing", "touchedPaths": ["app.txt"]}}' \
  .foundation/runtime/retire-an-unprovable-change.json > "$TMP/applied-state.json"
cp "$TMP/applied-state.json" .foundation/runtime/retire-an-unprovable-change.json
applied_block="$({ node .claude/harness/foundation.mjs abandon \
  retire-an-unprovable-change --reason 'unprovable' \
  --decision-ref host://decision/abandon-1; } 2>&1 || true)"
assert_contains "abandon stops on an applied workspace" \
  "$applied_block" 'abandon-applied-workspace'
assert_contains "abandon offers keeping the applied files" "$applied_block" '"id": "keep"'
assert_contains "abandon offers reverting the applied files" "$applied_block" '"id": "revert"'
assert_contains "abandon preserves pause" "$applied_block" '"id": "pause"'
assert_file_exists "a stopped abandon changes nothing" \
  .foundation/runtime/retire-an-unprovable-change.json
assert_cmd_fails_with "abandon cannot revert without its journal" "journal is missing" \
  node .claude/harness/foundation.mjs abandon retire-an-unprovable-change \
    --reason 'unprovable' --decision-ref host://decision/abandon-1 --applied revert

node .claude/harness/foundation.mjs abandon retire-an-unprovable-change \
  --reason 'evidence contract cannot be satisfied' \
  --decision-ref host://decision/abandon-1 --applied keep >/dev/null
assert_file_absent "abandon retires the active change" \
  openspec/changes/retire-an-unprovable-change
assert_file_absent "abandon retires the runtime state" \
  .foundation/runtime/retire-an-unprovable-change.json
assert_file_exists "abandon quarantines rather than deletes" \
  .foundation/recovery/abandoned/retire-an-unprovable-change/runtime.json
assert_file_exists "abandon keeps the retired change record" \
  .foundation/recovery/abandoned/retire-an-unprovable-change/change/tasks.md
assert_file_contains "abandon records the authorizing decision" \
  .foundation/logs/abandoned.jsonl 'host://decision/abandon-1'
assert_file_contains "abandon records the reason" \
  .foundation/logs/abandoned.jsonl 'evidence contract cannot be satisfied'
assert_not_contains "an abandoned change leaves the active list" \
  "$(node .claude/harness/foundation.mjs changes 2>&1)" 'retire-an-unprovable-change'

# A crashed worker never releases its own lease, so readiness telling the host to
# release a stale one has to correspond to a release the host can actually run.
mkdir -p .foundation/leases/tasks/lease-fixture
stale_expiry="$(node -e 'console.log(new Date(Date.now() - 60000).toISOString())')"
live_expiry="$(node -e 'console.log(new Date(Date.now() + 600000).toISOString())')"
write_lease() {
  printf '{"version":1,"changeId":"lease-fixture","taskId":"T1","owner":"crashed-worker","resources":[],"expiresAt":"%s"}\n' \
    "$1" > .foundation/leases/tasks/lease-fixture/T1.json
}
write_lease "$stale_expiry"
assert_cmd_fails_with "a foreign lease is not released by mistake" "crashed-worker" \
  node .claude/harness/foundation.mjs agent-release lease-fixture T1 --owner other-worker
write_lease "$live_expiry"
assert_cmd_fails_with "forcing a live lease costs an explicit decision" "--decision-ref" \
  node .claude/harness/foundation.mjs agent-release lease-fixture T1 \
    --owner other-worker --force
assert_cmd_zero "an explicit decision takes over a live lease" \
  node .claude/harness/foundation.mjs agent-release lease-fixture T1 \
    --owner other-worker --force --decision-ref host://decision/lease-1
write_lease "$stale_expiry"
assert_cmd_zero "an expired lease is force-released without ceremony" \
  node .claude/harness/foundation.mjs agent-release lease-fixture T1 \
    --owner other-worker --force
assert_file_absent "a released lease leaves no index behind" \
  .foundation/leases/tasks/lease-fixture/T1.json
# Takeover is `release`'s, not `acquire`'s: acquire reads nothing but --owner.
# Its flag spec was copied from release and swallowed both takeover flags in
# silence, so a caller reaching for a takeover got a plain contended acquire and
# an exit code that read as a considered refusal.
assert_cmd_fails_with "acquire does not pretend to accept a takeover" \
  "supported: --owner <value>" \
  node .claude/harness/foundation.mjs agent-acquire lease-fixture T1 \
    --owner other-worker --force
assert_cmd_fails_with "acquire does not pretend to accept a takeover decision" \
  "supported: --owner <value>" \
  node .claude/harness/foundation.mjs agent-acquire lease-fixture T1 \
    --owner other-worker --decision-ref host://decision/lease-2
