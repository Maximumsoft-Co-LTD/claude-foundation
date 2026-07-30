#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

assert_cmd_zero "benchmark targets are valid JSON" \
  jq -e '.workflow == "openspec-native" and .scenarios["todolist-r2"].target.task_mirror_operations_max == 0' \
  "$ROOT/.claude/tests/bench/config/openspec-native-targets.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

cd "$TMP/project"

output="$(node .claude/harness/foundation.mjs new 'Profile owner update')"
assert_contains "creates standard change" "$output" "CREATED profile-owner-update"
assert_file_exists "runtime state created" ".foundation/runtime/profile-owner-update.json"
assert_file_exists "delta spec created" "openspec/changes/profile-owner-update/specs/change/spec.md"

output="$(node .claude/harness/foundation.mjs resolve profile-owner-update --impact medium --coupling isolated)"
assert_contains "resolver records impact" "$output" "impact: medium"
assert_cmd_zero "standard change validates" node .claude/harness/foundation.mjs validate profile-owner-update

sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/profile-owner-update/tasks.md
rm openspec/changes/profile-owner-update/tasks.md.bak
assert_cmd_zero "test provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update test pass
assert_cmd_zero "discovery provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update discovery pass --discovered 3 --minimum 1
assert_cmd_zero "complete evidence proves" node .claude/harness/foundation.mjs prove profile-owner-update
assert_cmd_zero "fresh proof is land-ready" node .claude/harness/foundation.mjs land-check profile-owner-update

printf 'changed\n' > app.txt
if node .claude/harness/foundation.mjs land-check profile-owner-update >/dev/null 2>&1; then
  fail "relevant edit invalidates proof"
else
  pass "relevant edit invalidates proof"
fi

output="$(node .claude/harness/foundation.mjs new 'Tiny copy edit' --rapid)"
assert_contains "creates rapid change" "$output" "foundation-rapid"
node .claude/harness/foundation.mjs resolve tiny-copy-edit --impact low --coupling isolated --security auth >/dev/null
schema="$(jq -r '.schema' .foundation/runtime/tiny-copy-edit.json 2>/dev/null || true)"
assert_eq "semantic security upgrades rapid lane" "foundation-standard" "$schema"

if node .claude/harness/foundation.mjs receipt tiny-copy-edit browser pass \
  --foreground required >/dev/null 2>&1; then
  fail "browser foreground mismatch cannot pass"
else
  pass "browser foreground mismatch cannot pass"
fi

if node .claude/harness/foundation.mjs receipt tiny-copy-edit mutation pass \
  --classification crash >/dev/null 2>&1; then
  fail "mutation crash cannot pass"
else
  pass "mutation crash cannot pass"
fi

event="$(node .claude/harness/foundation.mjs event tiny-copy-edit --request req-1 --operation build)"
assert_contains "watchdog records request" "$event" "BUDGET tiny-copy-edit"
assert_file_exists "event ledger created" ".foundation/logs/tiny-copy-edit/events.jsonl"

# Non-Git repositories use a manifest-guarded isolated copy.
node .claude/harness/foundation.mjs new 'Copy sandbox' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve copy-sandbox --impact low --coupling isolated >/dev/null
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/copy-sandbox/tasks.md
rm openspec/changes/copy-sandbox/tasks.md.bak
copy_output="$(node .claude/harness/foundation.mjs sandbox create copy-sandbox)"
assert_contains "non-git sandbox uses isolated copy" "$copy_output" "mode: isolated-copy"
copy_path="$(jq -r '.workspace.path' .foundation/runtime/copy-sandbox.json)"
printf 'copy-applied\n' > "$copy_path/app.txt"
node .claude/harness/foundation.mjs receipt copy-sandbox test pass >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox discovery pass --discovered 1 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove copy-sandbox >/dev/null
assert_cmd_zero "isolated copy applies transactionally" \
  node .claude/harness/foundation.mjs sandbox apply copy-sandbox
copy_applied="$(tr -d '\n' < app.txt)"
assert_eq "non-git target matches isolated copy" "copy-applied" "$copy_applied"

# A separate clean Git fixture exercises the complete worktree proof/apply path.
mkdir -p "$TMP/git-project/.claude/harness" "$TMP/git-project/openspec" "$TMP/git-project/.foundation"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/git-project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/git-project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/git-project/openspec/"
cp "$ROOT/.foundation/.gitignore" "$TMP/git-project/.foundation/"
printf 'before\n' > "$TMP/git-project/app.txt"
cd "$TMP/git-project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git add .
git commit -qm "fixture"
node .claude/harness/foundation.mjs new 'Sandbox copy' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve sandbox-copy --impact low --coupling isolated >/dev/null
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/sandbox-copy/tasks.md
rm openspec/changes/sandbox-copy/tasks.md.bak
node .claude/harness/foundation.mjs sandbox create sandbox-copy >/dev/null
printf 'after\n' > .foundation/sandboxes/sandbox-copy/app.txt
node .claude/harness/foundation.mjs receipt sandbox-copy test pass >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass --discovered 2 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
assert_cmd_zero "proven sandbox applies transactionally" \
  node .claude/harness/foundation.mjs sandbox apply sandbox-copy
applied="$(tr -d '\n' < app.txt)"
assert_eq "target matches sandbox content" "after" "$applied"

finish "harness contracts"
