#!/usr/bin/env sh
# judge-outcome.sh — grade the SOLUTION a run delivered (its code diff) against a
# task's acceptance criteria. Arm-agnostic, so the /dev arm and the plain-prompt
# arm are scored on the same axis (the A/B fairness anchor).
#
# The diff excludes .workflow/ and .claude/ so process artifacts don't inflate
# the code grade. New files are included (staged first).
#
# stdout: one strict-JSON object {score, subscores, verdict, notes}
# stderr: a human summary line
# exit:   0 pass · 1 fail · 2 could-not-judge (no claude/jq, empty diff, bad reply)
#
# Usage:  sh judge-outcome.sh <sandbox-dir> <acceptance-file> [--model <id>]

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
RUBRIC="$HERE/rubric-outcome.md"
MODEL="sonnet"
BASE="HEAD"    # diff the solution against this ref; run-bench passes the sandbox
               # base commit so code the run COMMITTED (e.g. /dev's ship) is still seen.

sb=""; acc=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --base)  BASE="$2";  shift 2 ;;
    *) if [ -z "$sb" ]; then sb="$1"; elif [ -z "$acc" ]; then acc="$1"; fi; shift ;;
  esac
done

[ -n "$sb" ] && [ -d "$sb" ] || { echo "judge-outcome: not a dir: ${sb:-<none>}" >&2; exit 2; }
[ -n "$acc" ] && [ -f "$acc" ] || { echo "judge-outcome: no acceptance file: ${acc:-<none>}" >&2; exit 2; }
command -v claude >/dev/null 2>&1 || { echo "judge-outcome: SKIP — no claude CLI" >&2; exit 2; }
command -v jq >/dev/null 2>&1     || { echo "judge-outcome: SKIP — no jq" >&2; exit 2; }

# Stage everything so new files show, then diff the code the run produced against
# the recorded base commit — capturing both COMMITTED and working-tree changes
# (diffing against HEAD would miss code a /dev ship phase already committed).
git -C "$sb" add -A >/dev/null 2>&1 || true
diff="$(git -C "$sb" diff --cached "$BASE" -- . ':(exclude).workflow' ':(exclude).claude' ':(exclude)WORKFLOW.md' ':(exclude)CLAUDE.md' 2>/dev/null || true)"
[ -n "$diff" ] || { echo "judge-outcome: SKIP — empty solution diff in $sb" >&2; exit 2; }
# Cap the diff so a runaway output doesn't blow the judge prompt.
diff="$(printf '%s' "$diff" | head -c 60000)"

prompt="$(cat "$RUBRIC")

Task acceptance criteria:
$(cat "$acc")

Solution diff (grade this):
\`\`\`diff
$diff
\`\`\`

Reply with ONLY the JSON object."

reply="$(printf '%s' "$prompt" | claude -p --model "$MODEL" 2>/dev/null || true)"
json="$(printf '%s' "$reply" | tr -d '\r' | grep -o '{.*}' | head -n1 || true)"

if [ -z "$json" ] || ! printf '%s' "$json" | jq -e . >/dev/null 2>&1; then
  echo "judge-outcome: SKIP — unparseable reply: ${reply:-<empty>}" >&2
  exit 2
fi

score="$(printf '%s' "$json" | jq -r '.score // 0')"
verdict="$(printf '%s' "$json" | jq -r '.verdict // "fail"')"
notes="$(printf '%s' "$json" | jq -r '.notes // ""')"
echo "judge-outcome: $(basename "$sb") — score=$score verdict=$verdict :: $notes" >&2
printf '%s\n' "$json"

[ "$verdict" = "pass" ] && exit 0 || exit 1
