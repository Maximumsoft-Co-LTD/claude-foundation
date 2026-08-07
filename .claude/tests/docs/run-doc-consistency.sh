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
  jq -e '[.commands[] | select(.name == "budget continue" or .name == "land record" or
    .name == "change abandon") |
    (.kind == "authority" and (.usage | contains("--decision-ref")))] | all' \
  "$COMMANDS"
assert_cmd_zero "retiring a change is registered as a runtime command" \
  jq -e '.runtimeCommands | index("abandon") != null' "$COMMANDS"
assert_file_contains "the workflow documents retiring an unprovable change" \
  "$WF" "change abandon <change> --reason <reason> --decision-ref <ref>"
assert_file_contains "the workflow documents where a retired change goes" \
  "$WF" ".foundation/recovery/abandoned/"
assert_file_contains "the workflow documents that stops carry their exits" \
  "$WF" "## Terminal stops"
assert_file_contains "change offers retiring rather than deciding it" \
  "$ROOT/.claude/commands/change.md" "never retire one unasked"
assert_file_contains "the orchestrator treats a blocked stop as a user decision" \
  "$ORCH" "including one a blocked operation"

runtime_api="$(jq -r '.runtimeApi' "$ROOT/.claude/harness/protocol.json")"
cli_api="$(sed -n 's/^EXPECTED_RUNTIME_API=//p' "$ROOT/cli.sh")"
assert_eq "CLI and installed runtime API agree" "$runtime_api" "$cli_api"

if grep -qE 'evidence record .* pass|--decision accept|--unresolved-blockers 0' \
    "$ROOT/.claude/harness/runtime/evidence/proof-readiness.mjs"; then
  fail "proof recovery still embeds a preselected passing decision"
else
  pass "proof recovery contains no preselected passing decision"
fi

# Shipped rules must not point at maintainer-only tests or research paths, nor
# at repository-only files that never reach a consumer's project. The file list
# is every shipped documentation surface — the harness README, the hooks, and
# settings.json were absent before, which is where the escapes were.
SHIPPED_DOCS="$ROOT/.claude/orchestrator.md $ROOT/.claude/commands
$ROOT/.claude/harness/AGENT.md $ROOT/.claude/harness/EVIDENCE.md
$ROOT/.claude/harness/README.md $ROOT/.claude/hooks $ROOT/.claude/settings.json
$ROOT/.claude/rules $ROOT/.claude/skills $ROOT/WORKFLOW.md"
# Only unambiguous repository-only filenames. Bare directory words like
# "dashboard/" appear as ordinary content in the UI skill's data and would be
# false positives; WORKFLOW.md's `/path/to/claude-foundation/cli.sh` is a
# documented source-checkout escape hatch, not a shipped-path claim.
# shellcheck disable=SC2086 -- intentional word-splitting over the path list
leaks="$(grep -rlE '\.claude/tests|tests/bench|docs/research|install\.sh|install-cursor\.sh|RELEASING\.md|Formula/claude-foundation|release-notes/' \
  $SHIPPED_DOCS 2>/dev/null || true)"
if [ -z "$leaks" ]; then
  pass "shipped workflow files do not cite maintainer-only paths"
else
  fail "shipped workflow files cite maintainer-only paths: $(printf '%s' "$leaks" | tr '\n' ' ')"
fi

# A shipped file that names a relative path must name one that ships.
missing=""
for rel in $(grep -rhoE '(\.\./)?(runtime|skills|rules|commands|hooks|harness)/[A-Za-z0-9._/-]+\.(mjs|md|json)' \
    $SHIPPED_DOCS 2>/dev/null | sort -u); do
  case "$rel" in ../*) candidate="$ROOT/.claude/${rel#../}" ;; *) candidate="$ROOT/.claude/$rel" ;; esac
  [ -e "$candidate" ] || [ -e "$ROOT/.claude/harness/$rel" ] || missing="$missing $rel"
done
if [ -z "$missing" ]; then
  pass "shipped files reference only paths that resolve"
else
  fail "shipped files reference non-resolving paths:$missing"
fi

finish "doc-consistency tests"
