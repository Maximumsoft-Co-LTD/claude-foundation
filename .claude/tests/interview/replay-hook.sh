#!/usr/bin/env sh
# replay-hook.sh — PreToolUse hook that answers `AskUserQuestion` from a recorded
# bank, so a headless `/dev` run can be driven through its interview AND its gate.
#
# Register it in the sandbox's settings.json against matcher "AskUserQuestion"
# (run-replay.sh does this). Driven entirely by env:
#
#   CLAUDE_INTERVIEW_BANK   path to a bank from capture-interview.sh  (REQUIRED —
#                           without it this hook is INERT and allows the tool)
#   CLAUDE_INTERVIEW_LOG    JSONL appended one line per question answered. This is
#                           the test artifact: it records what the interview
#                           actually ASKED, which nothing could observe before.
#   CLAUDE_INTERVIEW_MISS   first | fail   (default: first)
#                           what to do when the bank has no answer for a question
#   CLAUDE_INTERVIEW_GATE   approve | reject | ""   (default: "")
#                           forces the answer to a GATE question regardless of the
#                           bank, which is how the gate's reject path becomes
#                           testable — `--yes` can only ever approve.
#
# ─── WHY A HOOK, AND WHAT THIS DOES NOT PROVE ───────────────────────────────
# `AskUserQuestion` needs an interactive UI; `claude -p` has none. A PreToolUse
# hook is the only channel that can put text where the model will read it in place
# of a tool result, using the same `{decision:"block", reason:…}` contract
# `dev-agent-guard.sh` already relies on.
#
# BE CLEAR ABOUT THE SEAM: the tool is **denied and its reason handed back**, not
# *answered*. The model reads the recorded answers as a blocked-tool explanation
# rather than as an AskUserQuestion result. So a replayed interview exercises:
#
#   ✓ whether the orchestrator asks at all, and WHAT it chooses to ask
#   ✓ how many rounds it takes
#   ✓ whether the spec it writes reflects the answers it was given
#   ✓ the gate — including REJECT, which `--yes` structurally cannot reach
#   ✗ the exact tool-result plumbing of a real AskUserQuestion turn
#
# That last line is the honest limit. It is a much smaller gap than "the interview
# is never exercised", which is where this started.
#
# ─── SAFETY ─────────────────────────────────────────────────────────────────
# With no CLAUDE_INTERVIEW_BANK set, the hook exits 0 immediately and the tool
# proceeds untouched. That matters because this file may end up registered in a
# settings.json someone later uses interactively: a replay hook that silently
# answered a real human's questions would be a genuinely bad failure. Inert by
# default, active only when a bank is named.

set -u

input="$(cat 2>/dev/null || true)"

# Inert unless a bank is named (see SAFETY above).
[ -n "${CLAUDE_INTERVIEW_BANK:-}" ] || exit 0
[ -f "$CLAUDE_INTERVIEW_BANK" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null || true)"
[ "$tool" = "AskUserQuestion" ] || exit 0

BANK="$CLAUDE_INTERVIEW_BANK"
LOG="${CLAUDE_INTERVIEW_LOG:-}"
MISS="${CLAUDE_INTERVIEW_MISS:-first}"
GATE="${CLAUDE_INTERVIEW_GATE:-}"

jq -e . "$BANK" >/dev/null 2>&1 || exit 0

# Which bank entries are already spent. Without this, one recorded answer would
# answer every later question that shares its header — an interview asking
# "Scope" three times would get the same reply three times and the test would
# read as a pass. Consumption is tracked in the log, so the log is also the
# state; a run with no log gets no consumption tracking and says so below.
used=""
if [ -n "$LOG" ] && [ -f "$LOG" ]; then
  used="$(jq -rs 'map(select(type=="object") | .bank_seq // empty) | join(" ")' "$LOG" 2>/dev/null || true)"
fi

# One jq pass does the whole match ladder and emits, per asked question, a line of
# `answer<TAB>matched<TAB>bank_seq<TAB>question`. Shell then formats the reason
# and appends the log — keeping the matching logic in one place where it can be
# tested against fixtures with no live run.
#
# THE LADDER, most trustworthy first:
#   exact   — same question text as recorded. The only certain match.
#   header  — same header (interview headers are short and stable: "Scope",
#             "Auth method"). Question wording is regenerated every run, so this
#             is the workhorse.
#   option  — a recorded answer that appears verbatim among THIS question's
#             offered options. Catches a reworded question with a stable choice set.
#   first   — fallback: the first offered option. Deterministic, and logged as a
#             fallback so a test can refuse to trust a run that needed one.
#   miss    — no answer produced (MISS=fail). The run is told so explicitly.
MATCH_PROG='
  ($bank[0].exchanges // []) as $ex
  | ($used | split(" ") | map(select(. != "") | tonumber)) as $spent
  | def avail: [ $ex | to_entries[] | select((.value.answer != null) and (([.value.seq] | inside($spent)) | not)) ];
    # A gate question is recognised by what it asks about, because the header text
    # is not fixed across runs. Kept deliberately narrow: matching too eagerly
    # would hijack an ordinary design question and silently approve a run.
    def is_gate($q; $h):
      (($h + " " + $q) | ascii_downcase) as $t
      | ($t | test("gate|approve|proceed with (the )?(plan|implementation)|ready to (build|implement)"));
    [ (.tool_input.questions // [])[]
      | . as $q
      | ($q.question // "") as $qt
      | ($q.header // "") as $qh
      | [ $q.options[]? | .label ] as $opts
      | (if ($gate != "" and is_gate($qt; $qh)) then
           # Forced gate answer. Prefer an offered option whose label looks like
           # the requested verdict so the model gets something it actually offered.
           ( [ $opts[] | select(ascii_downcase | test(if $gate == "reject" then "reject|no|revise|change|stop" else "approve|yes|proceed|go|continue|ship" end)) ] ) as $cand
           | {answer: ($cand[0] // $gate), matched: ("gate-forced-" + $gate), bank_seq: 0}
         else
           ( avail | map(select(.value.question == $qt)) | .[0] ) as $mExact
           | ( avail | map(select(((.value.header // "") != "")
                                  and (((.value.header // "") | ascii_downcase) == ($qh | ascii_downcase)))) | .[0] ) as $mHeader
           | ( avail | map(select([.value.answer] | inside($opts))) | .[0] ) as $mOption
           | ( $mExact // $mHeader // $mOption ) as $m
           | if $m != null then
               {answer: $m.value.answer,
                matched: (if $mExact != null then "exact" elif $mHeader != null then "header" else "option" end),
                bank_seq: $m.value.seq,
                # An answer the current question never offered is still passed
                # through (the real tool allows free-text "Other"), but it is
                # flagged: a bank drifting away from the options is a bank going
                # stale, and that should be visible rather than inferred.
                offlist: (([$m.value.answer] | inside($opts)) | not)}
             elif $miss == "fail" then {answer: null, matched: "miss", bank_seq: 0}
             else {answer: ($opts[0] // "‹no options offered›"), matched: "fallback-first", bank_seq: 0}
             end
         end) as $r
      | [ ($r.answer // ""), $r.matched, ($r.bank_seq | tostring), ($r.offlist // false | tostring), $qh, $qt ]
      | @tsv ]
  | .[]
'
# Piped, never a heredoc: an unquoted heredoc expands `$` and backticks, and the
# payload is arbitrary JSON that can contain both.
MATCHED="$(printf '%s' "$input" | jq -r --slurpfile bank "$BANK" --arg used "$used" \
  --arg miss "$MISS" --arg gate "$GATE" "$MATCH_PROG")"

[ -n "$MATCHED" ] || exit 0

# Append the log BEFORE emitting, so a run that dies right after still leaves the
# record of what it asked. The log is the artifact the tests read.
if [ -n "$LOG" ]; then
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  printf '%s\n' "$MATCHED" | while IFS="$(printf '\t')" read -r a m bs ol qh qt; do
    jq -cn --arg a "$a" --arg m "$m" --argjson bs "${bs:-0}" --arg ol "$ol" \
           --arg qh "$qh" --arg qt "$qt" \
      '{header:$qh, question:$qt, answer:$a, matched:$m,
        bank_seq:(if $bs == 0 then null else $bs end),
        offlist:($ol == "true")}' >> "$LOG"
  done
fi

# MISS=fail: tell the run plainly instead of inventing an answer. A test asserting
# "the bank covered every question" reads this path.
if printf '%s' "$MATCHED" | cut -f2 | grep -qx miss; then
  unanswered="$(printf '%s' "$MATCHED" | awk -F'\t' '$2=="miss" {printf "%s\"%s\"", sep, $6; sep="; "}')"
  jq -n --arg q "$unanswered" '{decision:"block", reason:
    ("INTERVIEW REPLAY MISS — the recorded answer bank has no answer for: \($q). "
     + "This is a harness gap, not a workflow error: the interview asked something the bank does not cover. "
     + "Record it with capture-interview.sh, or set CLAUDE_INTERVIEW_MISS=first to fall back to the first offered option.")}'
  exit 0
fi

# Mimic the real tool-result wording so the model reads it the way it reads a
# genuine answer. The live format is:
#   Your questions have been answered: "<q>"="<a>" … You can now continue with
#   these answers in mind.
PAIRS="$(printf '%s' "$MATCHED" | awk -F'\t' '{printf "%s\"%s\"=\"%s\"", sep, $6, $1; sep="; "}')"
jq -n --arg p "$PAIRS" '{decision:"block", reason:
  ("Your questions have been answered: \($p). You can now continue with these answers in mind.")}'
exit 0
