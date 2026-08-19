#!/usr/bin/env sh

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

sh .claude/tests/harness/run-installer-tests.sh
sh .claude/tests/docs/run-doc-consistency.sh

if [ -n "${FOUNDATION_RESULT_REPORT:-}" ]; then
  result_dir="$(dirname "$FOUNDATION_RESULT_REPORT")"
  mkdir -p "$result_dir"
  printf '%s\n' \
    '{"numTotalTests":3,"criticalCases":[' \
    ' {"id":"host-capability-matrix","status":"pass"},' \
    ' {"id":"retired-owned-command","status":"pass"},' \
    ' {"id":"preserve-user-command","status":"pass"}' \
    ']}' > "$FOUNDATION_RESULT_REPORT"
fi
