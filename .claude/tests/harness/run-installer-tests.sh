#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
assert_file_contains "Homebrew source package includes required model policy" \
  "$ROOT/Formula/claude-foundation.rb" '"foundation.json"'
cli_help="$(bash "$ROOT/cli.sh" help)"
assert_contains "CLI help documents proof readiness" \
  "$cli_help" 'proof readiness <change>'
assert_contains "CLI help documents pre-review evidence collection" \
  "$cli_help" 'proof collect <change>'
assert_contains "CLI help documents canonical proof run" \
  "$cli_help" 'proof run <change>'
assert_contains "CLI help documents budget recovery" \
  "$cli_help" 'budget continue <change>'
assert_contains "CLI help documents resumable budget checkpoints" \
  "$cli_help" 'budget checkpoint <change>'
assert_contains "CLI help documents traceability audit" \
  "$cli_help" 'change audit <change> [--json]'
assert_contains "CLI help documents evidence detection" \
  "$cli_help" 'evidence detect <change>'
assert_contains "CLI help documents explicit evidence initialization" \
  "$cli_help" 'evidence init <change> [--write]'
assert_contains "CLI help documents evidence diagnosis" \
  "$cli_help" 'evidence doctor <change>'
if printf '%s' "$cli_help" | grep -qF 'proof execute'; then
  fail "default CLI help hides internal proof commands"
else
  pass "default CLI help hides internal proof commands"
fi
if printf '%s' "$cli_help" | grep -Eq 'telemetry (sync|import)|dashboard|runtime <'; then
  fail "default CLI help hides host and administration commands"
else
  pass "default CLI help hides host and administration commands"
fi
cli_help_all="$(bash "$ROOT/cli.sh" help --all)"
assert_contains "full CLI help retains compatibility diagnostics" \
  "$cli_help_all" 'proof execute <change>'
assert_contains "full CLI help publishes the host instruction endpoint" \
  "$cli_help_all" 'host instruction <command>'
assert_contains "full CLI help publishes the host agent-contract endpoint" \
  "$cli_help_all" 'host agent-contract'
host_instruction_tmp="$TMP/host-instruction-outside-project"
mkdir -p "$host_instruction_tmp"
host_instruction="$(cd "$host_instruction_tmp" && bash "$ROOT/cli.sh" host instruction changes)"
assert_contains "host instruction succeeds without project discovery" \
  "$host_instruction" '"command":"changes"'
assert_contains "host instruction reports protocol 1" \
  "$host_instruction" '"protocol":1'
host_agent_contract="$(cd "$host_instruction_tmp" && bash "$ROOT/cli.sh" host agent-contract)"
assert_contains "host agent contract succeeds without project discovery" \
  "$host_agent_contract" '"contract":"# Foundation agent contract'
assert_contains "host agent contract reports protocol 1" \
  "$host_agent_contract" '"protocol":1'
mkdir -p "$TMP/unrelated-git/package"
git -C "$TMP/unrelated-git" init -q
cp "$ROOT/cli.sh" "$ROOT/VERSION" "$TMP/unrelated-git/package/"
packaged_version="$(bash "$TMP/unrelated-git/package/cli.sh" version)"
assert_eq "packaged CLI ignores unrelated ancestor Git metadata" \
  "claude-foundation $(tr -d '[:space:]' < "$ROOT/VERSION")" "$packaged_version"
TARGET="$TMP/project with space"
mkdir -p "$TARGET/.workflow/0001-legacy" "$TARGET/.claude/agents"
printf 'legacy\n' > "$TARGET/.workflow/0001-legacy/state.json"
printf 'old\n' > "$TARGET/.claude/agents/pm.md"
printf '# User project\n' > "$TARGET/CLAUDE.md"
mkdir -p "$TARGET/.claude"
# The second matcher carries the phase guard as an earlier release wired it. The
# guard has since moved to a shell prefilter, and `upsert` matches on the command
# string — so without retirement the upgrade would leave both wired and every
# mutating call would pay for the guard twice.
printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Agent","hooks":[{"type":"command","command":"${CLAUDE_PROJECT_DIR}/.claude/hooks/dev-agent-guard.sh"},{"type":"command","command":"user-hook.sh"}]},{"matcher":"Edit|Write|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}\"/.claude/hooks/phase-mutation-guard.mjs","timeout":5}]}]}}' > "$TARGET/.claude/settings.json"

assert_cmd_zero "installer applies non-interactively" \
  bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_file_exists "change command installed" "$TARGET/.claude/commands/change.md"
assert_file_contains "installed change command accepts explicit prototype handoff" \
  "$TARGET/.claude/commands/change.md" "--prototype-selection <path>"
assert_file_contains "investigate command owns bounded comparison" \
  "$TARGET/.claude/commands/investigate.md" "--compare"
assert_file_absent "prototype is no longer a separate command" \
  "$TARGET/.claude/commands/prototype.md"
assert_file_absent "review is proof-internal" \
  "$TARGET/.claude/commands/review.md"
assert_file_exists "harness installed" "$TARGET/.claude/harness/foundation.mjs"
assert_file_exists "shared trust runtime installed" "$TARGET/.claude/harness/runtime/core/trust.mjs"
assert_file_exists "evidence bootstrap runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/evidence-bootstrap.mjs"
assert_file_exists "budget runtime installed" "$TARGET/.claude/harness/runtime/workflow/budget.mjs"
assert_file_exists "authority runtime installed" "$TARGET/.claude/harness/runtime/workflow/authority.mjs"
assert_file_exists "agent planner runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/agent-planning.mjs"
assert_file_exists "CLI router runtime installed" "$TARGET/.claude/harness/runtime/core/cli-router.mjs"
assert_file_exists "state runtime installed" "$TARGET/.claude/harness/runtime/core/state-runtime.mjs"
assert_file_exists "canonical change-artifact contract installed" \
  "$TARGET/.claude/harness/runtime/contracts/change-artifacts.mjs"
assert_file_exists "change-artifact compatibility path retained" \
  "$TARGET/.claude/harness/runtime/workflow/change-artifacts.mjs"
assert_cmd_zero "change-artifact compatibility path exports the canonical parser API" \
  node --input-type=module -e '
    const [canonical, compatibility] = await Promise.all([
      import(process.argv[1]), import(process.argv[2])
    ]);
    for (const name of ["parseSpecRequirements", "taskBlocks", "taskMetadata"])
      if (canonical[name] !== compatibility[name]) process.exit(1);
  ' "$TARGET/.claude/harness/runtime/contracts/change-artifacts.mjs" \
    "$TARGET/.claude/harness/runtime/workflow/change-artifacts.mjs"
assert_file_exists "diagnostics runtime installed" \
  "$TARGET/.claude/harness/runtime/core/diagnostics-runtime.mjs"
assert_file_exists "shared process lock runtime installed" \
  "$TARGET/.claude/harness/runtime/core/process-lock.mjs"
assert_file_exists "runtime architecture guide installed" "$TARGET/.claude/harness/runtime/README.md"
assert_file_exists "repository topology runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/repository-topology.mjs"
assert_file_exists "provider scheduler runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/provider-scheduler.mjs"
assert_file_exists "review protocol runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/review-protocol.mjs"
assert_file_exists "artifact store installed" \
  "$TARGET/.claude/harness/runtime/evidence/artifact-store.mjs"
assert_file_exists "evidence contract runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/evidence-contract.mjs"
assert_file_exists "proof readiness runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/proof-readiness.mjs"
assert_file_exists "receipt runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/receipt-runtime.mjs"
assert_file_exists "adapter runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/adapter-runtime.mjs"
assert_file_exists "proof execution runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/proof-execution-runtime.mjs"
assert_file_exists "review attempt store installed" \
  "$TARGET/.claude/harness/runtime/evidence/review-attempt-store.mjs"
assert_file_exists "metrics runtime installed" \
  "$TARGET/.claude/harness/runtime/observability/metrics-runtime.mjs"
assert_file_exists "telemetry runtime installed" \
  "$TARGET/.claude/harness/runtime/observability/telemetry-runtime.mjs"
assert_file_exists "sandbox runtime installed" "$TARGET/.claude/harness/runtime/workflow/sandbox-runtime.mjs"
assert_file_exists "Land journal runtime installed" "$TARGET/.claude/harness/runtime/workflow/land-journal.mjs"
assert_file_exists "proof runtime installed" "$TARGET/.claude/harness/runtime/evidence/proof-runtime.mjs"
assert_file_exists "change lifecycle runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/change-lifecycle.mjs"
assert_file_exists "change validation runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/change-validation.mjs"
assert_file_exists "packet runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/packet-runtime.mjs"
assert_file_exists "lease runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/lease-runtime.mjs"
assert_file_exists "authority bridge runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/authority-runtime.mjs"
assert_file_exists "Land runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/land-runtime.mjs"
assert_file_exists "external handoff runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/handoff-runtime.mjs"
assert_file_exists "apply runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/apply-runtime.mjs"
assert_file_exists "command registry installed" "$TARGET/.claude/harness/commands.json"
assert_cmd_zero "command registry has one unique entry per public name" \
  jq -e '([.commands[].name] | length) == ([.commands[].name] | unique | length)' \
  "$TARGET/.claude/harness/commands.json"
# The additional read-only surface is the resumable budget checkpoint; it does
# not grant authority or widen the continuation surface below.
assert_eq "agent command surface is bounded" "21" \
  "$(jq '[.commands[] | select(.audience == "agent")] | length' \
    "$TARGET/.claude/harness/commands.json")"
# 28 includes the bounded proof controller, its internal execution commands,
# explicit authority dispatch/abort/configured-reviewer/reset routes,
# consumer-quality reporting, and the operator-owned handoff record. Keep this
# count intentional so a newly exposed recovery command cannot appear silently.
assert_eq "conditional recovery surface is bounded" "28" \
  "$(jq '[.commands[] | select(.audience == "conditional")] | length' \
    "$TARGET/.claude/harness/commands.json")"
assert_cmd_zero "provider-running proof commands are not marked retry-safe" \
  jq -e '[.commands[] | select(.name == "proof collect" or .name == "proof run") |
    .idempotent] == [false, false]' "$TARGET/.claude/harness/commands.json"
assert_cmd_zero "operator continuations and child Land records require decision references" \
  jq -e '[.commands[] | select(.name == "budget continue" or .name == "land record") |
    (.kind == "authority" and (.usage | contains("--decision-ref")))] | all' \
    "$TARGET/.claude/harness/commands.json"
assert_file_exists "harness operator guide installed" "$TARGET/.claude/harness/README.md"
assert_file_exists "consumer quality guide installed" \
  "$TARGET/.claude/harness/CONSUMER-QUALITY.md"
assert_file_contains "consumer quality guide documents fail-closed repository coverage" \
  "$TARGET/.claude/harness/CONSUMER-QUALITY.md" \
  "A selected repository missing from config fails"
assert_file_exists "Claude session context hook installed" \
  "$TARGET/.claude/hooks/session-context.sh"
assert_file_exists "portable agent contract installed" "$TARGET/.claude/harness/AGENT.md"
assert_file_contains "portable agent contract translates machine output" \
  "$TARGET/.claude/harness/AGENT.md" "Harness output is a machine handoff"
assert_file_exists "developer setup guide installed" "$TARGET/.claude/harness/DEVELOPER-SETUP.md"
assert_file_contains "developer setup guide pins Codex login" \
  "$TARGET/.claude/harness/DEVELOPER-SETUP.md" "codex login"
assert_file_contains "developer setup guide pins Claude Code login" \
  "$TARGET/.claude/harness/DEVELOPER-SETUP.md" "claude auth login"
assert_file_exists "configured reviewer runtime installed" \
  "$TARGET/.claude/harness/runtime/evidence/configured-reviewer.mjs"
assert_file_exists "evidence adapter guide installed" "$TARGET/.claude/harness/EVIDENCE.md"
assert_file_exists "standard schema installed" "$TARGET/openspec/schemas/foundation-standard/schema.yaml"
assert_file_exists "repository topology default installed" "$TARGET/openspec/repositories.yaml"
assert_file_exists "model policy default installed" "$TARGET/foundation.json"
assert_cmd_zero "Claude Code reviewer profile is installed" \
  jq -e '.review.reviewers["claude-opus"] | .adapter == "claude-cli" and
    .providerFamily == "anthropic" and .sandbox == "read-only" and
    .ephemeral == true' "$TARGET/foundation.json"
assert_file_exists "runtime ignore installed" "$TARGET/.foundation/.gitignore"
# Ask git what it ignores rather than matching directory names in the file. The
# name-matching version passed while `authority/`, `attestations/`, and
# `install-manifest.txt` were all leaking into `git status`, because it could
# only check the names someone had already remembered to add.
ignores() {
  git -C "$TARGET" check-ignore -q ".foundation/$1"
}
tracked_after_install() {
  git -C "$TARGET" check-ignore -q ".foundation/$1" && return 1
  return 0
}
git -C "$TARGET" init -q . 2>/dev/null || true
for machine_state in \
  runtime receipts logs evidence snapshots sandboxes repository-sandboxes \
  transactions plans leases prototypes instruction-manifests recovery \
  authority attestations install-manifest.txt
do
  assert_cmd_zero "machine state stays out of history: $machine_state" \
    ignores "$machine_state"
done
assert_cmd_zero "the ignore file itself stays tracked" tracked_after_install ".gitignore"
assert_cmd_zero "the runtime README stays tracked" tracked_after_install "README.md"
assert_file_absent "obsolete packaged hook tests removed" "$TARGET/.claude/hooks/tests"
assert_file_exists "legacy run preserved" "$TARGET/.workflow/0001-legacy/state.json"
assert_file_absent "legacy lifecycle agent removed" "$TARGET/.claude/agents/pm.md"
if grep -qF "dev-agent-guard.sh" "$TARGET/.claude/settings.json"; then
  fail "legacy hook wiring removed"
else
  pass "legacy hook wiring removed"
fi
assert_file_contains "user hook wiring preserved" "$TARGET/.claude/settings.json" "user-hook.sh"
assert_file_not_contains "superseded phase guard command retired on upgrade" \
  "$TARGET/.claude/settings.json" "phase-mutation-guard.mjs"
assert_eq "exactly one phase guard is wired after upgrade" "1" \
  "$(grep -c 'phase-mutation-guard\.sh' "$TARGET/.claude/settings.json")"
assert_eq "exactly one authoring surface guard is wired after upgrade" "1" \
  "$(grep -c 'authoring-surface-guard\.sh' "$TARGET/.claude/settings.json")"
assert_file_exists "authoring surface guard is installed" \
  "$TARGET/.claude/hooks/authoring-surface-guard.mjs"
assert_file_contains "request telemetry binds once at session lifecycle" \
  "$TARGET/.claude/settings.json" "session-context.sh"
assert_file_contains "user CLAUDE content preserved" "$TARGET/CLAUDE.md" "# User project"
assert_file_contains "managed change-loop pointer added" "$TARGET/CLAUDE.md" "claude-foundation:change-loop:start"
assert_file_contains "portable AGENTS pointer added" "$TARGET/AGENTS.md" "claude-foundation:portable-agent:start"
assert_file_exists "managed install manifest written" "$TARGET/.foundation/install-manifest.txt"
printf 'stale\n' > "$TARGET/.claude/harness/stale-owned.md"
printf 'legacy command\n' > "$TARGET/.claude/commands/prototype.md"
printf 'legacy command\n' > "$TARGET/.claude/commands/review.md"
printf '%s\n' ".claude/harness/stale-owned.md" \
  ".claude/commands/prototype.md" ".claude/commands/review.md" >> \
  "$TARGET/.foundation/install-manifest.txt"
printf '\nUser agent instruction.\n' >> "$TARGET/AGENTS.md"
# The manifest drives a delete loop, so a tampered entry must be refused rather
# than resolved. A prefix check alone let `.claude/../../..` through.
outside_probe="$TMP/outside-manifest-probe.txt"
printf 'do not delete me\n' > "$outside_probe"
cp "$TARGET/.foundation/install-manifest.txt" "$TMP/manifest-backup.txt"
printf '%s\n' ".claude/../../../$(basename "$TMP")/outside-manifest-probe.txt" >> \
  "$TARGET/.foundation/install-manifest.txt"
if bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes >/dev/null 2>&1; then
  fail "installer refuses a traversing managed manifest path"
else
  pass "installer refuses a traversing managed manifest path"
fi
assert_file_exists "a refused manifest path deletes nothing outside the project" \
  "$outside_probe"
cp "$TMP/manifest-backup.txt" "$TARGET/.foundation/install-manifest.txt"
assert_cmd_zero "installer update removes only stale managed files" \
  bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_file_absent "stale managed file removed from prior manifest" \
  "$TARGET/.claude/harness/stale-owned.md"
assert_file_absent "retired prototype command removed on upgrade" \
  "$TARGET/.claude/commands/prototype.md"
assert_file_absent "retired review command removed on upgrade" \
  "$TARGET/.claude/commands/review.md"
assert_file_contains "user AGENTS content survives managed block update" \
  "$TARGET/AGENTS.md" "User agent instruction."
assert_cmd_zero "installed harness starts" \
  node "$TARGET/.claude/harness/foundation.mjs" version
cp "$TARGET/.claude/harness/commands.json" "$TMP/commands-valid.json"
jq '.commands += [.commands[0]]' "$TMP/commands-valid.json" \
  > "$TARGET/.claude/harness/commands.json"
if node "$TARGET/.claude/harness/foundation.mjs" version >/dev/null 2>&1; then
  fail "runtime rejects an invalid command registry"
else
  pass "runtime rejects an invalid command registry"
fi
cp "$TMP/commands-valid.json" "$TARGET/.claude/harness/commands.json"
# This smoke check exercises the installed runtime and branch-policy surface.
# Reviewer readiness belongs to the configured-reviewer suite; selecting Build
# keeps this fixture hermetic on CI hosts that intentionally have no agent CLI.
doctor="$(bash "$ROOT/cli.sh" --project "$TARGET" doctor --stage build)"
assert_contains "native doctor reports runtime readiness" "$doctor" "node:"
assert_contains "native doctor exposes opt-in branch policy" "$doctor" "no-direct-main:"

CLI="bash $ROOT/cli.sh"
providers="$(bash "$ROOT/cli.sh" --project "$TARGET" providers)"
assert_contains "native CLI exposes installed providers" "$providers" "dependency-supply-chain"
# These two drafts predate Grounding v2 and exercise only atomic lifecycle
# compatibility. Run them under the explicit legacy-optional policy, then
# restore the installed required policy before later installer assertions.
cp "$TARGET/foundation.json" "$TMP/foundation-required.json"
jq '.workflow.grounding = "optional" |
    .workflow.reviewPolicy = "legacy" |
    .workflow.reviewCircuit = "legacy"' "$TARGET/foundation.json" \
  > "$TMP/foundation-atomic.json"
cp "$TMP/foundation-atomic.json" "$TARGET/foundation.json"
start_template="$(bash "$ROOT/cli.sh" --project "$TARGET" change start --template)"
assert_contains "atomic start exposes a versioned draft template" \
  "$start_template" '"version": 1'
assert_contains "atomic start template includes executable evidence" \
  "$start_template" '"adapter": "test-discovery"'
assert_contains "atomic start template requires an acceptance decision" \
  "$start_template" '"acceptance": {'
printf '%s\n' '#!/usr/bin/env sh' \
  'mkdir -p test-results' \
  'printf "%s\n" "{\"numTotalTests\":1}" > test-results/atomic.json' \
  > "$TARGET/atomic-test.sh"
chmod +x "$TARGET/atomic-test.sh"
printf 'before\n' > "$TARGET/app.txt"
printf '%s\n' \
  '{"version":1,"id":"atomic-start","intent":"Atomic start",' \
  '"why":"Reduce orchestration turns.","currentState":"The flow is manually scaffolded.",' \
  '"compatibility":"No public compatibility impact.",' \
  '"acceptance":{"required":false,"reason":null,"claimIds":[]},' \
  '"changes":["Start one isolated rapid build."],"nonGoals":["No Land."],' \
  '"decisions":[{"choice":"Use atomic start","why":"Fewer turns","rejected":"Manual scaffolding"}],' \
  '"risks":[{"risk":"Invalid draft","mitigation":"Validate before Build","owner":"runtime"}],' \
  '"tasks":[{"id":"T001","outcome":"Verify atomic flow","kind":"implementation","paths":["app.txt"],"verify":"sh atomic-test.sh"}],' \
  '"claims":[{"id":"atomic-outcome","scenario":"Atomic flow passes","impact":"low","capabilities":["test"]}],' \
  '"specs":[{"name":"atomic","requirement":"Atomic start","description":"The runtime SHALL start an isolated Build.",' \
  '"scenario":"Valid draft","when":"a valid rapid draft is supplied","then":"an isolated Build packet is returned"}],' \
  '"execution":{"version":1,"providers":{"test":{"adapter":"test-discovery","command":["sh","atomic-test.sh"],' \
  '"report":"test-results/atomic.json","inputs":["atomic-test.sh"],"minimum":1,"timeoutMs":120000}},"services":{}}}' \
  > "$TARGET/.foundation/atomic-draft.json"
atomic_start="$(bash "$ROOT/cli.sh" --project "$TARGET" change start \
  .foundation/atomic-draft.json)"
assert_contains "atomic start returns a Build packet" "$atomic_start" \
  '"changeId":"atomic-start"'
assert_eq "atomic start enters Build" "building" \
  "$(jq -r '.status' "$TARGET/.foundation/runtime/atomic-start.json")"
atomic_workspace="$(jq -r '.workspace.path' \
  "$TARGET/.foundation/runtime/atomic-start.json")"
assert_in "atomic start creates isolation" \
  "$(jq -r '.workspace.mode' "$TARGET/.foundation/runtime/atomic-start.json")" \
  "worktree copy"
active_changes="$(bash "$ROOT/cli.sh" --project "$TARGET" changes)"
assert_contains "changes returns a canonical next action" "$active_changes" \
  "claude-foundation proof readiness atomic-start"
sed -i.bak 's/- \[ \]/- [x]/' \
  "$atomic_workspace/openspec/changes/atomic-start/tasks.md"
rm "$atomic_workspace/openspec/changes/atomic-start/tasks.md.bak"
atomic_proof="$(bash "$ROOT/cli.sh" --project "$TARGET" proof run atomic-start)"
assert_contains "atomic proof finish reaches PASS" "$atomic_proof" '"status": "PASS"'
assert_eq "atomic proof finish persists proven state" "proven" \
  "$(jq -r '.status' "$TARGET/.foundation/runtime/atomic-start.json")"
rm -rf "$atomic_workspace" \
  "$TARGET/openspec/changes/atomic-start" \
  "$TARGET/.foundation/runtime/atomic-start.json" \
  "$TARGET/.foundation/logs/atomic-start" \
  "$TARGET/.foundation/receipts/atomic-start" \
  "$TARGET/.foundation/proofs/atomic-start.json" \
  "$TARGET/.foundation/proof-runs/atomic-start"
printf '%s\n' \
  '{"version":1,"id":"atomic-migration","intent":"Payment ledger migration",' \
  '"impact":"high","coupling":"coupled","size":"S","securityTriggers":["migration"],' \
  '"why":"Preserve exact payment values.","currentState":"Amounts use decimal strings.",' \
  '"compatibility":"Preserve the legacy amount field for mixed-version readers.",' \
  '"acceptance":{"required":false,"reason":null,"claimIds":[]},' \
  '"changes":["Add exact integer cents."],"nonGoals":["No destructive rewrite."],' \
  '"decisions":[{"choice":"Add amountCents","why":"Exact arithmetic","rejected":"Floating point"}],' \
  '"risks":[{"risk":"Incorrect money conversion","mitigation":"Migration tests and review","owner":"implementation"}],' \
  '"tasks":[{"id":"T001","outcome":"Implement compatible migration","kind":"migration","paths":["app.txt"],"verify":"sh atomic-test.sh"}],' \
  '"claims":[{"id":"migration-safe","scenario":"Migration preserves values","impact":"high","capabilities":["test","data-migration","compatibility","review"]}],' \
  '"specs":[{"name":"payment-migration","requirement":"Exact compatible migration","description":"The system SHALL preserve payment values.",' \
  '"scenario":"Mixed-version migration","when":"a decimal amount is migrated","then":"exact cents and the legacy amount remain"}],' \
  '"execution":{"version":1,"providers":{"test":{"adapter":"test-discovery","command":["sh","atomic-test.sh"],' \
  '"report":"test-results/atomic.json","inputs":["atomic-test.sh"],"minimum":1,"timeoutMs":120000}},"services":{}}}' \
  > "$TARGET/.foundation/atomic-migration-draft.json"
standard_start="$(bash "$ROOT/cli.sh" --project "$TARGET" change start \
  .foundation/atomic-migration-draft.json)"
assert_contains "atomic standard start returns a Build packet" "$standard_start" \
  '"changeId":"atomic-migration"'
assert_eq "atomic standard start selects standard schema" "foundation-standard" \
  "$(jq -r '.schema' "$TARGET/.foundation/runtime/atomic-migration.json")"
assert_eq "atomic standard start preserves required review" "true" \
  "$(jq -r '.reviewRequired' "$TARGET/.foundation/runtime/atomic-migration.json")"
assert_eq "atomic standard start enters Build" "building" \
  "$(jq -r '.status' "$TARGET/.foundation/runtime/atomic-migration.json")"
standard_workspace="$(jq -r '.workspace.path' \
  "$TARGET/.foundation/runtime/atomic-migration.json")"
assert_in "atomic standard start creates isolation" \
  "$(jq -r '.workspace.mode' "$TARGET/.foundation/runtime/atomic-migration.json")" \
  "worktree copy"
rm -rf "$standard_workspace" \
  "$TARGET/openspec/changes/atomic-migration" \
  "$TARGET/.foundation/runtime/atomic-migration.json"
mkdir -p "$TARGET/nested/path"
assert_cmd_zero "native CLI discovers project from a subdirectory" \
  sh -c 'cd "$1" && bash "$2" changes' _ "$TARGET/nested/path" "$ROOT/cli.sh"

bash "$ROOT/cli.sh" --project "$TARGET" change new "CLI proof route" --rapid >/dev/null
packet="$(bash "$ROOT/cli.sh" --project "$TARGET" packet cli-proof-route)"
assert_contains "native CLI exposes compact handoff packet" "$packet" '"changeId":"cli-proof-route"'
plan="$(bash "$ROOT/cli.sh" --project "$TARGET" agents plan cli-proof-route)"
assert_contains "native CLI exposes summary-first agent plan" \
  "$plan" '"recommendedExecution":"single-agent"'
task_packet="$(bash "$ROOT/cli.sh" --project "$TARGET" packet \
  cli-proof-route --task T001)"
assert_contains "native CLI exposes task-scoped packet" \
  "$task_packet" '"packetType":"task"'
assert_file_exists "native CLI records operation telemetry" \
  "$TARGET/.foundation/logs/cli-proof-route/operations.jsonl"
assert_file_contains "unknown host usage remains null" \
  "$TARGET/.foundation/logs/cli-proof-route/operations.jsonl" '"inputTokens":null'
metrics="$(bash "$ROOT/cli.sh" --project "$TARGET" metrics cli-proof-route)"
assert_contains "native metrics reports operation-only measurement" \
  "$metrics" '"measurement": "operations-only"'
assert_contains "native metrics preserves unknown input tokens" \
  "$metrics" '"inputTokens": null'
assert_contains "native metrics reports emitted context" \
  "$metrics" '"estimatedTokens":'
assert_contains "native metrics includes the active budget window" \
  "$metrics" '"window":'
printf '%s\n' \
  '{"type":"assistant","requestId":"installed-claude-1","message":{"id":"installed-message-1","role":"assistant","model":"claude-test","usage":{"input_tokens":9,"output_tokens":4,"cache_read_input_tokens":3}}}' \
  > "$TMP/installed-transcript.jsonl"
telemetry="$(bash "$ROOT/cli.sh" --project "$TARGET" telemetry sync \
  cli-proof-route "$TMP/installed-transcript.jsonl")"
assert_contains "native CLI routes incremental Claude transcript sync" \
  "$telemetry" "imported 1"
assert_cmd_zero "native validate routes to project runtime" \
  bash "$ROOT/cli.sh" --project "$TARGET" change validate cli-proof-route
sed -i.bak 's/- \[ \]/- [x]/g' "$TARGET/openspec/changes/cli-proof-route/tasks.md"
rm "$TARGET/openspec/changes/cli-proof-route/tasks.md.bak"
assert_cmd_zero "native evidence run preserves command arguments" \
  bash "$ROOT/cli.sh" --project "$TARGET" evidence run cli-proof-route test \
  --claims declared -- \
  sh -c 'test "$1" = "two words"' _ "two words"
assert_cmd_zero "native evidence record routes receipt flags" \
  bash "$ROOT/cli.sh" --project "$TARGET" evidence record cli-proof-route \
  discovery pass --discovered 1 --minimum 1 --observed "1 test discovered" \
  --source installer-test --reference "fixture://installer-discovery"
assert_cmd_zero "native proof plan routes to project runtime" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof plan cli-proof-route
assert_cmd_zero "native proof collect routes pre-review evidence collection" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof collect cli-proof-route
assert_cmd_zero "native proof finalize creates proof" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof finalize cli-proof-route
assert_cmd_zero "native proof execute reuses complete external receipts" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof execute cli-proof-route
assert_cmd_zero "native proof finish routes the resumable proof path" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof finish cli-proof-route
assert_cmd_zero "native land check accepts fresh proof" \
  bash "$ROOT/cli.sh" --project "$TARGET" land check cli-proof-route
cp "$TMP/foundation-required.json" "$TARGET/foundation.json"

if bash "$ROOT/cli.sh" definitely-not-a-command >/dev/null 2>&1; then
  fail "unknown native command fails without entering installer"
else
  pass "unknown native command fails without entering installer"
fi
mkdir -p "$TMP/outside"
if (cd "$TMP/outside" && bash "$ROOT/cli.sh" providers >/dev/null 2>&1); then
  fail "native command outside a Foundation project fails clearly"
else
  pass "native command outside a Foundation project fails clearly"
fi
assert_cmd_zero "legacy explicit-path installation remains compatible" \
  bash "$ROOT/cli.sh" "$TARGET" --dry-run

# A project on a different runtime API moves its entrypoint AND its runtime
# modules together; editing only one simulates a torn install instead, which
# the load-time pair check rejects for its own reasons.
# Matched by shape, not by value: pinning the current API number here made this
# guard silently stop simulating anything the first time the number moved — the
# sed found nothing, the fixture stayed consistent, and the test that exists to
# prove a mismatch is refused was instead proving that a matched pair works.
sed -i.bak -E 's/const RUNTIME_API_VERSION = "[0-9]+"/const RUNTIME_API_VERSION = "999"/' \
  "$TARGET/.claude/harness/foundation.mjs"
rm "$TARGET/.claude/harness/foundation.mjs.bak"
sed -i.bak -E 's/export const RUNTIME_MODULE_API = "[0-9]+"/export const RUNTIME_MODULE_API = "999"/' \
  "$TARGET/.claude/harness/runtime/version.mjs"
rm "$TARGET/.claude/harness/runtime/version.mjs.bak"
assert_file_contains "the API mismatch fixture actually moved the entrypoint pin" \
  "$TARGET/.claude/harness/foundation.mjs" 'const RUNTIME_API_VERSION = "999"'
if bash "$ROOT/cli.sh" --project "$TARGET" change validate cli-proof-route >/dev/null 2>&1; then
  fail "runtime API mismatch blocks write commands"
else
  pass "runtime API mismatch blocks write commands"
fi
assert_cmd_zero "runtime API mismatch permits read-only inspection" \
  bash "$ROOT/cli.sh" --project "$TARGET" changes

# A torn install — entrypoint from one revision, runtime modules from another —
# used to pass every command up to `archive` and then throw partway through
# Land. It has to be refused at load, on any command.
sed -i.bak -E 's/export const RUNTIME_MODULE_API = "[0-9]+"/export const RUNTIME_MODULE_API = "998"/' \
  "$TARGET/.claude/harness/runtime/version.mjs"
rm "$TARGET/.claude/harness/runtime/version.mjs.bak"
assert_file_contains "the torn-install fixture leaves the two pins disagreeing" \
  "$TARGET/.claude/harness/runtime/version.mjs" 'export const RUNTIME_MODULE_API = "998"'
torn="$( (cd "$TARGET" && node .claude/harness/foundation.mjs changes) 2>&1 || true)"
assert_contains "a torn harness install is refused at load" \
  "$torn" "mixture of two revisions"

CURSOR_TARGET="$TMP/cursor-project"
mkdir -p "$CURSOR_TARGET/.cursor/commands" "$CURSOR_TARGET/.cursor/rules"
# Model the first upgrade after manifests ship: these exact paths were written
# unconditionally by the legacy adapter, while the neighboring file was not.
printf 'legacy orchestrator\n' > "$CURSOR_TARGET/.cursor/orchestrator.md"
printf 'legacy change command\n' > "$CURSOR_TARGET/.cursor/commands/change.md"
printf 'legacy fundamentals\n' > "$CURSOR_TARGET/.cursor/rules/fundamentals.mdc"
printf 'legacy guidance\n' > "$CURSOR_TARGET/.cursor/rules/foundation-human-guidance.mdc"
printf 'preexisting user command\n' > "$CURSOR_TARGET/.cursor/commands/preexisting-user.md"
printf 'user-owned prototype command\n' > "$CURSOR_TARGET/.cursor/commands/prototype.md"
printf 'user-owned review command\n' > "$CURSOR_TARGET/.cursor/commands/review.md"
assert_cmd_zero "cursor adapter installs" \
  bash "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes
assert_file_exists "cursor change command installed" "$CURSOR_TARGET/.cursor/commands/change.md"
assert_file_contains "cursor change command accepts explicit prototype handoff" \
  "$CURSOR_TARGET/.cursor/commands/change.md" "--prototype-selection <path>"
assert_file_contains "cursor investigate command owns bounded comparison" \
  "$CURSOR_TARGET/.cursor/commands/investigate.md" "--compare"
assert_file_contains "cursor preserves an unowned prototype command during migration" \
  "$CURSOR_TARGET/.cursor/commands/prototype.md" "user-owned prototype command"
assert_file_contains "cursor preserves an unowned review command during migration" \
  "$CURSOR_TARGET/.cursor/commands/review.md" "user-owned review command"
assert_file_exists "cursor orchestrator installed" "$CURSOR_TARGET/.cursor/orchestrator.md"
assert_file_exists "shared runtime installed for cursor" "$CURSOR_TARGET/.claude/harness/foundation.mjs"
# A bare .md→.mdc rename ships the always-on router as an agent-requested rule.
assert_file_contains "cursor rules router is always applied" \
  "$CURSOR_TARGET/.cursor/rules/fundamentals.mdc" "alwaysApply: true"
assert_file_contains "cursor human guidance is always applied" \
  "$CURSOR_TARGET/.cursor/rules/foundation-human-guidance.mdc" "alwaysApply: true"
assert_file_contains "cursor human guidance keeps routine recovery agent-owned" \
  "$CURSOR_TARGET/.cursor/rules/foundation-human-guidance.mdc" "never hand the user commands"
assert_file_exists "cursor adapter records exact ownership" \
  "$CURSOR_TARGET/.foundation/adapter-manifests/cursor.txt"
assert_file_contains "cursor first manifest upgrade refreshes legacy-owned paths" \
  "$CURSOR_TARGET/.cursor/commands/change.md" "Create or update"
assert_file_contains "cursor first manifest upgrade preserves unrelated user paths" \
  "$CURSOR_TARGET/.cursor/commands/preexisting-user.md" "preexisting user command"
printf 'user-owned project file\n' > "$CURSOR_TARGET/user-owned.txt"
cp "$CURSOR_TARGET/.foundation/adapter-manifests/cursor.txt" \
  "$TMP/cursor-manifest-backup.txt"
printf 'project\tuser-owned.txt\n' >> \
  "$CURSOR_TARGET/.foundation/adapter-manifests/cursor.txt"
printf 'must survive rejected manifest\n' > "$CURSOR_TARGET/.cursor/commands/change.md"
if bash "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes \
    >/dev/null 2>&1; then
  fail "cursor adapter refuses ownership outside its adapter roots"
else
  pass "cursor adapter refuses ownership outside its adapter roots"
fi
assert_file_contains "a refused adapter manifest deletes nothing user-owned" \
  "$CURSOR_TARGET/user-owned.txt" "user-owned project file"
assert_file_contains "adapter manifest is validated before managed writes" \
  "$CURSOR_TARGET/.cursor/commands/change.md" "must survive rejected manifest"
cp "$TMP/cursor-manifest-backup.txt" \
  "$CURSOR_TARGET/.foundation/adapter-manifests/cursor.txt"
printf 'retired Foundation command\n' > "$CURSOR_TARGET/.cursor/commands/retired-foundation.md"
printf 'user command\n' > "$CURSOR_TARGET/.cursor/commands/user-command.md"
printf 'project\t.cursor/commands/retired-foundation.md\n' >> \
  "$CURSOR_TARGET/.foundation/adapter-manifests/cursor.txt"
cursor_upgrade="$(bash "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes)"
assert_contains "cursor adapter reports native dispatch separately" \
  "$cursor_upgrade" "native dispatch available"
assert_contains "cursor adapter reports unavailable live guards" \
  "$cursor_upgrade" "live mutation guards unavailable"
assert_file_absent "cursor removes a retired owned command" \
  "$CURSOR_TARGET/.cursor/commands/retired-foundation.md"
assert_file_contains "cursor preserves an unowned user command" \
  "$CURSOR_TARGET/.cursor/commands/user-command.md" "user command"

OPENCODE_TARGET="$TMP/opencode-project"
mkdir -p "$OPENCODE_TARGET/.opencode/commands" "$OPENCODE_TARGET/.opencode/plugins"
printf 'legacy change command\n' > "$OPENCODE_TARGET/.opencode/commands/change.md"
printf 'legacy plugin\n' > "$OPENCODE_TARGET/.opencode/plugins/foundation.js"
printf 'preexisting user command\n' > "$OPENCODE_TARGET/.opencode/commands/preexisting-user.md"
printf 'user-owned prototype command\n' > "$OPENCODE_TARGET/.opencode/commands/prototype.md"
printf 'user-owned review command\n' > "$OPENCODE_TARGET/.opencode/commands/review.md"
assert_cmd_zero "opencode adapter installs" \
  bash "$ROOT/install-opencode.sh" "$OPENCODE_TARGET" --source "$ROOT" --yes
assert_file_exists "opencode change command installed" \
  "$OPENCODE_TARGET/.opencode/commands/change.md"
assert_file_exists "opencode guard plugin installed" \
  "$OPENCODE_TARGET/.opencode/plugins/foundation.js"
assert_file_exists "shared runtime installed for opencode" \
  "$OPENCODE_TARGET/.claude/harness/foundation.mjs"
assert_file_exists "opencode adapter records exact ownership" \
  "$OPENCODE_TARGET/.foundation/adapter-manifests/opencode.txt"
assert_file_contains "opencode first manifest upgrade refreshes legacy-owned commands" \
  "$OPENCODE_TARGET/.opencode/commands/change.md" "Create or update"
assert_file_contains "opencode first manifest upgrade refreshes legacy guard wiring" \
  "$OPENCODE_TARGET/.opencode/plugins/foundation.js" "FoundationGuard"
assert_file_contains "opencode first manifest upgrade preserves unrelated user paths" \
  "$OPENCODE_TARGET/.opencode/commands/preexisting-user.md" "preexisting user command"
assert_file_contains "opencode preserves an unowned prototype command during migration" \
  "$OPENCODE_TARGET/.opencode/commands/prototype.md" "user-owned prototype command"
assert_file_contains "opencode preserves an unowned review command during migration" \
  "$OPENCODE_TARGET/.opencode/commands/review.md" "user-owned review command"
printf 'retired Foundation command\n' > "$OPENCODE_TARGET/.opencode/commands/retired-foundation.md"
printf 'user command\n' > "$OPENCODE_TARGET/.opencode/commands/user-command.md"
printf 'project\t.opencode/commands/retired-foundation.md\n' >> \
  "$OPENCODE_TARGET/.foundation/adapter-manifests/opencode.txt"
opencode_upgrade="$(bash "$ROOT/install-opencode.sh" "$OPENCODE_TARGET" --source "$ROOT" --yes)"
assert_contains "opencode adapter reports native dispatch separately" \
  "$opencode_upgrade" "native dispatch available"
assert_contains "opencode adapter reports partial live guards" \
  "$opencode_upgrade" "live mutation guards partial"
assert_file_absent "opencode removes a retired owned command" \
  "$OPENCODE_TARGET/.opencode/commands/retired-foundation.md"
assert_file_contains "opencode preserves an unowned user command" \
  "$OPENCODE_TARGET/.opencode/commands/user-command.md" "user command"

# The plugin is an envelope over the shipped hooks, so drive it the way
# OpenCode does — import, build the hook set, fire tool.execute.before — and
# assert the same decisions the Claude Code wiring produces.
plugin_probe() {
  ( cd "$OPENCODE_TARGET" && \
    FOUNDATION_ACTIVE_PHASE="$1" FOUNDATION_GUARDRAIL_MODE="$2" \
    node --input-type=module -e '
      const [plugin, tool, argsJson] = process.argv.slice(1);
      const { FoundationGuard } = await import(plugin);
      const hooks = await FoundationGuard({ directory: process.cwd() });
      try {
        await hooks["tool.execute.before"](
          { tool, callID: "probe" }, { args: JSON.parse(argsJson) });
        console.log("ALLOWED");
      } catch (error) {
        console.log("BLOCKED: " + error.message);
      }
    ' "$OPENCODE_TARGET/.opencode/plugins/foundation.js" "$3" "$4" )
}

probe="$(plugin_probe prove block write '{"filePath":"src/app.js"}')"
assert_contains "opencode plugin enforces the phase guard" "$probe" "BLOCKED: phase guard"
if command -v jq >/dev/null 2>&1; then
  probe="$(plugin_probe "" audit read '{"filePath":".env"}')"
  assert_contains "opencode plugin enforces the secrets guard" \
    "$probe" "BLOCKED by secrets guard"
fi
probe="$(plugin_probe prove block read '{"filePath":"README.md"}')"
assert_eq "opencode plugin allows a harmless read" "ALLOWED" "$probe"

CODEX_TARGET="$TMP/codex-project"
CODEX_HOME_FIXTURE="$TMP/codex-home"
mkdir -p "$CODEX_TARGET"
assert_cmd_zero "codex adapter installs" \
  env CODEX_HOME="$CODEX_HOME_FIXTURE" \
  bash "$ROOT/install-codex.sh" "$CODEX_TARGET" --source "$ROOT" --yes
assert_file_exists "codex change prompt installed" \
  "$CODEX_HOME_FIXTURE/prompts/change.md"
assert_file_contains "codex prompt carries the ownership marker" \
  "$CODEX_HOME_FIXTURE/prompts/change.md" "claude-foundation:prompt"
assert_file_contains "portable AGENTS pointer serves codex" \
  "$CODEX_TARGET/AGENTS.md" "claude-foundation:portable-agent:start"
assert_file_exists "shared runtime installed for codex" \
  "$CODEX_TARGET/.claude/harness/foundation.mjs"
assert_file_exists "codex adapter records exact ownership" \
  "$CODEX_TARGET/.foundation/adapter-manifests/codex.txt"
assert_eq "codex feature skill links to the canonical Claude skill" \
  "../../.claude/skills/feature" \
  "$(readlink "$CODEX_TARGET/.agents/skills/feature")"
assert_eq "codex behavioral rules remain a canonical compatibility link" \
  "../.claude/rules" \
  "$(readlink "$CODEX_TARGET/.codex/foundation-rules")"
assert_eq "codex guard scripts remain readable but inert through one link" \
  "../.claude/hooks" \
  "$(readlink "$CODEX_TARGET/.codex/hooks")"
rm -f "$CODEX_TARGET/.codex/hooks"
mkdir -p "$CODEX_TARGET/.codex/hooks"
printf 'user directory content\n' > "$CODEX_TARGET/.codex/hooks/keep.txt"
if env CODEX_HOME="$CODEX_HOME_FIXTURE" \
    bash "$ROOT/install-codex.sh" "$CODEX_TARGET" --source "$ROOT" --yes \
    >/dev/null 2>"$TMP/codex-directory-refusal.txt"; then
  fail "codex refuses to replace an owned file path that became a directory"
else
  pass "codex refuses to replace an owned file path that became a directory"
fi
assert_file_contains "codex directory refusal preserves nested user content" \
  "$CODEX_TARGET/.codex/hooks/keep.txt" "user directory content"
assert_file_contains "codex directory refusal explains recovery" \
  "$TMP/codex-directory-refusal.txt" "move it before reinstalling"
rm -rf "$CODEX_TARGET/.codex/hooks"
# The prompt directory is user-global and shared; a same-named prompt without
# the Foundation marker belongs to the user and must survive a re-install.
printf 'my own build prompt\n' > "$CODEX_HOME_FIXTURE/prompts/build.md"
assert_cmd_zero "codex adapter reinstalls beside a user prompt" \
  env CODEX_HOME="$CODEX_HOME_FIXTURE" \
  bash "$ROOT/install-codex.sh" "$CODEX_TARGET" --source "$ROOT" --yes
assert_file_contains "codex adapter keeps the user prompt" \
  "$CODEX_HOME_FIXTURE/prompts/build.md" "my own build prompt"
assert_file_contains "codex adapter still refreshes its own prompts" \
  "$CODEX_HOME_FIXTURE/prompts/prove.md" "claude-foundation:prompt"
printf 'retired Foundation prompt\n' > "$CODEX_HOME_FIXTURE/prompts/retired-foundation.md"
printf 'codex-home\tprompts/retired-foundation.md\n' >> \
  "$CODEX_TARGET/.foundation/adapter-manifests/codex.txt"
codex_upgrade="$(env CODEX_HOME="$CODEX_HOME_FIXTURE" \
  bash "$ROOT/install-codex.sh" "$CODEX_TARGET" --source "$ROOT" --yes)"
assert_contains "codex adapter reports native dispatch separately" \
  "$codex_upgrade" "native dispatch available"
assert_contains "codex adapter reports unavailable live guards" \
  "$codex_upgrade" "live mutation guards unavailable"
assert_file_absent "codex removes a retired owned prompt" \
  "$CODEX_HOME_FIXTURE/prompts/retired-foundation.md"
assert_file_contains "codex preserves the unowned user prompt" \
  "$CODEX_HOME_FIXTURE/prompts/build.md" "my own build prompt"

# `init --host` is the routed spelling of the adapter installers — the only
# spelling a Homebrew install has, since the adapters live in libexec there.
HOST_ROUTE_TARGET="$TMP/host-route-project"
mkdir -p "$HOST_ROUTE_TARGET"
assert_cmd_zero "cli init routes a host adapter" \
  bash "$ROOT/cli.sh" init "$HOST_ROUTE_TARGET" --host opencode --yes
assert_file_exists "routed opencode install carries the guard plugin" \
  "$HOST_ROUTE_TARGET/.opencode/plugins/foundation.js"
assert_file_exists "routed opencode install carries the shared runtime" \
  "$HOST_ROUTE_TARGET/.claude/harness/foundation.mjs"
if bash "$ROOT/cli.sh" init "$HOST_ROUTE_TARGET" --host vscode --yes >/dev/null 2>&1; then
  fail "cli init refuses an unknown host"
else
  pass "cli init refuses an unknown host"
fi

finish "installer"
