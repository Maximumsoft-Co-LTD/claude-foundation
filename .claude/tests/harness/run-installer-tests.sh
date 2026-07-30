#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
TARGET="$TMP/project"
mkdir -p "$TARGET/.workflow/0001-legacy" "$TARGET/.claude/agents"
printf 'legacy\n' > "$TARGET/.workflow/0001-legacy/state.json"
printf 'old\n' > "$TARGET/.claude/agents/pm.md"
printf '# User project\n' > "$TARGET/CLAUDE.md"
mkdir -p "$TARGET/.claude"
printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Agent","hooks":[{"type":"command","command":"${CLAUDE_PROJECT_DIR}/.claude/hooks/dev-agent-guard.sh"},{"type":"command","command":"user-hook.sh"}]}]}}' > "$TARGET/.claude/settings.json"

assert_cmd_zero "installer applies non-interactively" \
  sh "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_file_exists "change command installed" "$TARGET/.claude/commands/change.md"
assert_file_exists "harness installed" "$TARGET/.claude/harness/foundation.mjs"
assert_file_exists "standard schema installed" "$TARGET/openspec/schemas/foundation-standard/schema.yaml"
assert_file_exists "runtime ignore installed" "$TARGET/.foundation/.gitignore"
assert_file_exists "legacy run preserved" "$TARGET/.workflow/0001-legacy/state.json"
assert_file_absent "legacy lifecycle agent removed" "$TARGET/.claude/agents/pm.md"
if grep -qF "dev-agent-guard.sh" "$TARGET/.claude/settings.json"; then
  fail "legacy hook wiring removed"
else
  pass "legacy hook wiring removed"
fi
assert_file_contains "user hook wiring preserved" "$TARGET/.claude/settings.json" "user-hook.sh"
assert_file_contains "user CLAUDE content preserved" "$TARGET/CLAUDE.md" "# User project"
assert_file_contains "managed change-loop pointer added" "$TARGET/CLAUDE.md" "claude-foundation:change-loop:start"
assert_cmd_zero "installed harness starts" \
  node "$TARGET/.claude/harness/foundation.mjs" version

CURSOR_TARGET="$TMP/cursor-project"
mkdir -p "$CURSOR_TARGET"
assert_cmd_zero "cursor adapter installs" \
  sh "$ROOT/install-cursor.sh" "$CURSOR_TARGET" --source "$ROOT" --yes
assert_file_exists "cursor change command installed" "$CURSOR_TARGET/.cursor/commands/change.md"
assert_file_exists "cursor orchestrator installed" "$CURSOR_TARGET/.cursor/orchestrator.md"
assert_file_exists "shared runtime installed for cursor" "$CURSOR_TARGET/.claude/harness/foundation.mjs"

finish "installer"
