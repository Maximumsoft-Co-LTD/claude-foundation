#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
. "$ROOT/.claude/tests/lib/harness-fixture.sh"

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
install_harness_fixture "$ROOT" "$partial"
cp "$ROOT/.claude/harness/commands.json" "$partial/.claude/harness/"
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

# Exercise the real previous release rather than a hand-built policy fragment.
# An in-flight v3.2.19 change is a grandfathered migration exception: it stays
# readable and does not acquire an invented Decision Sheet. New changes created
# after upgrade must use Grounding v2.
previous_source="$TMP/foundation-3.2.19"
previous_target="$TMP/previous-project"
mkdir -p "$previous_source" "$previous_target"
git -C "$ROOT" archive v3.2.19 | tar -x -C "$previous_source"
assert_cmd_zero "v3.2.19 installs into the upgrade fixture" \
  bash "$previous_source/install.sh" "$previous_target" \
    --source "$previous_source" --yes
assert_cmd_zero "v3.2.19 creates an active legacy change" \
  bash "$previous_source/cli.sh" --project "$previous_target" \
    change new "Legacy active upgrade" --rapid
assert_file_exists "legacy active state exists before upgrade" \
  "$previous_target/.foundation/runtime/legacy-active-upgrade.json"
assert_cmd_zero "v3.3 upgrades the real previous installation" \
  bash "$ROOT/install.sh" "$previous_target" --source "$ROOT" --yes
assert_contains "upgraded CLI reports v3.3" \
  "$(bash "$ROOT/cli.sh" --project "$previous_target" version)" "3.3.0"
assert_contains "upgraded runtime keeps the active legacy change readable" \
  "$(bash "$ROOT/cli.sh" --project "$previous_target" changes)" \
  "legacy-active-upgrade"
assert_eq "legacy active change is an explicit grounding migration exception" \
  "false" \
  "$(jq -r '(.groundingRequired // false)' \
    "$previous_target/.foundation/runtime/legacy-active-upgrade.json")"
assert_cmd_zero "post-upgrade change creation uses the new runtime" \
  bash "$ROOT/cli.sh" --project "$previous_target" \
    change new "Grounded after upgrade" --rapid
assert_file_exists "post-upgrade change receives Grounding v2" \
  "$previous_target/openspec/changes/grounded-after-upgrade/grounding.yaml"
assert_eq "post-upgrade runtime requires Grounding v2" "2" \
  "$(jq -r '.groundingVersion' \
    "$previous_target/.foundation/runtime/grounded-after-upgrade.json")"

finish "upgrade compatibility"
