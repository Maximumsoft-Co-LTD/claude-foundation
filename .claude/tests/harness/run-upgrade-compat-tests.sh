#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

legacy="$TMP/legacy"
mkdir -p "$legacy"
printf '%s\n' \
  '{"version":1,"execution":{"maxParallelAgents":3,"packetBytes":65536,"leaseMinutes":45}}' \
  > "$legacy/foundation.json"
assert_cmd_zero "installer upgrades the former default policy" \
  bash "$ROOT/install.sh" "$legacy" --source "$ROOT" --yes
assert_eq "legacy task budget migrates" "8192" \
  "$(jq -r '.execution.packetBytes.task' "$legacy/foundation.json")"
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
doctor="$(bash "$ROOT/cli.sh" --project "$custom" doctor)"
assert_contains "doctor reports legacy numeric policy" "$doctor" \
  "legacy numeric limit 32768"

partial="$TMP/partial"
mkdir -p "$partial/.claude/harness" "$partial/.claude/hooks" "$partial/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$partial/.claude/harness/"
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
doctor="$(cd "$partial" && node .claude/harness/foundation.mjs doctor)"
assert_contains "partial policy retains custom task budget" "$doctor" "task=4096"
assert_contains "partial policy receives repository default" "$doctor" \
  "repository=12288"

# The CLI resolves the project runtime's API from its source constant instead of
# spawning the runtime to print it. Both the fast read and its spawn fallback
# must keep reporting the runtime's real API, or the compatibility guard turns
# into a silent no-op on an out-of-date project.
declared="$(sed -n \
  's/^const RUNTIME_API_VERSION *= *"\{0,1\}\([0-9][0-9]*\)"\{0,1\} *;.*/\1/p' \
  "$ROOT/.claude/harness/foundation.mjs" | head -1)"
assert_eq "shipped runtime declares a CLI-readable API constant" \
  "$(node "$ROOT/.claude/harness/foundation.mjs" api-version)" "$declared"

mismatch="$TMP/mismatch"
mkdir -p "$mismatch/.claude/harness" "$mismatch/openspec"
cp "$ROOT/.claude/harness/protocol.json" "$mismatch/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$mismatch/openspec/"
cp "$ROOT/openspec/config.yaml" "$mismatch/openspec/"
cp "$ROOT/foundation.json" "$mismatch/"
sed 's/^const RUNTIME_API_VERSION = "7";/const RUNTIME_API_VERSION = "999";/' \
  "$ROOT/.claude/harness/foundation.mjs" \
  > "$mismatch/.claude/harness/foundation.mjs"
assert_file_contains "fixture declares a mismatched runtime API" \
  "$mismatch/.claude/harness/foundation.mjs" 'const RUNTIME_API_VERSION = "999";'

warned="$(bash "$ROOT/cli.sh" --project "$mismatch" changes 2>&1 >/dev/null || true)"
assert_contains "read access warns on a mismatched runtime API" "$warned" \
  "project runtime API '999' differs from CLI API"

rejected="$(bash "$ROOT/cli.sh" --project "$mismatch" validate missing-change 2>&1 || true)"
assert_contains "write access rejects a mismatched runtime API" "$rejected" \
  "project runtime API '999' is incompatible with CLI API"

# A runtime whose constant is not in the expected literal form must fall back to
# asking the runtime itself rather than skipping the check.
sed -i.bak 's/^const RUNTIME_API_VERSION = "999";/const RUNTIME_API_VERSION = String(900 + 99);/' \
  "$mismatch/.claude/harness/foundation.mjs"
rm -f "$mismatch/.claude/harness/foundation.mjs.bak"
rejected="$(bash "$ROOT/cli.sh" --project "$mismatch" validate missing-change 2>&1 || true)"
assert_contains "unparsable API constant falls back to the runtime" "$rejected" \
  "project runtime API '999' is incompatible with CLI API"

finish "upgrade compatibility"
