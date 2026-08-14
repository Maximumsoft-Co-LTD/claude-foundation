#!/bin/sh
# Do the suites actually detect a broken evidence binding, or only describe one?
#
# Two deliberate faults, on either side of the same decision. The packet is
# omitted from the hash an executable provider binds — remove that and the
# defect this change fixed returns. Review and acceptance are exempt from the
# omission — remove *that* and evidence gets weaker instead of cheaper: a
# reviewer's verdict would survive an edit to the proposal they reviewed.
#
# The second fault is the one worth paying for. A regression that only makes
# proof expensive is visible the first time someone runs it; a regression that
# makes review evidence survive an edit it should not is silent.
#
# Reverting is proved by comparing bytes rather than by another suite run.
#
# Emits FOUNDATION_MUTATION_RESULT for the mutation adapter.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
CONTRACT="$ROOT/.claude/harness/runtime/evidence/evidence-contract.mjs"
STATE="$ROOT/.claude/harness/runtime/core/state-runtime.mjs"
WORK="$(mktemp -d)"

restore() {
  [ -f "$WORK/evidence-contract.mjs" ] && cp "$WORK/evidence-contract.mjs" "$CONTRACT"
  [ -f "$WORK/state-runtime.mjs" ] && cp "$WORK/state-runtime.mjs" "$STATE"
  rm -rf "$WORK"
}
# HUP and PIPE as well as the usual two: a mutation script that dies without
# restoring leaves the repository holding a deliberately broken runtime, and the
# next thing anyone runs fails for a reason that is not theirs. Piping a full
# `run-all.sh` into `head` is enough to do it.

# Serialized against every other in-place mutation of this checkout, and
# refused outright on a tree that still carries one. Two runs overlapping
# restores one run's injected fault as the other's "clean" source.
. "$ROOT/.claude/tests/lib/mutation-lock.sh"
acquire_mutation_lock "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }
trap 'restore; release_mutation_lock' EXIT HUP INT PIPE TERM
assert_no_injected_fault "$ROOT" || { echo "FOUNDATION_MUTATION_RESULT=not-applied"; exit 1; }

cp "$CONTRACT" "$WORK/evidence-contract.mjs"
cp "$STATE" "$WORK/state-runtime.mjs"

# Kept, not discarded: a baseline that fails for its own reasons is the one
# outcome this script cannot interpret, and swallowing the output turned it into
# a bare "not-applied" with nothing to act on.
suite_passes() {
  ( cd "$ROOT" && sh "$@" > "$WORK/suite.log" 2>&1 )
}

report_baseline() {
  echo "FAIL: $1 does not pass before any mutation is applied"
  tail -15 "$WORK/suite.log" 2>/dev/null || true
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
}

# A kill targets the slice that owns the detecting assertions, not the whole
# aggregate runner: the packet-omission assertions live in the evidence-proof
# contract slice, and a mutated run only has to reach them.
CODE_SUITE=".claude/tests/harness/run-harness-tests.sh"
CODE_SLICE="evidence-proof"
REVIEW_SUITE=".claude/tests/harness/run-feedback-review-tests.sh"

# `run-all.sh` vouches for detector rows its pool already ran green against
# this same unmutated tree (FOUNDATION_PREPROVEN_SUITES). A vouched baseline is
# a repeat, so skip it; a standalone invocation carries no vouchers and proves
# both baselines itself.
preproven() {
  case " ${FOUNDATION_PREPROVEN_SUITES:-} " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

if preproven evidence-proof; then
  echo "PASS: evidence-proof baseline vouched by the pooled run"
else
  suite_passes "$CODE_SUITE" "$CODE_SLICE" || report_baseline "$CODE_SUITE $CODE_SLICE"
fi
if preproven feedback-review; then
  echo "PASS: feedback-review baseline vouched by the pooled run"
else
  suite_passes "$REVIEW_SUITE" || report_baseline "$REVIEW_SUITE"
fi
echo "PASS: baseline suites pass before mutation"

killed=0
total=0

# Fault 1: the packet is folded back into the code hash, so every executable
# receipt expires again for a note added to design.md. The original defect.
total=$((total + 1))
node - "$STATE" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /if \(digest === codeHash && isChangePacketPath\(rel, id\)\) continue;/,
  "// FOUNDATION-INJECTED-FAULT: the packet is code again");
if (mutated === source) { console.error("packet-omission fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes "$CODE_SUITE" "$CODE_SLICE"; then
  echo "FAIL: folding the packet back into the code hash went undetected"
else
  echo "PASS: folding the packet back into the code hash is detected"
  killed=$((killed + 1))
fi
cp "$WORK/state-runtime.mjs" "$STATE"

# Fault 2: review and acceptance lose their exemption and bind the code hash
# like everything else. Proof gets cheaper and evidence gets weaker — a review
# receipt would outlive an edit to the packet the reviewer read.
total=$((total + 1))
node - "$CONTRACT" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /return \["review", "acceptance"\]\s*\n\s*\.includes\(providerCapability\(provider, providerConfig\(id, provider\)\)\);/,
  "return false; // FOUNDATION-INJECTED-FAULT: review binds the code half too");
if (mutated === source) { console.error("review-exemption fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes "$REVIEW_SUITE"; then
  echo "FAIL: removing the review binding exemption went undetected"
else
  echo "PASS: removing the review binding exemption is detected"
  killed=$((killed + 1))
fi
cp "$WORK/evidence-contract.mjs" "$CONTRACT"

if ! cmp -s "$WORK/state-runtime.mjs" "$STATE" ||
   ! cmp -s "$WORK/evidence-contract.mjs" "$CONTRACT"; then
  echo "FAIL: a mutated source was not restored byte for byte"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi
echo "PASS: every mutated source is restored byte for byte"

echo "evidence binding mutation: ${killed}/${total} fault(s) detected"
if [ "$killed" -eq "$total" ]; then
  echo "FOUNDATION_MUTATION_RESULT=behavioral-kill"
  exit 0
fi
echo "FOUNDATION_MUTATION_RESULT=survived"
exit 1
