#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
COVERAGE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/foundation-runtime-coverage.XXXXXX")

cleanup() {
  rm -rf -- "$COVERAGE_TMP"
}
trap cleanup EXIT HUP INT TERM

cd "$ROOT"
"$ROOT/node_modules/.bin/c8" \
  --temp-directory="$COVERAGE_TMP" \
  --include='.claude/harness/foundation.mjs' \
  --include='.claude/harness/runtime/**/*.mjs' \
  --include='.claude/hooks/**/*.mjs' \
  --exclude='.claude/**/tests/**' \
  --reporter=json \
  --reporter=text-summary \
  --report-dir=.foundation/test-results/quality/coverage-runtime \
  sh .claude/tests/run-all.sh
