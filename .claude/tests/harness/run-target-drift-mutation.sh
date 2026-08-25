#!/bin/sh
# Does the seam suite actually detect a removed target-drift guard, or does it
# only describe one?
#
# Two deliberate faults, each at a boundary this change exists to hold: the
# replay that reconciles a worktree sandbox with a moved target, and the
# `land check` stop that refuses to call a change landable against a base the
# target has left. A suite that still passes with either removed is not
# evidence.
#
# Reverting is proved by comparing bytes rather than by a fourth suite run:
# `cmp` answers the same question exactly, for free.
#
# Emits FOUNDATION_MUTATION_RESULT for the mutation adapter.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SUITE=".claude/tests/harness/run-target-drift-tests.sh"
WORK="$(mktemp -d)"
SOURCE="$WORK/source"
. "$ROOT/.claude/tests/lib/mutation-fixture.sh"
. "$ROOT/.claude/tests/lib/mutation-v2.sh"
create_mutation_fixture "$ROOT" "$SOURCE"
mutation_v2_begin "$WORK"
REPLAY="$SOURCE/.claude/harness/runtime/workflow/sandbox-runtime.mjs"
LANDABLE="$SOURCE/.claude/harness/runtime/workflow/land-runtime.mjs"
SNAPSHOT="$SOURCE/.claude/harness/runtime/workflow/repository-snapshot.mjs"

restore() {
  rm -rf "$WORK"
}

trap 'restore' EXIT
trap 'exit 130' HUP INT PIPE TERM
if grep -rl "FOUNDATION-INJECTED-FAULT" "$SOURCE/.claude/harness" 2>/dev/null | grep -q .; then
  echo "FAIL: source fixture already carries an injected fault"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi

cp "$REPLAY" "$WORK/sandbox-runtime.mjs"
cp "$LANDABLE" "$WORK/land-runtime.mjs"
cp "$SNAPSHOT" "$WORK/repository-snapshot.mjs"

suite_passes() {
  ( cd "$SOURCE" && sh "$SUITE" >"$WORK/suite.log" 2>&1 )
}

if ! suite_passes; then
  echo "WARN: target-drift baseline failed once; retrying before mutation"
  if ! suite_passes; then
    echo "FAIL: the suite does not pass before any mutation is applied"
    tail -80 "$WORK/suite.log"
    echo "FOUNDATION_MUTATION_RESULT=not-applied"
    exit 1
  fi
fi
echo "PASS: baseline suite passes before mutation"

killed=0
total=0

# Fault 1: a moved target stops being reconciled, and stops being reported.
# This is the original defect exactly: sync succeeds, says nothing, and leaves
# the sandbox building against a commit the target no longer has.
total=$((total + 1))
node - "$REPLAY" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /if \(!candidates\.length\) return null;/,
  "return null; // FOUNDATION-INJECTED-FAULT: replay and its report removed");
if (mutated === source) { console.error("replay fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
applied_1=false compiled_1=false killed_1=false
mutation_applied_once "$REPLAY" && applied_1=true
[ "$applied_1" != true ] || ! mutation_compiles "$REPLAY" || compiled_1=true
if [ "$compiled_1" != true ]; then
  echo "FAIL: target replay mutant did not apply exactly once and compile"
elif suite_passes; then
  echo "FAIL: removing the worktree replay went undetected"
else
  echo "PASS: removing the worktree replay is detected"
  killed_1=true
  killed=$((killed + 1))
fi
cp "$WORK/sandbox-runtime.mjs" "$REPLAY"
restored_1=false; cmp -s "$WORK/sandbox-runtime.mjs" "$REPLAY" && restored_1=true
result_1=survived killer_1=""; [ "$killed_1" != true ] || { result_1=killed; killer_1=CASE-TARGET-DRIFT-SUITE; }
mutation_v2_record "MUT-TARGET-REPLAY-REMOVED" ".claude/harness/runtime/workflow/sandbox-runtime.mjs" \
  "$applied_1" "$compiled_1" "$result_1" "CASE-TARGET-DRIFT-SUITE" "$killer_1" "$restored_1"

# Fault 2: `land check` stops weighing the target and reports on the change
# alone, which is what let it answer LAND READY for a base apply would refuse.
total=$((total + 1))
node - "$LANDABLE" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /if \(state\.workspace\?\.mode === "worktree" && !state\.workspace\.applied &&\s*\n\s*gitHead\(root\) !== state\.workspace\.baseHead\)/,
  "if (false) /* FOUNDATION-INJECTED-FAULT */");
if (mutated === source) { console.error("landable fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
applied_2=false compiled_2=false killed_2=false
mutation_applied_once "$LANDABLE" && applied_2=true
[ "$applied_2" != true ] || ! mutation_compiles "$LANDABLE" || compiled_2=true
if [ "$compiled_2" != true ]; then
  echo "FAIL: land target mutant did not apply exactly once and compile"
elif suite_passes; then
  echo "FAIL: removing the land-check target stop went undetected"
else
  echo "PASS: removing the land-check target stop is detected"
  killed_2=true
  killed=$((killed + 1))
fi
cp "$WORK/land-runtime.mjs" "$LANDABLE"
restored_2=false; cmp -s "$WORK/land-runtime.mjs" "$LANDABLE" && restored_2=true
result_2=survived killer_2=""; [ "$killed_2" != true ] || { result_2=killed; killer_2=CASE-TARGET-DRIFT-SUITE; }
mutation_v2_record "MUT-LAND-TARGET-GUARD-REMOVED" ".claude/harness/runtime/workflow/land-runtime.mjs" \
  "$applied_2" "$compiled_2" "$result_2" "CASE-TARGET-DRIFT-SUITE" "$killer_2" "$restored_2"

# Fault 3: commit identity is folded back into the composite content hash, so a
# history-only base movement charges another proof/review despite identical
# tracked bytes.
total=$((total + 1))
node - "$SNAPSHOT" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /repository, workspaceHash: value\[field\]/,
  "repository, workspaceHash: value[field], baseHead: value.baseHead // FOUNDATION-INJECTED-FAULT");
if (mutated === source) { console.error("content identity fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
applied_3=false compiled_3=false killed_3=false
mutation_applied_once "$SNAPSHOT" && applied_3=true
[ "$applied_3" != true ] || ! mutation_compiles "$SNAPSHOT" || compiled_3=true
if [ "$compiled_3" != true ]; then
  echo "FAIL: content identity mutant did not apply exactly once and compile"
elif suite_passes; then
  echo "FAIL: rebinding content identity to baseHead went undetected"
else
  echo "PASS: rebinding content identity to baseHead is detected"
  killed_3=true
  killed=$((killed + 1))
fi
cp "$WORK/repository-snapshot.mjs" "$SNAPSHOT"
restored_3=false; cmp -s "$WORK/repository-snapshot.mjs" "$SNAPSHOT" && restored_3=true
result_3=survived killer_3=""; [ "$killed_3" != true ] || { result_3=killed; killer_3=CASE-TARGET-DRIFT-SUITE; }
mutation_v2_record "MUT-CONTENT-IDENTITY-BINDS-HEAD" ".claude/harness/runtime/workflow/repository-snapshot.mjs" \
  "$applied_3" "$compiled_3" "$result_3" "CASE-TARGET-DRIFT-SUITE" "$killer_3" "$restored_3"

if ! cmp -s "$WORK/sandbox-runtime.mjs" "$REPLAY" ||
   ! cmp -s "$WORK/land-runtime.mjs" "$LANDABLE" ||
   ! cmp -s "$WORK/repository-snapshot.mjs" "$SNAPSHOT"; then
  echo "FAIL: a mutated source was not restored byte for byte"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi
echo "PASS: every mutated source is restored byte for byte"

echo "target drift mutation: ${killed}/${total} fault(s) detected"
mutation_v2_finish "$WORK"
if [ "$killed" -eq "$total" ]; then
  echo "FOUNDATION_MUTATION_RESULT=behavioral-kill"
  exit 0
fi
echo "FOUNDATION_MUTATION_RESULT=survived"
exit 1
