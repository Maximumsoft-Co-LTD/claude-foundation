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
#   sh profile-turns.sh --sandbox <dir>          # FREE — reads a run that happened
#   sh profile-turns.sh --transcript <file>      # FREE — explicit transcript
#   sh profile-turns.sh --task 11-recent-window  # live: spends a full run
#
# PREFER THE FREE MODES. Every `claude` session already writes a transcript under
# ~/.claude/projects/<slug>/, and it carries exactly what this script tallies —
# so paying for a second instrumented run to see the tool inventory of a run you
# already did is pure waste. The live mode stays for the case where nothing
# suitable has been run yet. Point --sandbox at any bench sandbox kept with
# `--keep`, or read the `sandbox` field off a scorecard row.
#
# It writes no scorecard row either way — this is a diagnostic, not a measurement,
# and mixing the two invites reading a single instrumented run as a result.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TASK=""; ARM="workflow"; KEEP=0; MODEL="${BENCH_MODEL:-sonnet}"
SANDBOX=""; TRANSCRIPT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift ;;
    --arm)  ARM="$2";  shift ;;
    --keep) KEEP=1 ;;
    --sandbox)    SANDBOX="$2"; shift ;;
    --transcript) TRANSCRIPT="$2"; shift ;;
    *) echo "profile-turns: unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

# ---- free mode: profile a run that already happened -------------------------
# The transcript has the same shape the stream-json capture does (`assistant`
# entries with a `message.content[]` array), so the tallies below are identical —
# only the source changes, from a paid run to a file.
if [ -n "$SANDBOX" ] || [ -n "$TRANSCRIPT" ]; then
  PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
  if [ -z "$TRANSCRIPT" ]; then
    [ -d "$SANDBOX" ] || { echo "profile-turns: no such sandbox: $SANDBOX" >&2; exit 2; }
    # Resolve the path first: macOS mktemp returns /var/... while the CLI records
    # /private/var/... in the slug, so the unresolved form finds nothing.
    real="$(cd "$SANDBOX" && pwd -P)"
    slug="$(printf '%s' "$real" | sed 's/[^a-zA-Z0-9]/-/g')"
    TRANSCRIPT="$(ls -S "$PROJECTS/$slug"/*.jsonl 2>/dev/null | head -n1 || true)"
    [ -n "$TRANSCRIPT" ] || { echo "profile-turns: no transcript for $real (slug $slug)" >&2; exit 3; }
  fi
  [ -f "$TRANSCRIPT" ] || { echo "profile-turns: no such transcript: $TRANSCRIPT" >&2; exit 2; }
  SUB="${TRANSCRIPT%.jsonl}/subagents"
  echo "turn inventory (free — from transcript)"
  echo "  $TRANSCRIPT"
  echo
  # ROUND-TRIPS ARE UNIQUE requestIds. One API request = one full context re-send,
  # which is the quantity that costs money. Counting `assistant` entries instead
  # reads ~2x high, because the transcript writes one entry per content block and
  # they all share a requestId — the same trap context-metrics.sh documents.
  # Tool calls are deduped by their own id for the same reason.
  #
  # NOTE ON `calls per round-trip`: this mode divides tool calls by API REQUESTS,
  # while the live mode below divides by tool RESULTS. Those denominators differ
  # whenever one response carries two tool_use blocks, so the two modes report
  # different ratios for the same run and neither is wrong. The live mode's
  # "pinned at 1.00" observation is a statement about its own denominator; here
  # a value above 1.00 simply means some responses batched their calls. Compare
  # ratios only within one mode, and optimise the raw call count either way.
  # The parentheses are load-bearing: `EXPR | length as $v | BODY` evaluates BODY
  # with `.` set to EXPR's OUTPUT, so an unparenthesised binding here silently
  # rebinds `.` to the array of requestIds and every later filter indexes strings.
  jq -rs '
    ([ .[] | select(.type=="assistant") | .requestId // .uuid ] | unique | length) as $reqs
    | . as $all
    | ($all | map(select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use"))
            | group_by(.id // "?") | map(.[0])) as $calls
    | ($all | map(select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="thinking"))) as $think
    | "round-trips (context re-sends): \($reqs)",
      "tool calls:                     \($calls|length)",
      "calls per round-trip:           \((((($calls|length) / ([$reqs,1]|max)) * 100) | round) / 100)",
      "thinking blocks:                \($think|length)"
  ' "$TRANSCRIPT"
  for _label in by-tool by-path by-bash; do
    case "$_label" in
      by-tool) echo; echo "  by tool:"; _prog='[ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ] | group_by(.id // "?") | map(.[0]) | group_by(.name) | map({t: .[0].name, n: length}) | sort_by(-.n)[] | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.t)"' ;;
      by-path) echo; echo "  most-touched paths (Read/Write/Edit):"; _prog='[ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ] | group_by(.id // "?") | map(.[0]) | map(select(.name=="Read" or .name=="Write" or .name=="Edit") | (.input.file_path // .input.path // "?")) | group_by(.) | map({p: .[0], n: length}) | sort_by(-.n) | .[:22][] | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.p)"' ;;
      by-bash) echo; echo "  Bash commands:"; _prog='[ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ] | group_by(.id // "?") | map(.[0]) | map(select(.name=="Bash") | (.input.command // "?" | split("\n")[0] | .[0:78])) | group_by(.) | map({c: .[0], n: length}) | sort_by(-.n) | .[:18][] | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.c)"' ;;
    esac
    jq -rs "$_prog" "$TRANSCRIPT" 2>/dev/null || true
  done
  # Sub-agents do their own tool work, and a main-session-only inventory reads as
  # if the workflow made far fewer calls than it did.
  if [ -d "$SUB" ]; then
    echo
    echo "  sub-agent sessions:"
    for f in "$SUB"/agent-*.jsonl; do
      [ -f "$f" ] || continue
      meta="${f%.jsonl}.meta.json"
      nm="$(jq -r '.name // .agentType // "agent"' "$meta" 2>/dev/null || basename "$f")"
      jq -rs --arg nm "$nm" '
        ([ .[] | select(.type=="assistant") | .requestId // .uuid ] | unique | length) as $reqs
        | ([ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ]
           | group_by(.id // "?") | map(.[0])) as $calls
        | "    \($nm): reqs=\($reqs) calls=\($calls|length)  " +
          ($calls | group_by(.name) | map("\(.[0].name)×\(length)") | join(" "))
      ' "$f" 2>/dev/null || true
    done
  fi
  echo
  echo "  (context totals for the same run: sh context-metrics.sh --transcript \"$TRANSCRIPT\" --table)"
  exit 0
fi

[ -n "$TASK" ] || { echo "usage: profile-turns.sh --sandbox <dir> | --transcript <f> | --task <name> [--arm workflow|baseline]" >&2; exit 2; }
echo "profile-turns: LIVE mode — this spends a full run. If the run already happened," >&2
echo "               use --sandbox <dir> or --transcript <file> instead (free)." >&2

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
  | [ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ] as $calls
  | [ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="thinking") ] as $think
  | "round-trips (context re-sends): \($results|length)",
    "tool calls:                     \($calls|length)",
    "calls per round-trip:           \((($calls|length) / ([$results|length,1]|max) * 100 | round) / 100)   <- pinned at 1.00 headless; optimise the call count, not this",
    "thinking blocks:                \($think|length)"
' "$stream"
echo
echo "  by tool:"
jq -rs '
  [ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use") ]
  | group_by(.name) | map({t: .[0].name, n: length}) | sort_by(-.n)[]
  | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.t)"
' "$stream"
echo
echo "  most-touched paths (Read/Write/Edit):"
jq -rs '
  [ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use")
    | select(.name=="Read" or .name=="Write" or .name=="Edit")
    | (.input.file_path // .input.path // "?") ]
  | group_by(.) | map({p: .[0], n: length}) | sort_by(-.n) | .[:22][]
  | "    \(.n | tostring | (" " * (4 - length)) + .)  \(.p)"
' "$stream"
echo
echo "  Bash commands:"
jq -rs '
  [ .[] | select(.type=="assistant") |  .message.content[]? | select(type=="object") | select(.type=="tool_use")
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
