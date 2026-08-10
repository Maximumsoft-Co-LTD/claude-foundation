#!/usr/bin/env sh
# TAP view of the suites that carry change-loop evidence.
#
# `assert.sh` prints PASS/FAIL because every other suite is read by a human or
# by `run-all.sh`, which only needs an exit code. Evidence needs a count it can
# check against a floor, so this wrapper restates the same runs as TAP rather
# than giving those suites a second assertion vocabulary to keep in step.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

report="$(mktemp)"
trap 'rm -f "$report"' EXIT HUP INT TERM

status=0
for suite in \
  "$HERE/run-changeloop-seam-tests.sh" \
  "$ROOT/.claude/tests/hooks/run-phase-mutation-guard-tests.sh" \
  "$HERE/run-workspace-surface-tests.mjs" \
  "$HERE/run-context-budget-tests.sh"
do
  # Node suites carry change-loop evidence too; only the interpreter differs.
  case "$suite" in
    *.mjs) node "$suite" >> "$report" 2>&1 || status=1 ;;
    *) sh "$suite" >> "$report" 2>&1 || status=1 ;;
  esac
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
