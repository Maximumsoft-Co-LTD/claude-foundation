#!/usr/bin/env sh
# profile-turns.sh — what the turns are actually spent ON.
#
# Cost on this suite is input-dominated ~6:1, and every turn re-sends the whole
# accumulated context, so cost tracks `turns x average context`, not instruction
# bytes. That was not a guess: two separate ~26 KB cuts to resident instructions
# (the S design read, the XS boot chain) each moved cost by under 1%. Bytes are
# cheap; turns are not. So the question that matters is which tool calls a run
# makes — this runs one task with `--output-format stream-json` and tallies every
# `tool_use` by tool and target.
#
#   sh profile-turns.sh --task 11-recent-window [--arm workflow] [--keep]
#
# One live run, same sandbox setup as run-bench.sh. It writes no scorecard row —
# this is a diagnostic, not a measurement, and mixing the two invites reading a
# single instrumented run as a result.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TASK=""; ARM="workflow"; KEEP=0; MODEL="${BENCH_MODEL:-sonnet}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift ;;
    --arm)  ARM="$2";  shift ;;
    --keep) KEEP=1 ;;
    *) echo "profile-turns: unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$TASK" ] || { echo "usage: profile-turns.sh --task <name> [--arm workflow|baseline]" >&2; exit 2; }

TDIR="$HERE/tasks/$TASK"
[ -d "$TDIR" ] || { echo "no such task: $TASK" >&2; exit 2; }
PROMPT="$TDIR/$( [ "$ARM" = baseline ] && echo baseline.txt || echo workflow.txt )"

ROOT="$(cd "$HERE/../../.." && pwd)"
SAND="$(mktemp -d)"
sb="$SAND/$TASK-$ARM"
mkdir -p "$sb"
[ -d "$TDIR/seed" ] && cp -R "$TDIR/seed/." "$sb/" 2>/dev/null || true
if [ "$ARM" != baseline ]; then
  mkdir -p "$sb/.claude"
  cp -R "$ROOT/.claude/." "$sb/.claude/" 2>/dev/null || true
  rm -rf "$sb/.claude/tests"   # never ship the bench (answer keys, baselines) into a graded sandbox
  [ -f "$ROOT/WORKFLOW.md" ] && cp "$ROOT/WORKFLOW.md" "$sb/"
  [ -f "$ROOT/CLAUDE.md" ]   && cp "$ROOT/CLAUDE.md"   "$sb/"
  [ -d "$ROOT/.workflow" ]   && cp -R "$ROOT/.workflow" "$sb/.workflow" 2>/dev/null || true
fi
( cd "$sb" && git init -q 2>/dev/null && git add -A 2>/dev/null && \
  git -c user.email=b@b -c user.name=bench commit -qm seed 2>/dev/null ) || true

stream="$SAND/stream.jsonl"
echo "sandbox: $sb"
echo "running (stream-json)…"
( cd "$sb" && claude -p "$(cat "$PROMPT")" --output-format stream-json --verbose \
    --dangerously-skip-permissions --model "$MODEL" ) > "$stream" 2>/dev/null || true

[ -s "$stream" ] || { echo "no stream captured" >&2; exit 1; }

echo
echo "turn inventory — $TASK / $ARM"
echo
# A round-trip = one context re-send = one tool RESULT going back to the model.
# Do NOT count assistant messages: the stream emits thinking, text and tool_use
# as separate assistant events, so a single API response shows up as two or three
# of them and the count reads ~65% high — which looks like idle deliberation that
# is not there. Tool results are the honest denominator, and they match the
# scorecard's `turns`.
#
# `calls per round-trip` stays pinned at 1.00 in headless `claude -p` — 118
# consecutive calls across two configurations never once put two tool_use blocks
# in one message. Treat it as an environment constant, NOT a defect to fix:
# parallel batching is not a lever here. The number to optimise is the raw call
# count, since each call costs a full re-send of everything accumulated so far.
jq -rs '
  [ .[] | select(.type=="user") ] as $results
  | [ .[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") ] as $calls
  | [ .[] | select(.type=="assistant") | .message.content[]? | select(.type=="thinking") ] as $think
  | "round-trips (context re-sends): \($results|length)",
    "tool calls:                     \($calls|length)",
    "calls per round-trip:           \((($calls|length) / ([$results|length,1]|max) * 100 | round) / 100)   <- pinned at 1.00 headless; optimise the call count, not this",
    "thinking blocks:                \($think|length)"
' "$stream"
echo
echo "  by tool:"
jq -rs '
  [ .[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") ]
  | group_by(.name) | map({t: .[0].name, n: length}) | sort_by(-.n)[]
  | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.t)"
' "$stream"
echo
echo "  most-touched paths (Read/Write/Edit):"
jq -rs '
  [ .[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
    | select(.name=="Read" or .name=="Write" or .name=="Edit")
    | (.input.file_path // .input.path // "?") ]
  | group_by(.) | map({p: .[0], n: length}) | sort_by(-.n) | .[:22][]
  | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.p)"
' "$stream"
echo
echo "  Bash commands:"
jq -rs '
  [ .[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
    | select(.name=="Bash") | (.input.command // "?" | split("\n")[0] | .[0:78]) ]
  | group_by(.) | map({c: .[0], n: length}) | sort_by(-.n) | .[:18][]
  | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.c)"
' "$stream"

if [ "$KEEP" = 1 ]; then
  echo
  echo "kept: $SAND  (stream: $stream)"
else
  rm -rf "$SAND"
fi
