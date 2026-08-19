#!/usr/bin/env sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
report="${FOUNDATION_RESULT_REPORT:-}"

if node --test "$HERE/run-actionable-validation-telemetry-tests.mjs"; then
  status=0
  result=passed
else
  status=1
  result=failed
fi

if [ -n "$report" ]; then
  mkdir -p "$(dirname "$report")"
  cat > "$report" <<EOF
{"numTotalTests":6,"criticalCases":[
  {"id":"claim-errors-together","status":"$result"},
  {"id":"task-errors-together","status":"$result"},
  {"id":"codex-unavailable","status":"$result"},
  {"id":"uncorrelated-unavailable","status":"$result"},
  {"id":"measured-usage-compatible","status":"$result"}
]}
EOF
fi

exit "$status"
