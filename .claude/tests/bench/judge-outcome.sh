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
# A missing score is NOT a zero. The rubric asks for single-line JSON, but models
# pretty-print anyway, and the old line-wise `grep -o '{.*}'` then grabbed the
# first NESTED object on the reply — usually "subscores" — which parses as valid
# JSON but carries no .score. A `// 0` default turned that into 0/fail, so a run
# the judge had actually scored 8/pass was recorded as a total quality failure.
# Two /dev arms with wildly different behaviour (spawn_count 4 and 0) both landed
# on exactly 0 that way. Parsing now reads the whole reply, and a reply without a
# numeric .score exits 2 (unjudgeable) rather than manufacturing a zero.
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
command -v jq >/dev/null 2>&1     || { echo "judge-outcome: SKIP — no jq" >&2; exit 2; }
# The live call is skipped entirely when a canned reply is supplied (test seam).
[ -n "${JUDGE_REPLY_FILE:-}" ] || command -v claude >/dev/null 2>&1 \
  || { echo "judge-outcome: SKIP — no claude CLI" >&2; exit 2; }

# Stage everything so new files show, then diff the code the run produced against
# the recorded base commit — capturing both COMMITTED and working-tree changes
# (diffing against HEAD would miss code a /dev ship phase already committed).
git -C "$sb" add -A >/dev/null 2>&1 || true
# Excludes, in three groups: /dev's own process artifacts (they must not inflate a
# CODE grade), the bench's own files, and build caches. The last two groups were
# missing and it mattered — a trivial CSV run handed the judge 33KB of diff of
# which 31KB was `.bench-envelope.json` + `__pycache__`, leaving 1.8KB of actual
# solution. Longer runs write bigger envelopes, so the real code fell off the end
# of the cap and the judge graded metadata. Build caches are excluded, but dist/
# and build/ are NOT — for some tasks those hold the deliverable.
diff="$(git -C "$sb" diff --cached "$BASE" -- . \
  ':(exclude).workflow' ':(exclude).claude' ':(exclude)WORKFLOW.md' ':(exclude)CLAUDE.md' \
  ':(exclude).bench-envelope.json' ':(exclude).bench-timeout' \
  ':(exclude)__pycache__' ':(exclude)*.pyc' ':(exclude)node_modules' \
  ':(exclude).venv' ':(exclude).pytest_cache' ':(exclude)*.log' \
  2>/dev/null || true)"
[ -n "$diff" ] || { echo "judge-outcome: SKIP — empty solution diff in $sb" >&2; exit 2; }
# Cap the diff so a runaway output doesn't blow the judge prompt. Say so when it
# fires: a silently truncated diff yields a low score that reads as bad code.
dlen="$(printf '%s' "$diff" | wc -c | tr -d ' ')"
if [ "$dlen" -gt 60000 ]; then
  echo "judge-outcome: WARNING — solution diff is ${dlen}B, truncated to 60000B; the grade covers only the first part" >&2
fi
diff="$(printf '%s' "$diff" | head -c 60000)"

prompt="$(cat "$RUBRIC")

Task acceptance criteria:
$(cat "$acc")

Solution diff (grade this):
\`\`\`diff
$diff
\`\`\`

Reply with ONLY the JSON object."

# JUDGE_REPLY_FILE short-circuits the live call so the reply PARSER can be
# unit-tested without tokens — the parser is exactly where a real score was
# silently rewritten to 0, so it needs a test that costs nothing to run.
if [ -n "${JUDGE_REPLY_FILE:-}" ]; then
  reply="$(cat "$JUDGE_REPLY_FILE")"
else
  reply="$(printf '%s' "$prompt" | claude -p --model "$MODEL" 2>/dev/null || true)"
fi

# Parse the reply as a WHOLE — a pretty-printed object must survive intact.
# 1) strip any markdown fence, try the entire reply as JSON;
# 2) failing that, take the outermost {...} span across all lines (never per-line,
#    which is what used to select the nested "subscores" object).
json="$(printf '%s' "$reply" | sed -e 's/^[[:space:]]*```[a-zA-Z]*[[:space:]]*$//' | jq -c . 2>/dev/null || true)"
if [ -z "$json" ]; then
  json="$(printf '%s' "$reply" | tr '\n' ' ' | sed -e 's/^[^{]*//' -e 's/[^}]*$//' | jq -c . 2>/dev/null || true)"
fi

if [ -z "$json" ] || ! printf '%s' "$json" | jq -e . >/dev/null 2>&1; then
  echo "judge-outcome: SKIP — unparseable reply: ${reply:-<empty>}" >&2
  exit 2
fi
# No numeric .score means the judge did not answer the question. Report that as
# unjudgeable (the row's score becomes null and aggregate.sh drops it) instead of
# recording a 0 that reads downstream as "the run delivered nothing".
if ! printf '%s' "$json" | jq -e '(.score | type) == "number"' >/dev/null 2>&1; then
  echo "judge-outcome: SKIP — reply carries no numeric .score: $json" >&2
  exit 2
fi

score="$(printf '%s' "$json" | jq -r '.score')"
verdict="$(printf '%s' "$json" | jq -r '.verdict // "fail"')"
notes="$(printf '%s' "$json" | jq -r '.notes // ""')"
echo "judge-outcome: $(basename "$sb") — score=$score verdict=$verdict :: $notes" >&2
printf '%s\n' "$json"

[ "$verdict" = "pass" ] && exit 0 || exit 1
