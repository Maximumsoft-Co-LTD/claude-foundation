#!/usr/bin/env sh
# What happens to a sandbox when the target moves underneath it.
#
# The isolated-copy half of this seam lives in run-changeloop-seam-tests.sh,
# beside the other change-loop handoffs. The worktree half lives here, on its
# own, for one reason: run-target-drift-mutation.sh runs a whole suite three
# times to prove these guards are load-bearing, and running the 30-scenario seam
# suite for two scenarios cost more wall clock than every other suite combined.
#
# The defect pinned here: a worktree sandbox is pinned to the commit it branched
# from, and sync reconciled neither the base nor the report. Build and Prove ran
# to completion against a commit the target no longer had, proof passed, and
# only the apply transaction refused — with a bare string.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

F="node .claude/harness/foundation.mjs"

assert_not_eq() {
  label="$1"
  left="$2"
  right="$3"
  if [ "$left" != "$right" ]; then pass "$label"; else fail "$label"; fi
}

# One project per scenario: two changes holding sandboxes on one repository is a
# repository conflict, which is a real blocker and not the one under test.
setup_project() {
  mkdir -p "$TMP/$1/.claude/harness" "$TMP/$1/openspec" "$TMP/$1/src" "$TMP/$1/test"
  cp -R "$ROOT/.claude/harness/." "$TMP/$1/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$TMP/$1/openspec/"
  cp "$ROOT/openspec/config.yaml" "$TMP/$1/openspec/"
  cd "$TMP/$1"
  printf 'export function add(a,b){return a+b;}\n' > src/calc.js
  printf '{"name":"drift","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n' \
    > package.json
  printf 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/calc.js";\ntest("add", () => assert.equal(add(1,2), 3));\n' \
    > test/calc.test.js
  # How an installed project actually looks: the root ignore file says nothing
  # about `.foundation/`, and `.foundation/.gitignore` — itself tracked, because
  # the installer manages it — ignores the machine state beside it.
  printf 'build-output/\n' > .gitignore
  mkdir -p .foundation
  printf '*\n!.gitignore\n!README.md\n' > .foundation/.gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

state_of() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('.foundation/runtime/$1.json','utf8')).workspace.$2)"
}

repo_state_of() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('.foundation/runtime/$1.json','utf8')).repositories['$2'].$3)"
}

setup_multi_project() {
  setup_project "$1"
  project="$TMP/$1"
  for child in api app; do
    mkdir -p "$TMP/$1-$child"
    git -C "$TMP/$1-$child" init -q
    git -C "$TMP/$1-$child" config user.email t@t
    git -C "$TMP/$1-$child" config user.name t
    printf '%s base\n' "$child" > "$TMP/$1-$child/$child.txt"
    git -C "$TMP/$1-$child" add -A
    git -C "$TMP/$1-$child" commit -qm "$child base"
    git -C "$project" -c protocol.file.allow=always submodule add -q \
      "$TMP/$1-$child" "$child"
  done
  printf '%s\n' \
    '{"version":1,"repositories":[' \
    '  {"id":"api","path":"api"},' \
    '  {"id":"app","path":"app"}' \
    ']}' > "$project/openspec/repositories.yaml"
  git -C "$project" add -A
  git -C "$project" commit -qm "add child repositories"
  cd "$project"
}

create_multi_change() {
  intent="$1"
  change="$2"
  $F new "$intent" --rapid > /dev/null
  printf '%s\n' \
    '{"version":1,"repositories":[' \
    '  {"id":"api","mode":"write","dependsOn":[]},' \
    '  {"id":"app","mode":"write","dependsOn":["api"]}' \
    ']}' > "openspec/changes/$change/repositories.yaml"
  printf '%s\n' \
    '# Tasks' '' \
    '- [ ] **T001** Change API [repo:api] [paths:api.txt]' \
    '- [ ] **T002** Change App [repo:app] [paths:app.txt]' \
    > "openspec/changes/$change/tasks.md"
  $F sandbox create "$change" --all > /dev/null
}

# --- A moved target replays at sync. -----------------------------------------
setup_project replays-worktree
$F new "worktree replays onto the target" --rapid > /dev/null
C=worktree-replays-onto-the-target
$F sandbox create "$C" > /dev/null
assert_eq "a clean target yields a worktree sandbox" "worktree" "$(state_of "$C" mode)"
printf 'export function add(a,b){return a+b;}\nexport function sub(a,b){return a-b;}\n' \
  > ".foundation/sandboxes/$C/src/calc.js"
printf 'export const brandNew = true;\n' > ".foundation/sandboxes/$C/src/new-file.js"
printf 'landed by another change\n' > src/other.js
git add -A && git commit -qm "another change landed" > /dev/null
replay="$($F sandbox sync "$C")"
assert_contains "sync reports the replay" "$replay" "rebased: "
assert_file_contains "the sandbox's edit survives the replay" \
  ".foundation/sandboxes/$C/src/calc.js" "sub"
assert_file_contains "a file the sandbox created survives the replay" \
  ".foundation/sandboxes/$C/src/new-file.js" "brandNew"
assert_file_contains "the target's landed work arrives in the sandbox" \
  ".foundation/sandboxes/$C/src/other.js" "landed by another change"
assert_file_exists "the packet is re-copied into the replayed worktree" \
  ".foundation/sandboxes/$C/openspec/changes/$C/tasks.md"
assert_file_absent "the staging worktree is cleaned up" ".foundation/sandboxes/$C.rebase"
assert_file_absent "the replay patch is cleaned up" ".foundation/sandboxes/$C.rebase.patch"
assert_eq "the recorded base advanced to the target's head" \
  "$(git rev-parse HEAD)" "$(state_of "$C" baseHead)"
quiet="$($F sandbox sync "$C")"
assert_not_contains "a target that did not move reports no movement" "$quiet" "rebased:"
assert_not_contains "a target that did not move reports no drift" "$quiet" "target moved:"

# --- A replay that cannot apply leaves the sandbox exactly as it was. --------
# The merge the user has to perform is only possible in the sandbox, so a
# rejected hunk must not cost them the worktree it has to happen in.
setup_project replay-conflict
$F new "a rejected replay is named" --rapid > /dev/null
C=a-rejected-replay-is-named
$F sandbox create "$C" > /dev/null
printf 'sandbox version\n' > ".foundation/sandboxes/$C/src/calc.js"
before_base="$(state_of "$C" baseHead)"
printf 'target version\n' > src/calc.js
git add -A && git commit -qm "target moved the same file" > /dev/null
rejected="$($F sandbox sync "$C" 2>&1)"
assert_contains "the rejected file is named at sync, not at Land" \
  "$rejected" "CONFLICT src/calc.js"
assert_contains "an unreconciled move is still reported" "$rejected" "target moved: "
assert_file_contains "the sandbox survives a rejected replay untouched" \
  ".foundation/sandboxes/$C/src/calc.js" "sandbox version"
assert_file_absent "a rejected replay cleans up its staging worktree" \
  ".foundation/sandboxes/$C.rebase"
assert_eq "a rejected replay does not advance the recorded base" \
  "$before_base" "$(state_of "$C" baseHead)"

# `land check` is documented as validating that the projection remains landable,
# and it used to answer that question without weighing the target at all — so it
# reported a stale-proof red herring, or LAND READY, for a base the apply
# transaction would refuse two commands later.
landable="$($F land-check "$C" 2>&1 || true)"
assert_contains "land check weighs the target, not only the change" \
  "$landable" "control-head-moved"
assert_contains "and the stop names replaying as the way out" "$landable" "sandbox sync $C"
assert_not_contains "the base is judged before the evidence is" \
  "$landable" "has no passing proof"

# Diagnosing the drift used to mean reading `.foundation/` by hand.
drift="$($F sandbox inspect "$C")"
assert_contains "inspect reports the drift it used to hide" "$drift" "target drift: base"
assert_contains "inspect names the way out" "$drift" "sandbox sync $C"
$F sandbox inspect "$C" --json > "$TMP/drift.json"
assert_cmd_zero "the drift is machine-readable too" \
  node -e 'const w=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workspaceIsolation;
    process.exit(w.drift === "target-moved" && w.baseHead && w.targetHead ? 0 : 1)' \
  "$TMP/drift.json"

# Merging the target's version in the sandbox is what unblocks it — and it only
# works because the replay is a three-way merge. A straight `git apply` matches
# the base's context, so the very diff carrying the merge would stop applying.
printf 'target version\n' > ".foundation/sandboxes/$C/src/calc.js"
resolved_replay="$($F sandbox sync "$C" 2>&1)"
assert_not_contains "a merged file stops being named" "$resolved_replay" "CONFLICT"
assert_contains "and the replay then advances the base" "$resolved_replay" "rebased: "

# --- Every moved writable repository replays in one sync. -------------------
setup_multi_project multi-replay
create_multi_change "multiple repository targets replay" \
  multiple-repository-targets-replay
C=multiple-repository-targets-replay
api_sandbox=".foundation/repository-sandboxes/$C/api"
app_sandbox=".foundation/repository-sandboxes/$C/app"
printf 'api sandbox work\n' > "$api_sandbox/api.txt"
printf 'app sandbox work\n' > "$app_sandbox/app.txt"
printf 'api target landed\n' > api/target.txt
git -C api add -A && git -C api commit -qm "api target moved"
printf 'app target landed\n' > app/target.txt
git -C app add -A && git -C app commit -qm "app target moved"
multi_replay="$($F sandbox sync "$C" 2>&1)"
assert_contains "multi sync reports the API replay" "$multi_replay" "rebased api:"
assert_contains "multi sync reports the app replay" "$multi_replay" "rebased app:"
assert_file_contains "API sandbox work survives multi replay" "$api_sandbox/api.txt" "sandbox work"
assert_file_contains "app sandbox work survives multi replay" "$app_sandbox/app.txt" "sandbox work"
assert_file_contains "API target work arrives in its sandbox" "$api_sandbox/target.txt" "target landed"
assert_file_contains "app target work arrives in its sandbox" "$app_sandbox/target.txt" "target landed"
assert_eq "API recorded base advances" "$(git -C api rev-parse HEAD)" \
  "$(repo_state_of "$C" api baseHead)"
assert_eq "app recorded base advances" "$(git -C app rev-parse HEAD)" \
  "$(repo_state_of "$C" app baseHead)"

# Commit identity is recovery/Land state, not evidence content. Mutating only
# the recorded base must not change the composite; changing tracked content must.
hash_before="$($F hash "$C")"
cp ".foundation/runtime/$C.json" "$TMP/content-hash-state.json"
jq '.repositories.api.baseHead = "history-only-head"' \
  ".foundation/runtime/$C.json" > "$TMP/history-only-state.json"
cp "$TMP/history-only-state.json" ".foundation/runtime/$C.json"
hash_after_head="$($F hash "$C")"
assert_eq "history-only base identity does not change composite hash" \
  "$hash_before" "$hash_after_head"
cp "$TMP/content-hash-state.json" ".foundation/runtime/$C.json"
printf 'tracked content changed\n' >> "$api_sandbox/api.txt"
hash_after_content="$($F hash "$C")"
assert_not_eq "tracked repository content changes composite hash" \
  "$hash_before" "$hash_after_content"

# --- A conflict in a later repository leaves every live sandbox untouched. --
setup_multi_project multi-conflict
create_multi_change "multi repository conflict is atomic" \
  multi-repository-conflict-is-atomic
C=multi-repository-conflict-is-atomic
api_sandbox=".foundation/repository-sandboxes/$C/api"
app_sandbox=".foundation/repository-sandboxes/$C/app"
printf 'api sandbox work\n' > "$api_sandbox/api.txt"
printf 'api target landed\n' > api/target.txt
git -C api add -A && git -C api commit -qm "api clean target move"
printf 'app sandbox version\n' > "$app_sandbox/app.txt"
printf 'app target version\n' > app/app.txt
git -C app add -A && git -C app commit -qm "app conflicting target move"
api_base_before="$(repo_state_of "$C" api baseHead)"
app_base_before="$(repo_state_of "$C" app baseHead)"
multi_conflict="$($F sandbox sync "$C" 2>&1)"
assert_contains "multi conflict names repository and path" \
  "$multi_conflict" "CONFLICT app:app.txt"
assert_file_contains "earlier API sandbox stays untouched on later conflict" \
  "$api_sandbox/api.txt" "api sandbox work"
assert_file_absent "earlier API sandbox does not receive target work on conflict" \
  "$api_sandbox/target.txt"
assert_file_contains "conflicting app sandbox stays untouched" \
  "$app_sandbox/app.txt" "app sandbox version"
assert_eq "API base does not advance on app conflict" "$api_base_before" \
  "$(repo_state_of "$C" api baseHead)"
assert_eq "app base does not advance on conflict" "$app_base_before" \
  "$(repo_state_of "$C" app baseHead)"
assert_file_absent "API staging worktree is cleaned after app conflict" \
  "$api_sandbox.rebase"
assert_file_absent "app staging worktree is cleaned after conflict" \
  "$app_sandbox.rebase"

if [ -n "${FOUNDATION_RESULT_REPORT:-}" ]; then
  result_dir="$(dirname "$FOUNDATION_RESULT_REPORT")"
  mkdir -p "$result_dir"
  printf '%s\n' \
    '{"numTotalTests":3,"criticalCases":[' \
    ' {"id":"CASE-MULTI-REPLAY-CLEAN","status":"pass"},' \
    ' {"id":"CASE-MULTI-REPLAY-CONFLICT","status":"pass"},' \
    ' {"id":"CASE-CONTENT-STABLE-HASH","status":"pass"}' \
    ']}' > "$FOUNDATION_RESULT_REPORT"
fi

finish "target drift"
