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

finish "target drift"
