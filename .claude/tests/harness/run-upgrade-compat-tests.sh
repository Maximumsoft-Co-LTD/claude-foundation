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
assert_contains "partial policy receives review default" "$doctor" "review=8192"

finish "upgrade compatibility"
