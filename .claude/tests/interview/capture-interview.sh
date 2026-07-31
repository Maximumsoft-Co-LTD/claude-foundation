#!/usr/bin/env sh
# capture-interview.sh — turn a REAL interactive /dev interview into a replayable
# answer bank. Reads a session transcript off disk: no tokens, no live run.
#
#   sh capture-interview.sh --transcript <session.jsonl> [--out banks/<name>.json]
#   sh capture-interview.sh --session <uuid> [--project <slug>]
#   sh capture-interview.sh --list                     # sessions that hold an interview
#
# WHY THIS EXISTS. `/dev` Phase 1 asks the user questions via `AskUserQuestion`,
# and a headless `claude -p` cannot answer it. So every test prompt in this repo
# is written *"do not ask clarifying questions"* with the acceptance criteria
# handed over inline — which makes the interview a **no-op by construction**. The
# front half of a spec-driven workflow, the part that is supposed to surface
# requirements the user never stated, has never once been exercised by a test.
# The gate has the same problem from the other end: it is also an
# `AskUserQuestion`, and the benchmark passes `--yes` so it auto-approves.
#
# Both are answerable if the answers come from somewhere. A real interview
# already happened — many times — and every one of them is on disk.
#
# WHAT IT READS. For each `AskUserQuestion` tool call the transcript stores the
# questions it asked, and the paired `toolUseResult` stores what the human picked:
#
#   toolUseResult.answers  = { "<question text>": "<selected option label>", … }
#
# That map, plus the offered options, is the whole bank. `replay-hook.sh` feeds it
# back to a headless run.
#
# ONE CALL CAN HOLD FOUR QUESTIONS, so `call_seq` is recorded alongside `seq`: a
# test that wants to assert "the interview took three rounds" needs the call
# boundaries, and a flat question list has thrown them away.

set -u

PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
TRANSCRIPT=""; OUT=""; SESSION=""; PROJECT=""; LIST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --transcript) TRANSCRIPT="${2:-}"; shift ;;
    --session)    SESSION="${2:-}"; shift ;;
    --project)    PROJECT="${2:-}"; shift ;;
    --out)        OUT="${2:-}"; shift ;;
    --list)       LIST=1 ;;
    *) echo "capture-interview: unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done
command -v jq >/dev/null 2>&1 || { echo "capture-interview: jq required" >&2; exit 2; }

# A transcript "contains AskUserQuestion" far more often than it contains a CALL
# to it: `orchestrator.md` names the tool in prose, and every run that reads that
# file matches a naive grep. 776 transcripts match the string; a couple of dozen
# hold a real call. Match the tool_use shape, not the word.
has_calls() {
  [ "$(jq -r 'select(.type=="assistant") | .message.content[]? | select(type=="object")
              | select(.type=="tool_use" and .name=="AskUserQuestion") | .id' "$1" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]
}

if [ "$LIST" = "1" ]; then
  echo "sessions holding a real AskUserQuestion call (newest first):"
  # shellcheck disable=SC2044
  for f in $(ls -t "$PROJECTS"/*/*.jsonl 2>/dev/null); do
    has_calls "$f" || continue
    n="$(jq -r 'select(.type=="assistant") | .message.content[]? | select(type=="object")
                | select(.type=="tool_use" and .name=="AskUserQuestion") | .id' "$f" 2>/dev/null | wc -l | tr -d ' ')"
    printf '  %3s call(s)  %s\n' "$n" "$f"
  done
  exit 0
fi

if [ -z "$TRANSCRIPT" ] && [ -n "$SESSION" ]; then
  if [ -n "$PROJECT" ]; then
    TRANSCRIPT="$PROJECTS/$PROJECT/$SESSION.jsonl"
  else
    TRANSCRIPT="$(ls "$PROJECTS"/*/"$SESSION".jsonl 2>/dev/null | head -n1 || true)"
  fi
fi
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || {
  echo "usage: capture-interview.sh --transcript <session.jsonl> [--out <bank.json>]" >&2
  echo "       capture-interview.sh --list      # find one" >&2; exit 2; }

has_calls "$TRANSCRIPT" || {
  echo "capture-interview: no AskUserQuestion call in $(basename "$TRANSCRIPT") — nothing to capture" >&2
  exit 3; }

# Pair each call with its result. The result arrives on a LATER `user` entry whose
# content carries the same tool_use_id, and the structured payload sits on that
# entry's `toolUseResult`. Slurp once and index by id rather than re-scanning.
BANK="$(jq -s --arg src "$TRANSCRIPT" '
  # calls: id -> the questions array, in transcript order
  [ .[] | select(.type=="assistant") | .message.content[]? | select(type=="object")
        | select(.type=="tool_use" and .name=="AskUserQuestion")
        | {id: .id, questions: (.input.questions // [])} ] as $calls

  # results: id -> the answers map the human produced
  | ([ .[] | select(.type=="user" and .toolUseResult != null)
           | . as $e
           | ($e.message.content // []) | (if type=="array" then . else [] end)
           | map(select((type=="object") and .type=="tool_result"))
           | map({key: .tool_use_id, value: ($e.toolUseResult.answers // {})})
           | .[] ] | from_entries) as $answers

  | [ $calls | to_entries[]
      | .key as $ci | .value as $c
      | ($answers[$c.id] // {}) as $a
      | $c.questions | to_entries[]
      | .value as $q
      | {call_seq: ($ci + 1),
         header: ($q.header // ""),
         question: ($q.question // ""),
         multiSelect: ($q.multiSelect // false),
         options: [ $q.options[]? | .label ],
         # The recorded human choice. An unanswered call (the session ended
         # mid-question) yields null, and a null answer is kept rather than
         # dropped: "this question was asked and never answered" is itself a
         # fact a test may want, and silently omitting it would make the bank
         # look complete.
         answer: ($a[$q.question] // null)}
    ]
  | to_entries | map(.value + {seq: (.key + 1)})
  | {source: $src, exchanges: .,
     calls: (if length == 0 then 0 else (map(.call_seq) | max) end),
     questions: length,
     answered: (map(select(.answer != null)) | length)}
' "$TRANSCRIPT")"

if [ -z "$OUT" ]; then
  printf '%s\n' "$BANK" | jq .
else
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$BANK" | jq . > "$OUT"
  echo "captured → $OUT"
fi

printf '%s' "$BANK" | jq -r '
  "  \(.calls) call(s), \(.questions) question(s), \(.answered) answered",
  (.exchanges[] | "  [\(.call_seq).\(.seq)] \(.header): \(.question[0:70])\n        → \(.answer // "‹UNANSWERED›")")' >&2

# An unanswered question in the bank is a hole the replay will hit. Say so here,
# where the bank is being built, rather than at 3am inside a live run.
if [ "$(printf '%s' "$BANK" | jq -r '.questions - .answered')" != "0" ]; then
  echo "  ⚠ some questions carry no answer — replay will fall back or miss on those" >&2
fi
exit 0
