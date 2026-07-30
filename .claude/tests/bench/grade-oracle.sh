#!/usr/bin/env sh
# grade-oracle.sh — deterministic per-AC grading for a solution sandbox.
#
#   sh grade-oracle.sh <sandbox-dir> <task-name>
#
# Dispatches to tasks/<task>/oracle/run.sh when that task has an oracle, and
# prints its JSON: {"results":{"AC1_…":"pass",…},"score":n,"max":m,"verdict":…}.
#
# Why this exists. judge-outcome.sh asks a model whether a diff meets the task's
# prose acceptance criteria. That is the right tool for "is this over-built" and
# the wrong one for "does AC4 hold": identical diffs have scored 9 and 4 on this
# suite, and a --keep run once graded 9/pass while silently failing two ACs. An
# oracle answers the second question exactly, for free, with no variance — so a
# quality claim stops needing n≥9 to be believed.
#
# The two graders are complements, not rivals:
#   judge  — subjective dimensions (simplicity, fit), any task, ~$0.02 + variance
#   oracle — objective per-AC pass/fail, only tasks that have one, $0 + no variance
# Report both. Where they disagree, the oracle is the one that can be checked.
#
# Oracles live in tasks/<task>/oracle/ and are NEVER copied into a sandbox
# (run-bench.sh copies only tasks/<task>/seed/), so they cannot leak the answer
# key the way .claude/tests once did.
#
# exit: 0 graded (verdict in the JSON) · 2 bad usage / broken oracle · 3 no oracle
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SB="${1:-}"; TASK="${2:-}"

[ -n "$SB" ] && [ -n "$TASK" ] || {
  echo "usage: grade-oracle.sh <sandbox-dir> <task-name>" >&2; exit 2; }
[ -d "$SB" ] || { echo "grade-oracle: no such sandbox: $SB" >&2; exit 2; }

ORACLE="$HERE/tasks/$TASK/oracle/run.sh"
[ -f "$ORACLE" ] || { echo "grade-oracle: no oracle for task $TASK" >&2; exit 3; }

out="$(sh "$ORACLE" "$SB" 2>/dev/null || true)"
case "$out" in
  *'"score"'*) printf '%s\n' "$out" ;;
  *) echo "grade-oracle: oracle for $TASK produced no score" >&2; exit 2 ;;
esac
