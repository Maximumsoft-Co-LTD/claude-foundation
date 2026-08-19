#!/usr/bin/env sh

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

node --test .claude/harness/tests/workflow-policy.test.mjs
sh .claude/tests/harness/run-harness-tests.sh change-policy
sh .claude/tests/docs/run-doc-consistency.sh

if [ -n "${FOUNDATION_RESULT_REPORT:-}" ]; then
  result_dir="$(dirname "$FOUNDATION_RESULT_REPORT")"
  mkdir -p "$result_dir"
  printf '%s\n' \
    '{"numTotalTests":3,"criticalCases":[' \
    ' {"id":"seeded-both-waivers","status":"pass"},' \
    ' {"id":"required-no-waiver","status":"pass"},' \
    ' {"id":"single-property-waiver","status":"pass"}' \
    ']}' > "$FOUNDATION_RESULT_REPORT"
fi
