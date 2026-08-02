#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
TARGET="$TMP/project with space"
mkdir -p "$TARGET/.workflow/0001-legacy" "$TARGET/.claude/agents"
printf 'legacy\n' > "$TARGET/.workflow/0001-legacy/state.json"
printf 'old\n' > "$TARGET/.claude/agents/pm.md"
printf '# User project\n' > "$TARGET/CLAUDE.md"
mkdir -p "$TARGET/.claude"
printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Agent","hooks":[{"type":"command","command":"${CLAUDE_PROJECT_DIR}/.claude/hooks/dev-agent-guard.sh"},{"type":"command","command":"user-hook.sh"}]}]}}' > "$TARGET/.claude/settings.json"

assert_cmd_zero "installer applies non-interactively" \
  bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_file_exists "change command installed" "$TARGET/.claude/commands/change.md"
assert_file_contains "installed change command accepts explicit prototype handoff" \
  "$TARGET/.claude/commands/change.md" "--prototype-selection <path>"
assert_file_exists "prototype command installed" "$TARGET/.claude/commands/prototype.md"
assert_cmd_zero "prototype command matches source" \
  cmp "$ROOT/.claude/commands/prototype.md" "$TARGET/.claude/commands/prototype.md"
assert_file_exists "review command installed" "$TARGET/.claude/commands/review.md"
assert_cmd_zero "review command matches source" \
  cmp "$ROOT/.claude/commands/review.md" "$TARGET/.claude/commands/review.md"
assert_file_exists "harness installed" "$TARGET/.claude/harness/foundation.mjs"
assert_file_exists "harness operator guide installed" "$TARGET/.claude/harness/README.md"
assert_file_exists "Claude session context hook installed" \
  "$TARGET/.claude/hooks/session-context.sh"
assert_file_exists "portable agent contract installed" "$TARGET/.claude/harness/AGENT.md"
assert_file_exists "evidence adapter guide installed" "$TARGET/.claude/harness/EVIDENCE.md"
assert_file_exists "standard schema installed" "$TARGET/openspec/schemas/foundation-standard/schema.yaml"
assert_file_exists "repository topology default installed" "$TARGET/openspec/repositories.yaml"
assert_file_exists "model policy default installed" "$TARGET/foundation.json"
assert_file_exists "runtime ignore installed" "$TARGET/.foundation/.gitignore"
assert_file_contains "prototype runtime artifacts stay ignored" \
  "$TARGET/.foundation/.gitignore" "prototypes/"
assert_file_absent "obsolete packaged hook tests removed" "$TARGET/.claude/hooks/tests"
assert_file_exists "legacy run preserved" "$TARGET/.workflow/0001-legacy/state.json"
assert_file_absent "legacy lifecycle agent removed" "$TARGET/.claude/agents/pm.md"
if grep -qF "dev-agent-guard.sh" "$TARGET/.claude/settings.json"; then
  fail "legacy hook wiring removed"
else
  pass "legacy hook wiring removed"
fi
assert_file_contains "user hook wiring preserved" "$TARGET/.claude/settings.json" "user-hook.sh"
assert_file_contains "request telemetry binds once at session lifecycle" \
  "$TARGET/.claude/settings.json" "session-context.sh"
assert_file_contains "user CLAUDE content preserved" "$TARGET/CLAUDE.md" "# User project"
assert_file_contains "managed change-loop pointer added" "$TARGET/CLAUDE.md" "claude-foundation:change-loop:start"
assert_file_contains "portable AGENTS pointer added" "$TARGET/AGENTS.md" "claude-foundation:portable-agent:start"
assert_file_exists "managed install manifest written" "$TARGET/.foundation/install-manifest.txt"
printf 'stale\n' > "$TARGET/.claude/harness/stale-owned.md"
printf '%s\n' ".claude/harness/stale-owned.md" >> \
  "$TARGET/.foundation/install-manifest.txt"
printf '\nUser agent instruction.\n' >> "$TARGET/AGENTS.md"
assert_cmd_zero "installer update removes only stale managed files" \
  bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_file_absent "stale managed file removed from prior manifest" \
  "$TARGET/.claude/harness/stale-owned.md"
assert_file_contains "user AGENTS content survives managed block update" \
  "$TARGET/AGENTS.md" "User agent instruction."
assert_cmd_zero "installed harness starts" \
  node "$TARGET/.claude/harness/foundation.mjs" version
doctor="$(bash "$ROOT/cli.sh" --project "$TARGET" doctor)"
assert_contains "native doctor reports runtime readiness" "$doctor" "node:"
assert_contains "native doctor exposes opt-in branch policy" "$doctor" "no-direct-main:"

CLI="bash $ROOT/cli.sh"
providers="$(bash "$ROOT/cli.sh" --project "$TARGET" providers)"
assert_contains "native CLI exposes installed providers" "$providers" "dependency-supply-chain"
mkdir -p "$TARGET/nested/path"
assert_cmd_zero "native CLI discovers project from a subdirectory" \
  sh -c 'cd "$1" && bash "$2" changes' _ "$TARGET/nested/path" "$ROOT/cli.sh"

bash "$ROOT/cli.sh" --project "$TARGET" runtime new "CLI proof route" --rapid >/dev/null
packet="$(bash "$ROOT/cli.sh" --project "$TARGET" packet cli-proof-route)"
assert_contains "native CLI exposes compact handoff packet" "$packet" '"changeId":"cli-proof-route"'
plan="$(bash "$ROOT/cli.sh" --project "$TARGET" agents plan cli-proof-route)"
assert_contains "native CLI exposes summary-first agent plan" \
  "$plan" '"recommendedExecution":"single-agent"'
task_packet="$(bash "$ROOT/cli.sh" --project "$TARGET" agents task \
  cli-proof-route T001)"
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
printf '%s\n' \
  '{"type":"assistant","requestId":"installed-claude-1","message":{"id":"installed-message-1","role":"assistant","model":"claude-test","usage":{"input_tokens":9,"output_tokens":4,"cache_read_input_tokens":3}}}' \
  > "$TMP/installed-transcript.jsonl"
telemetry="$(bash "$ROOT/cli.sh" --project "$TARGET" telemetry sync \
  cli-proof-route "$TMP/installed-transcript.jsonl")"
assert_contains "native CLI routes incremental Claude transcript sync" \
  "$telemetry" "imported 1"
assert_cmd_zero "native validate routes to project runtime" \
  bash "$ROOT/cli.sh" --project "$TARGET" validate cli-proof-route
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
assert_cmd_zero "native proof finalize creates proof" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof finalize cli-proof-route
assert_cmd_zero "native proof execute reuses complete external receipts" \
  bash "$ROOT/cli.sh" --project "$TARGET" proof execute cli-proof-route
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

sed -i.bak 's/const RUNTIME_API_VERSION = "8"/const RUNTIME_API_VERSION = "999"/' \
  "$TARGET/.claude/harness/foundation.mjs"
rm "$TARGET/.claude/harness/foundation.mjs.bak"
if bash "$ROOT/cli.sh" --project "$TARGET" validate cli-proof-route >/dev/null 2>&1; then
  fail "runtime API mismatch blocks write commands"
else
  pass "runtime API mismatch blocks write commands"
fi
assert_cmd_zero "runtime API mismatch permits read-only inspection" \
  bash "$ROOT/cli.sh" --project "$TARGET" changes

CURSOR_TARGET="$TMP/cursor-project"
mkdir -p "$CURSOR_TARGET"
assert_cmd_zero "cursor adapter installs" \
  bash "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes
assert_file_exists "cursor change command installed" "$CURSOR_TARGET/.cursor/commands/change.md"
assert_file_contains "cursor change command accepts explicit prototype handoff" \
  "$CURSOR_TARGET/.cursor/commands/change.md" "--prototype-selection <path>"
assert_file_exists "cursor prototype command installed" \
  "$CURSOR_TARGET/.cursor/commands/prototype.md"
assert_cmd_zero "cursor prototype command matches source" \
  cmp "$ROOT/.claude/commands/prototype.md" \
  "$CURSOR_TARGET/.cursor/commands/prototype.md"
assert_file_exists "cursor review command installed" \
  "$CURSOR_TARGET/.cursor/commands/review.md"
assert_cmd_zero "cursor review command matches source" \
  cmp "$ROOT/.claude/commands/review.md" \
  "$CURSOR_TARGET/.cursor/commands/review.md"
assert_file_exists "cursor orchestrator installed" "$CURSOR_TARGET/.cursor/orchestrator.md"
assert_file_exists "shared runtime installed for cursor" "$CURSOR_TARGET/.claude/harness/foundation.mjs"

finish "installer"
