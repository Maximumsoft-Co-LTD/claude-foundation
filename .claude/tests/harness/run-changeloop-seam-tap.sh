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
mode="${1:-tap}"
case "$mode" in
  tap|--json) ;;
  *) echo "usage: $0 [--json]" >&2; exit 2 ;;
esac

report="$(mktemp)"
trap 'rm -f "$report"' EXIT HUP INT TERM

status=0
for suite in \
  "$HERE/run-changeloop-seam-tests.sh" \
  "$HERE/contracts/evidence-proof.sh" \
  "$ROOT/.claude/tests/hooks/run-phase-mutation-guard-tests.sh" \
  "$HERE/run-workspace-surface-tests.mjs" \
  "$HERE/run-context-budget-tests.sh" \
  "$ROOT/.claude/tests/interview/run-interview-tests.sh"
do
  # Node suites carry change-loop evidence too; only the interpreter differs.
  case "$suite" in
    *.mjs) node "$suite" >> "$report" 2>&1 || status=1 ;;
    *) sh "$suite" >> "$report" 2>&1 || status=1 ;;
  esac
done

count="$(grep -c '^\(PASS\|FAIL\): ' "$report" 2>/dev/null || true)"
[ -n "$count" ] || count=0

if [ "$mode" = "--json" ]; then
  critical="$(sed -n \
    -e 's/^PASS: \[\([^]]*\)\].*/\1\tpassed/p' \
    -e 's/^FAIL: \[\([^]]*\)\].*/\1\tfailed/p' "$report" |
    jq -Rn '[inputs | select(length > 0) | split("\t") |
      {id: .[0], status: .[1]}]')"
  jq -n --argjson total "$count" --argjson critical "$critical" \
    '{totalTests: $total, criticalCases: $critical}'
  grep '^FAIL: ' "$report" >&2 || true
  [ "$count" -gt 0 ] || exit 1
  exit "$status"
fi

printf 'TAP version 13\n'
printf '1..%s\n' "$count"
awk '
  /^PASS: / { n += 1; printf "ok %d - %s\n", n, substr($0, 7); next }
  /^FAIL: / { n += 1; printf "not ok %d - %s\n", n, substr($0, 7); next }
' "$report"

# A suite that could not run at all is not a passing suite with zero tests.
[ "$count" -gt 0 ] || { printf 'Bail out! evidence suites produced no assertions\n'; exit 1; }
exit "$status"
