#!/usr/bin/env sh
# TAP view of the suites that carry sandbox-seam evidence: the shared contract
# slices (sandbox creation and setup, apply, Land, multi-repository fan-out)
# plus the static wiring contract that guards the composition root.
#
# Same shape as run-changeloop-seam-tap.sh: the underlying suites speak
# PASS/FAIL for humans and run-all.sh; evidence needs a count to check against
# a floor, so this wrapper restates the same runs as TAP.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"

report="$(mktemp)"
trap 'rm -f "$report"' EXIT HUP INT TERM

status=0
for suite in \
  "$HERE/run-harness-tests.sh" \
  "$HERE/run-wiring-tests.sh"
do
  sh "$suite" >> "$report" 2>&1 || status=1
done

count="$(grep -c '^\(PASS\|FAIL\): ' "$report" 2>/dev/null || true)"
[ -n "$count" ] || count=0

printf 'TAP version 13\n'
printf '1..%s\n' "$count"
awk '
  /^PASS: / { n += 1; printf "ok %d - %s\n", n, substr($0, 7); next }
  /^FAIL: / { n += 1; printf "not ok %d - %s\n", n, substr($0, 7); next }
' "$report"

# A suite that could not run at all is not a passing suite with zero tests.
[ "$count" -gt 0 ] || { printf 'Bail out! evidence suites produced no assertions\n'; exit 1; }
exit "$status"
