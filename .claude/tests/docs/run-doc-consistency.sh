#!/usr/bin/env sh
# Deterministic consistency checks for the current OpenSpec-native workflow.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$HERE/../lib/assert.sh"

WF="$ROOT/WORKFLOW.md"
README="$ROOT/README.md"
README_TH="$ROOT/README.th.md"
AGENT="$ROOT/.claude/harness/AGENT.md"
ORCH="$ROOT/.claude/orchestrator.md"
COMMANDS="$ROOT/.claude/harness/commands.json"
PROVE="$ROOT/.claude/commands/prove.md"

ver="$(tr -d ' \t\n\r' < "$ROOT/VERSION")"
assert_file_contains "VERSION is reflected in the workflow" "$WF" "Version $ver"

assert_file_contains "agent contract translates machine handoffs" \
  "$AGENT" "Harness output is a machine handoff"
assert_file_contains "orchestrator stops on structured decisions" \
  "$ORCH" '`decision` requires an explicit user answer'
assert_file_contains "prove uses the authority request bridge" \
  "$PROVE" '`authority request`'
assert_file_contains "prove forbids raw readiness output" \
  "$PROVE" "Never expose raw readiness JSON"
assert_file_contains "English README keeps harness metadata internal" \
  "$README" "Users never need to construct receipt commands"
assert_file_contains "Thai README keeps harness metadata internal" \
  "$README_TH" "ผู้ใช้ไม่ต้องประกอบ receipt command"

assert_cmd_zero "command registry has unique public names" \
  jq -e '([.commands[].name] | length) == ([.commands[].name] | unique | length)' \
  "$COMMANDS"
assert_cmd_zero "authority continuations name their decision reference" \
  jq -e '[.commands[] | select(.name == "budget continue" or .name == "land record") |
    (.kind == "authority" and (.usage | contains("--decision-ref")))] | all' \
  "$COMMANDS"

runtime_api="$(jq -r '.runtimeApi' "$ROOT/.claude/harness/protocol.json")"
cli_api="$(sed -n 's/^EXPECTED_RUNTIME_API=//p' "$ROOT/cli.sh")"
assert_eq "CLI and installed runtime API agree" "$runtime_api" "$cli_api"

if grep -qE 'evidence record .* pass|--decision accept|--unresolved-blockers 0' \
    "$ROOT/.claude/harness/runtime/evidence/proof-readiness.mjs"; then
  fail "proof recovery still embeds a preselected passing decision"
else
  pass "proof recovery contains no preselected passing decision"
fi

# Shipped rules must not point at maintainer-only tests or research paths.
leaks="$(grep -rlE '\.claude/tests|tests/bench|docs/research' \
  "$ROOT/.claude/orchestrator.md" "$ROOT/.claude/commands" \
  "$ROOT/.claude/harness/AGENT.md" "$ROOT/.claude/harness/EVIDENCE.md" \
  "$ROOT/.claude/rules" "$ROOT/.claude/skills" "$ROOT/WORKFLOW.md" \
  2>/dev/null || true)"
if [ -z "$leaks" ]; then
  pass "shipped workflow files do not cite maintainer-only paths"
else
  fail "shipped workflow files cite maintainer-only paths: $(printf '%s' "$leaks" | tr '\n' ' ')"
fi

finish "doc-consistency tests"
