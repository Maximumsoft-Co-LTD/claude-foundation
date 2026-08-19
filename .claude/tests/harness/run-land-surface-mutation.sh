#!/bin/sh
# Does the land-surface suite actually detect a removed guard, or does it only
# describe one?
#
# Two deliberate faults, each at a boundary the change exists to hold: the
# untracked-and-undeclared filter that keeps a foreign tree out of the change
# surface, and the deletion filter that refuses to remove a path no task named.
# A suite that still passes with either removed is not evidence.
#
# Emits FOUNDATION_MUTATION_RESULT for the mutation adapter.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SUITE=".claude/tests/harness/run-land-surface-tests.mjs"
SURFACE="$ROOT/.claude/harness/runtime/core/state-runtime.mjs"
DELETION="$ROOT/.claude/harness/runtime/workflow/apply-recovery.mjs"
WORK="$(mktemp -d)"

restore() {
  [ -f "$WORK/state-runtime.mjs" ] && cp "$WORK/state-runtime.mjs" "$SURFACE"
  [ -f "$WORK/apply-recovery.mjs" ] && cp "$WORK/apply-recovery.mjs" "$DELETION"
  rm -rf "$WORK"
}

# Serialized against every other in-place mutation of this checkout, and
# refused outright on a tree that still carries one. Two runs overlapping
# restores one run's injected fault as the other's "clean" source.
. "$ROOT/.claude/tests/lib/mutation-lock.sh"
acquire_mutation_lock "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }
trap 'restore; release_mutation_lock' EXIT
trap 'exit 130' HUP INT PIPE TERM
assert_no_injected_fault "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }

cp "$SURFACE" "$WORK/state-runtime.mjs"
cp "$DELETION" "$WORK/apply-recovery.mjs"

suite_passes() {
  ( cd "$ROOT" && node --test "$SUITE" >/dev/null 2>&1 )
}

if ! suite_passes; then
  echo "FAIL: the suite does not pass before any mutation is applied"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi
echo "PASS: baseline suite passes before mutation"

killed=0
total=0

# Fault 1: the change surface stops excluding untracked, undeclared paths.
total=$((total + 1))
node - "$SURFACE" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /if \(gitAware && !tracked\.has\(rel\) && !isCurrentChangePath\(rel, id\) &&\s*\n\s*!declared\(rel\)\) continue;/,
  "// FOUNDATION-INJECTED-FAULT: surface filter removed");
if (mutated === source) { console.error("surface fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes; then
  echo "FAIL: removing the untracked/undeclared surface filter went undetected"
else
  echo "PASS: removing the untracked/undeclared surface filter is detected"
  killed=$((killed + 1))
fi
cp "$WORK/state-runtime.mjs" "$SURFACE"

# Fault 2: every absent path becomes a legal deletion again.
total=$((total + 1))
node - "$DELETION" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /!declared\(entry\.path\)\);/, "true /* FOUNDATION-INJECTED-FAULT */);");
if (mutated === source) { console.error("deletion fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes; then
  echo "FAIL: removing the declared-deletion filter went undetected"
else
  echo "PASS: removing the declared-deletion filter is detected"
  killed=$((killed + 1))
fi
cp "$WORK/apply-recovery.mjs" "$DELETION"

if ! suite_passes; then
  echo "FAIL: the suite does not pass again after the faults are reverted"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi
echo "PASS: the suite passes again once the faults are reverted"

echo "land surface mutation: ${killed}/${total} fault(s) detected"
if [ "$killed" -eq "$total" ]; then
  echo "FOUNDATION_MUTATION_RESULT=behavioral-kill"
  exit 0
fi
echo "FOUNDATION_MUTATION_RESULT=survived"
exit 1
