#!/usr/bin/env sh
# TAP view of the suite that carries review-gate evidence.
#
# `assert.sh` prints PASS/FAIL because the suite is read by a human and by
# `run-all.sh`, which only needs an exit code. Evidence needs a count it can
# check against a floor, so this wrapper restates the same run as TAP rather
# than giving the suite a second assertion vocabulary to keep in step.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"

report="$(mktemp)"
trap 'rm -f "$report"' EXIT HUP INT TERM

status=0
sh "$HERE/run-feedback-review-tests.sh" >> "$report" 2>&1 || status=1

count="$(grep -c '^\(PASS\|FAIL\): ' "$report" 2>/dev/null || true)"
[ -n "$count" ] || count=0

printf 'TAP version 13\n'
printf '1..%s\n' "$count"
awk '
  /^PASS: / { n += 1; printf "ok %d - %s\n", n, substr($0, 7); next }
  /^FAIL: / { n += 1; printf "not ok %d - %s\n", n, substr($0, 7); next }
' "$report"

# A suite that could not run at all is not a passing suite with zero tests.
[ "$count" -gt 0 ] || { printf 'Bail out! review suite produced no assertions\n'; exit 1; }
exit "$status"
