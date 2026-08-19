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
WORK="$(mktemp -d)"
SOURCE="$WORK/source"
. "$ROOT/.claude/tests/lib/mutation-fixture.sh"
create_mutation_fixture "$ROOT" "$SOURCE"
CONTRACT="$SOURCE/.claude/harness/runtime/evidence/evidence-contract.mjs"
STATE="$SOURCE/.claude/harness/runtime/core/state-runtime.mjs"

restore() {
  rm -rf "$WORK"
}
# HUP and PIPE as well as the usual two: a mutation script that dies without
# restoring leaves the repository holding a deliberately broken runtime, and the
# next thing anyone runs fails for a reason that is not theirs. Piping a full
# `run-all.sh` into `head` is enough to do it.

trap 'restore' EXIT
trap 'exit 130' HUP INT PIPE TERM
if grep -rl "FOUNDATION-INJECTED-FAULT" "$SOURCE/.claude/harness" 2>/dev/null | grep -q .; then
  echo "FAIL: source fixture already carries an injected fault"
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
fi

cp "$CONTRACT" "$WORK/evidence-contract.mjs"
cp "$STATE" "$WORK/state-runtime.mjs"

# Kept, not discarded: a baseline that fails for its own reasons is the one
# outcome this script cannot interpret, and swallowing the output turned it into
# a bare "not-applied" with nothing to act on.
suite_passes() {
  ( cd "$SOURCE" && "$@" > "$WORK/suite.log" 2>&1 )
}

report_baseline() {
  echo "FAIL: $1 does not pass before any mutation is applied"
  tail -15 "$WORK/suite.log" 2>/dev/null || true
  echo "FOUNDATION_MUTATION_RESULT=not-applied"
  exit 1
}

# The focused surface suite pins the same code-vs-packet hash boundary in about
# a second. Running the 218-assertion evidence contract for this single fault
# dominated run-all's critical path while adding no mutation sensitivity.
CODE_SUITE=".claude/tests/harness/run-land-surface-tests.mjs"
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

if preproven land-surface; then
  echo "PASS: land-surface baseline vouched by the pooled run"
else
  suite_passes node --test "$CODE_SUITE" || report_baseline "$CODE_SUITE"
fi
if preproven feedback-review; then
  echo "PASS: feedback-review baseline vouched by the pooled run"
else
  suite_passes sh "$REVIEW_SUITE" || report_baseline "$REVIEW_SUITE"
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
if suite_passes node --test "$CODE_SUITE"; then
  echo "FAIL: folding the packet back into the code hash went undetected"
else
  echo "PASS: folding the packet back into the code hash is detected"
  killed=$((killed + 1))
fi
cp "$WORK/state-runtime.mjs" "$STATE"

# Fault 2: review loses its semantic subject hash and binds the code hash like
# executable evidence. A review receipt would then outlive an edit to the
# proposal or specification the reviewer read.
total=$((total + 1))
node - "$CONTRACT" <<'MUTATE'
const fs = require("node:fs");
const path = process.argv[2];
const source = fs.readFileSync(path, "utf8");
const mutated = source.replace(
  /const field = capability === "review" \? "reviewHash"/,
  'const field = capability === "review" ? "codeHash" /* FOUNDATION-INJECTED-FAULT */');
if (mutated === source) { console.error("review-exemption fault did not apply"); process.exit(3); }
fs.writeFileSync(path, mutated);
MUTATE
if suite_passes sh "$REVIEW_SUITE"; then
  echo "FAIL: replacing the review subject hash with the code hash went undetected"
else
  echo "PASS: replacing the review subject hash with the code hash is detected"
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
