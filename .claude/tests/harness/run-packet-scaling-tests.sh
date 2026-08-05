#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime" "$TMP/project/.claude/harness/"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
cp "$ROOT/foundation.json" "$TMP/project/"
printf 'initial\n' > "$TMP/project/app.txt"
cd "$TMP/project"

RUNTIME=".claude/harness/foundation.mjs"
node "$RUNTIME" new 'Large brownfield packet' --rapid >/dev/null
node "$RUNTIME" resolve large-brownfield-packet \
  --impact low --coupling isolated >/dev/null
CHANGE="openspec/changes/large-brownfield-packet"
printf '%s\n' '# Tasks' '' > "$CHANGE/tasks.md"
i=1
while [ "$i" -le 1000 ]; do
  id="$(printf 'T%04d' "$i")"
  printf '%s\n' "- [ ] **$id** Brownfield task $i [kind:implementation]" \
    >> "$CHANGE/tasks.md"
  i=$((i + 1))
done

budget_warning="$TMP/task-budget-warning.txt"
plan="$(node "$RUNTIME" agent-plan large-brownfield-packet 2>"$budget_warning")"
global="$(node "$RUNTIME" packet large-brownfield-packet 2>>"$budget_warning")"
repo="$(node "$RUNTIME" packet large-brownfield-packet --repo root 2>>"$budget_warning")"
assert_file_contains "1000-task fixture retains the 900-word soft budget" \
  "$budget_warning" "soft budget 900"
assert_cmd_zero "1000-task plan is valid JSON" sh -c \
  'printf "%s" "$1" | jq -e ".taskCount == 1000"' _ "$plan"
assert_cmd_zero "1000-task global packet is valid JSON" sh -c \
  'printf "%s" "$1" | jq -e ".tasks.count == 1000"' _ "$global"
assert_cmd_zero "1000-task repository packet compacts tasks" sh -c \
  'printf "%s" "$1" | jq -e ".tasks.count == 1000 and (.tasks.preview | length) == 40"' _ "$repo"
if [ "$(printf '%s\n' "$plan" | wc -c | tr -d ' ')" -le 4096 ]; then
  pass "1000-task plan stays within 4 KiB"
else
  fail "1000-task plan stays within 4 KiB"
fi
if [ "$(printf '%s\n' "$repo" | wc -c | tr -d ' ')" -le 12288 ]; then
  pass "1000-task repository packet stays within 12 KiB"
else
  fail "1000-task repository packet stays within 12 KiB"
fi

printf '%s\n' '{"version":2,"claims":[' > "$CHANGE/evidence.yaml"
i=1
while [ "$i" -le 500 ]; do
  comma=","
  [ "$i" -eq 500 ] && comma=""
  printf '%s\n' \
    "{\"id\":\"claim-$i\",\"scenario\":\"Observable scenario $i\",\"impact\":\"low\",\"capabilities\":[\"test\"]}$comma" \
    >> "$CHANGE/evidence.yaml"
  i=$((i + 1))
done
printf '%s\n' ']}' >> "$CHANGE/evidence.yaml"
global="$(node "$RUNTIME" packet large-brownfield-packet 2>>"$budget_warning")"
assert_cmd_zero "500-claim global packet compacts claims" sh -c \
  'printf "%s" "$1" | jq -e ".claims.count == 500 and (.claims.preview | length) == 40"' _ "$global"
if [ "$(printf '%s\n' "$global" | wc -c | tr -d ' ')" -le 16384 ]; then
  pass "500-claim global packet stays within 16 KiB"
else
  fail "500-claim global packet stays within 16 KiB"
fi

finish "packet scaling"
