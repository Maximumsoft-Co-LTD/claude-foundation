#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

AGENT="$ROOT/.claude/harness/AGENT.md"
ORCH="$ROOT/.claude/orchestrator.md"
COMMANDS="$ROOT/.claude/commands"
DASHBOARD="$ROOT/dashboard/public"

assert_file_contains "agent matches the user's language" "$AGENT" "user's language"
assert_file_contains "agent performs safe authorized actions" "$AGENT" "safe action you can"
assert_file_contains "agent keeps runtime routes internal" "$AGENT" "agent-only control data"
assert_file_contains "agent asks users for decisions rather than CLI execution" "$AGENT" \
  "requests a decision, not CLI execution"
assert_file_contains "orchestrator leads with the outcome" "$ORCH" "Lead with outcome"
assert_file_contains "orchestrator keeps protocol internal" "$ORCH" "Do not paste runtime protocol"
assert_file_contains "orchestrator avoids command handoffs" "$ORCH" "agent can run"
assert_file_contains "orchestrator keeps wait commands with the agent" "$ORCH" \
  "not a user command"

for command in investigate change dev feature changes; do
  assert_file_contains "$command returns user-language guidance" \
    "$COMMANDS/$command.md" "user's language"
done
assert_file_contains "Build ends with a useful summary" "$COMMANDS/build.md" \
  "behavior, checks, remaining risk"
assert_file_contains "Prove distinguishes proof from remaining risk" "$COMMANDS/prove.md" \
  "unproven"
assert_file_contains "Land performs deterministic recovery" "$COMMANDS/land.md" \
  '`automaticRecovery`'
for command in build prove dev land; do
  assert_file_contains "$command keeps control commands agent-owned" \
    "$COMMANDS/$command.md" "agent-only control"
done

assert_file_contains "session digest tells the agent to translate" \
  "$ROOT/.claude/hooks/session-context.mjs" "never paste it verbatim"
assert_file_contains "secret guard confirms no disclosure" \
  "$ROOT/.claude/hooks/protect-secrets.sh" "No secret contents were read"
assert_file_contains "secret guard keeps blocked commands internal" \
  "$ROOT/.claude/hooks/protect-secrets.sh" "Keep the blocked command internal"
assert_file_not_contains "secret guard never delegates a bypass to the user" \
  "$ROOT/.claude/hooks/protect-secrets.sh" "user can run the command"
assert_file_not_contains "secret guard never recommends disabling itself" \
  "$ROOT/.claude/hooks/protect-secrets.sh" "temporarily disable the hook"
assert_file_contains "phase guard confirms no mutation" \
  "$ROOT/.claude/hooks/phase-mutation-guard.mjs" "No mutation ran"
assert_file_contains "branch guard confirms work preservation" \
  "$ROOT/.claude/hooks/no-direct-main-commit.sh" "Your files are unchanged"
assert_file_contains "branch override requires explicit authority" \
  "$ROOT/.claude/hooks/no-direct-main-commit.sh" "user explicitly authorizes"

for installer in install.sh install-codex.sh install-cursor.sh install-opencode.sh; do
  assert_file_contains "$installer gives a human next step" "$ROOT/$installer" \
    "describe the outcome with /change"
done
assert_file_contains "Cursor receives an always-on guidance contract" \
  "$ROOT/.claude/harness/adapters/cursor-human-guidance.mdc" "Foundation human guidance contract"
assert_file_contains "CLI help explains the ordinary user path" "$ROOT/cli.sh" \
  "describe the outcome to your coding agent"

assert_file_contains "English README explains automatic target recovery" \
  "$ROOT/README.md" "not create a new change"
assert_file_contains "Thai README explains automatic target recovery" \
  "$ROOT/README.th.md" "ไม่ต้องเปิด Change ใหม่"

assert_file_contains "dashboard has a keyboard skip link" "$DASHBOARD/index.html" \
  'class="skip-link"'
assert_file_contains "dashboard overlays expose modal semantics" "$DASHBOARD/index.html" \
  'role="dialog" aria-modal="true"'
assert_file_contains "dashboard key copy explains server transmission" "$DASHBOARD/index.html" \
  'sent to this dashboard server with each request'
assert_file_contains "dashboard key avoids account-password autofill" "$DASHBOARD/index.html" \
  'id="gate-key" class="gate-input" type="password" autocomplete="off"'
assert_file_contains "dashboard modal behavior makes background inert" "$DASHBOARD/modal-manager.js" \
  'shell.inert = true'
assert_file_contains "dashboard status is announced" "$DASHBOARD/index.html" \
  'aria-live="polite"'
assert_file_contains "dashboard errors are announced" "$DASHBOARD/index.html" \
  'role="alert"'
assert_file_contains "dashboard respects reduced motion" "$DASHBOARD/styles.css" \
  "prefers-reduced-motion"
if grep -q "That key was rejected" "$DASHBOARD/index.html"; then
  fail "dashboard still has a dead-end access error"
else
  pass "dashboard access error includes recovery"
fi

finish "user guidance contracts"
