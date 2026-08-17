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
REPLAY="$ROOT/.claude/harness/runtime/workflow/sandbox-runtime.mjs"
LANDABLE="$ROOT/.claude/harness/runtime/workflow/land-runtime.mjs"
SNAPSHOT="$ROOT/.claude/harness/runtime/workflow/repository-snapshot.mjs"
WORK="$(mktemp -d)"

restore() {
  [ -f "$WORK/sandbox-runtime.mjs" ] && cp "$WORK/sandbox-runtime.mjs" "$REPLAY"
  [ -f "$WORK/land-runtime.mjs" ] && cp "$WORK/land-runtime.mjs" "$LANDABLE"
  [ -f "$WORK/repository-snapshot.mjs" ] && cp "$WORK/repository-snapshot.mjs" "$SNAPSHOT"
  rm -rf "$WORK"
}

# Serialized against every other in-place mutation of this checkout, and
# refused outright on a tree that still carries one. Two runs overlapping
# restores one run's injected fault as the other's "clean" source.
. "$ROOT/.claude/tests/lib/mutation-lock.sh"
acquire_mutation_lock "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }
trap 'restore; release_mutation_lock' EXIT INT TERM
assert_no_injected_fault "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }

cp "$REPLAY" "$WORK/sandbox-runtime.mjs"
cp "$LANDABLE" "$WORK/land-runtime.mjs"
cp "$SNAPSHOT" "$WORK/repository-snapshot.mjs"

suite_passes() {
  ( cd "$ROOT" && sh "$SUITE" >/dev/null 2>&1 )
}

if ! suite_passes; then
  echo "FAIL: the suite does not pass before any mutation is applied"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
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
  /if \(state\.workspace\.mode !== "worktree"\) return null;/,
  "return null; // FOUNDATION-INJECTED-FAULT: replay and its report removed");
if (mutated === source) { console.error("replay fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes; then
  echo "FAIL: removing the worktree replay went undetected"
else
  echo "PASS: removing the worktree replay is detected"
  killed=$((killed + 1))
fi
cp "$WORK/sandbox-runtime.mjs" "$REPLAY"

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
if suite_passes; then
  echo "FAIL: removing the land-check target stop went undetected"
else
  echo "PASS: removing the land-check target stop is detected"
  killed=$((killed + 1))
fi
cp "$WORK/land-runtime.mjs" "$LANDABLE"

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
if suite_passes; then
  echo "FAIL: rebinding content identity to baseHead went undetected"
else
  echo "PASS: rebinding content identity to baseHead is detected"
  killed=$((killed + 1))
fi
cp "$WORK/repository-snapshot.mjs" "$SNAPSHOT"

if ! cmp -s "$WORK/sandbox-runtime.mjs" "$REPLAY" ||
   ! cmp -s "$WORK/land-runtime.mjs" "$LANDABLE" ||
   ! cmp -s "$WORK/repository-snapshot.mjs" "$SNAPSHOT"; then
  echo "FAIL: a mutated source was not restored byte for byte"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi
echo "PASS: every mutated source is restored byte for byte"

echo "target drift mutation: ${killed}/${total} fault(s) detected"
if [ "$killed" -eq "$total" ]; then
  echo "FOUNDATION_MUTATION_RESULT=behavioral-kill"
  exit 0
fi
echo "FOUNDATION_MUTATION_RESULT=survived"
exit 1
