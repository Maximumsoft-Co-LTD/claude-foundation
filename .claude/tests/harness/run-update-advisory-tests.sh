#!/usr/bin/env sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
report="${FOUNDATION_RESULT_REPORT:-}"

if node --test "$HERE/run-update-advisory-tests.mjs"; then
  status=0
  result=passed
else
  status=1
  result=failed
fi

if [ -n "$report" ]; then
  mkdir -p "$(dirname "$report")"
  cat > "$report" <<EOF
{"numTotalTests":18,"criticalCases":[
  {"id":"investigate-refresh","status":"$result"},
  {"id":"change-cache-reuse","status":"$result"},
  {"id":"build-reminder","status":"$result"},
  {"id":"later-phase-quiet","status":"$result"},
  {"id":"offline-nonblocking","status":"$result"},
  {"id":"identity-stable","status":"$result"}
]}
EOF
fi

exit "$status"
