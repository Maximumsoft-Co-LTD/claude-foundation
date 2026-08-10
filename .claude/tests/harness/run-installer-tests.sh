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
assert_file_exists "diagnostics runtime installed" \
  "$TARGET/.claude/harness/runtime/core/diagnostics-runtime.mjs"
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
assert_file_exists "apply runtime installed" \
  "$TARGET/.claude/harness/runtime/workflow/apply-runtime.mjs"
assert_file_exists "command registry installed" "$TARGET/.claude/harness/commands.json"
assert_cmd_zero "command registry has one unique entry per public name" \
  jq -e '([.commands[].name] | length) == ([.commands[].name] | unique | length)' \
  "$TARGET/.claude/harness/commands.json"
assert_eq "agent command surface is bounded" "17" \
  "$(jq '[.commands[] | select(.audience == "agent")] | length' \
    "$TARGET/.claude/harness/commands.json")"
assert_eq "conditional recovery surface is bounded" "14" \
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
assert_file_exists "Claude session context hook installed" \
  "$TARGET/.claude/hooks/session-context.sh"
assert_file_exists "portable agent contract installed" "$TARGET/.claude/harness/AGENT.md"
assert_file_contains "portable agent contract translates machine output" \
  "$TARGET/.claude/harness/AGENT.md" "Harness output is a machine handoff"
assert_file_exists "evidence adapter guide installed" "$TARGET/.claude/harness/EVIDENCE.md"
assert_file_exists "standard schema installed" "$TARGET/openspec/schemas/foundation-standard/schema.yaml"
assert_file_exists "repository topology default installed" "$TARGET/openspec/repositories.yaml"
assert_file_exists "model policy default installed" "$TARGET/foundation.json"
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
doctor="$(bash "$ROOT/cli.sh" --project "$TARGET" doctor)"
assert_contains "native doctor reports runtime readiness" "$doctor" "node:"
assert_contains "native doctor exposes opt-in branch policy" "$doctor" "no-direct-main:"

CLI="bash $ROOT/cli.sh"
providers="$(bash "$ROOT/cli.sh" --project "$TARGET" providers)"
assert_contains "native CLI exposes installed providers" "$providers" "dependency-supply-chain"
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
  '"report":"test-results/atomic.json","minimum":1,"timeoutMs":120000}},"services":{}}}' \
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
  '"report":"test-results/atomic.json","minimum":1,"timeoutMs":120000}},"services":{}}}' \
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
mkdir -p "$CURSOR_TARGET"
assert_cmd_zero "cursor adapter installs" \
  bash "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes
assert_file_exists "cursor change command installed" "$CURSOR_TARGET/.cursor/commands/change.md"
assert_file_contains "cursor change command accepts explicit prototype handoff" \
  "$CURSOR_TARGET/.cursor/commands/change.md" "--prototype-selection <path>"
assert_file_contains "cursor investigate command owns bounded comparison" \
  "$CURSOR_TARGET/.cursor/commands/investigate.md" "--compare"
assert_file_absent "cursor prototype command is retired" \
  "$CURSOR_TARGET/.cursor/commands/prototype.md"
assert_file_absent "cursor review command is proof-internal" \
  "$CURSOR_TARGET/.cursor/commands/review.md"
assert_file_exists "cursor orchestrator installed" "$CURSOR_TARGET/.cursor/orchestrator.md"
assert_file_exists "shared runtime installed for cursor" "$CURSOR_TARGET/.claude/harness/foundation.mjs"

finish "installer"
