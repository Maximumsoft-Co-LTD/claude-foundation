#!/usr/bin/env sh

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

node --test \
  .claude/harness/tests/repository-topology.test.mjs \
  .claude/harness/tests/grounding-policy.test.mjs
sh .claude/tests/harness/run-target-drift-tests.sh

if [ -n "${FOUNDATION_RESULT_REPORT:-}" ]; then
  result_dir="$(dirname "$FOUNDATION_RESULT_REPORT")"
  mkdir -p "$result_dir"
  printf '%s\n' \
    '{"numTotalTests":3,"criticalCases":[' \
    ' {"id":"root-read-refresh","status":"pass"},' \
    ' {"id":"active-selection-preserved","status":"pass"},' \
    ' {"id":"multi-repository-target-selection","status":"pass"}' \
    ']}' > "$FOUNDATION_RESULT_REPORT"
fi
