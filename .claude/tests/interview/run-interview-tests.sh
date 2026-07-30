#!/usr/bin/env sh
# run-interview-tests.sh — deterministic self-test of the interview replay
# machinery. No live runs, no tokens.
#
# WHY IT MATTERS THAT THIS IS FREE. The thing being tested is the mechanism that
# makes a paid test possible: if the matcher silently answers the wrong question,
# a replayed run still finishes and still writes a plausible spec, and the whole
# exercise reports a pass while proving nothing. So the matcher gets pinned here,
# against canned payloads, before anyone spends a run on it.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/fixtures"
CAP="$HERE/capture-interview.sh"
HOOK="$HERE/replay-hook.sh"
RUNNER="$HERE/run-replay.sh"

. "$HERE/../lib/assert.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq required for interview tests" >&2; exit 1; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT INT TERM

echo "Running interview replay self-test..."
echo

# ═══════════════════════════════════════════════════════════════════════════
# CAPTURE — a real interview off a transcript
# ═══════════════════════════════════════════════════════════════════════════
T="$FIX/transcript-interview.jsonl"
assert_file_exists "capture: transcript fixture present" "$T"
bank="$(sh "$CAP" --transcript "$T" 2>/dev/null)"

assert_eq "capture: counts AskUserQuestion CALLS"      "3" "$(printf '%s' "$bank" | jq -r '.calls')"
assert_eq "capture: counts individual QUESTIONS"       "4" "$(printf '%s' "$bank" | jq -r '.questions')"
assert_eq "capture: counts the answered ones"          "3" "$(printf '%s' "$bank" | jq -r '.answered')"

# One call can hold up to four questions. Losing the call boundary would make
# "the interview took three rounds" unmeasurable, so call_seq is kept per question.
assert_eq "capture: two questions share call 1" "1 1" \
  "$(printf '%s' "$bank" | jq -r '[.exchanges[0].call_seq, .exchanges[1].call_seq] | join(" ")')"
assert_eq "capture: the third question is call 2" "2" \
  "$(printf '%s' "$bank" | jq -r '.exchanges[2].call_seq')"

assert_eq "capture: reads the human's choice" "Completed only" \
  "$(printf '%s' "$bank" | jq -r '.exchanges[0].answer')"
assert_eq "capture: keeps the offered options" "Completed only,Every edit" \
  "$(printf '%s' "$bank" | jq -r '.exchanges[0].options | join(",")')"
assert_eq "capture: keeps the header" "Retention" \
  "$(printf '%s' "$bank" | jq -r '.exchanges[1].header')"

# An asked-but-unanswered question is KEPT with a null answer. Dropping it would
# make a partial bank look complete, and the replay would then fall back on a
# question the bank appeared to cover.
assert_eq "capture: an unanswered question is kept, not dropped" "null" \
  "$(printf '%s' "$bank" | jq -r '.exchanges[3].answer')"
assert_eq "capture: 4 exchanges recorded despite 1 being unanswered" "4" \
  "$(printf '%s' "$bank" | jq -r '.exchanges | length')"

# A transcript with no real call must say so rather than emit an empty bank that
# would replay as "the interview asked nothing".
printf '{"type":"assistant","requestId":"r","message":{"content":[{"type":"text","text":"AskUserQuestion is mentioned here"}]}}\n' > "$TMPROOT/nocall.jsonl"
if sh "$CAP" --transcript "$TMPROOT/nocall.jsonl" >/dev/null 2>&1; then
  fail "capture: accepted a transcript that only MENTIONS AskUserQuestion"
else pass "capture: rejects a transcript with no real call (prose mention is not a call)"; fi

# ═══════════════════════════════════════════════════════════════════════════
# THE HOOK — safety first
# ═══════════════════════════════════════════════════════════════════════════
# This file can end up registered in a settings.json someone later uses
# interactively. A replay hook that answered a real human's questions would be a
# genuinely bad failure, so it must be inert unless a bank is explicitly named.
out="$(sh "$HOOK" < "$FIX/ask-exact.json" 2>/dev/null || true)"
assert_eq "hook: INERT with no bank set (real sessions unaffected)" "" "$out"

out="$(CLAUDE_INTERVIEW_BANK="$TMPROOT/does-not-exist.json" sh "$HOOK" < "$FIX/ask-exact.json" 2>/dev/null || true)"
assert_eq "hook: inert when the named bank is missing" "" "$out"

printf 'not json at all' > "$TMPROOT/bad.json"
out="$(CLAUDE_INTERVIEW_BANK="$TMPROOT/bad.json" sh "$HOOK" < "$FIX/ask-exact.json" 2>/dev/null || true)"
assert_eq "hook: inert when the bank is unparseable" "" "$out"

printf '{"tool_name":"Bash","tool_input":{"command":"ls"}}' > "$TMPROOT/other.json"
out="$(CLAUDE_INTERVIEW_BANK="$FIX/bank-basic.json" sh "$HOOK" < "$TMPROOT/other.json" 2>/dev/null || true)"
assert_eq "hook: ignores every tool but AskUserQuestion" "" "$out"

# ═══════════════════════════════════════════════════════════════════════════
# THE HOOK — the match ladder
# ═══════════════════════════════════════════════════════════════════════════
B="$FIX/bank-basic.json"
ask() { CLAUDE_INTERVIEW_BANK="$B" ${2:+env $2} sh "$HOOK" < "$FIX/$1" 2>/dev/null | jq -r '.reason // ""'; }

# The contract with the model: the reason must read like a real answer. The live
# tool says: Your questions have been answered: "<q>"="<a>" … You can now continue
# with these answers in mind.
r="$(ask ask-exact.json)"
assert_contains "hook: exact-text match answers the question" "$r" '"How much should this cover?"="Reader and writer"'
assert_contains "hook: reason mimics the real tool wording" "$r" "Your questions have been answered:"
assert_contains "hook: reason closes like the real tool" "$r" "You can now continue with these answers in mind."

# Interview wording is regenerated every run, so the header is the workhorse rung.
r="$(ask ask-header.json)"
assert_contains "hook: header match survives a reworded question" "$r" '"Reader and writer"'

# A reworded question with a stable option set still resolves.
r="$(ask ask-option.json)"
assert_contains "hook: option-label match resolves an unrecognised question" "$r" '"IndexedDB"'

# Fallback is deterministic (first offered option) so a replay never wedges…
r="$(ask ask-unknown.json)"
assert_contains "hook: falls back to the first option by default" "$r" '"ap-southeast-1"'

# …but MISS=fail exists because a run answered by fallbacks is not a replay, and a
# suite that wants to prove bank coverage must be able to make that loud.
r="$(CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_MISS=fail sh "$HOOK" < "$FIX/ask-unknown.json" | jq -r '.reason')"
assert_contains "hook: MISS=fail reports the gap instead of inventing an answer" "$r" "INTERVIEW REPLAY MISS"
assert_contains "hook: the miss names the unanswered question" "$r" '"Which region?"'

# ═══════════════════════════════════════════════════════════════════════════
# THE HOOK — the gate, which `--yes` structurally cannot test
# ═══════════════════════════════════════════════════════════════════════════
r="$(CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_GATE=approve sh "$HOOK" < "$FIX/ask-gate.json" | jq -r '.reason')"
assert_contains "gate: approve picks the approving option" "$r" '"Approve — build it"'

# THE unlock. `/dev --yes` auto-approves a no-deviation gate, so no test has ever
# taken the rejection branch. Forcing it here is what makes that branch reachable.
r="$(CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_GATE=reject sh "$HOOK" < "$FIX/ask-gate.json" | jq -r '.reason')"
assert_contains "gate: reject picks the rejecting option (unreachable via --yes)" "$r" '"Reject — revise the plan"'

# Gate detection is deliberately narrow. Matching too eagerly would let
# `--gate approve` silently answer an ordinary design question with "approve",
# which is worse than not forcing at all.
r="$(CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_GATE=reject sh "$HOOK" < "$FIX/ask-exact.json" | jq -r '.reason')"
assert_contains "gate: forcing does NOT hijack an ordinary design question" "$r" '"Reader and writer"'
if printf '%s' "$r" | grep -qi "reject"; then
  fail "gate: a design question was answered with the gate verdict"
else pass "gate: the design question kept its own recorded answer"; fi

# ═══════════════════════════════════════════════════════════════════════════
# THE HOOK — one answer is spent once
# ═══════════════════════════════════════════════════════════════════════════
# Without consumption tracking, one recorded answer answers every later question
# sharing its header: an interview asking "Scope" three times gets the same reply
# three times and the test reads as a pass on a bank that covered one third of it.
LOG="$TMPROOT/consume.jsonl"; : > "$LOG"
CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_LOG="$LOG" sh "$HOOK" < "$FIX/ask-header.json" >/dev/null
CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_LOG="$LOG" sh "$HOOK" < "$FIX/ask-header.json" >/dev/null
assert_eq "consumption: two asks produce two log lines" "2" "$(jq -rs 'length' "$LOG")"
assert_eq "consumption: the first ask matched by header" "header" "$(jq -rs '.[0].matched' "$LOG")"
assert_eq "consumption: the first ask spent bank entry 1" "1" "$(jq -rs '.[0].bank_seq' "$LOG")"
assert_eq "consumption: the repeat did NOT reuse entry 1" "fallback-first" "$(jq -rs '.[1].matched' "$LOG")"
assert_eq "consumption: the repeat records no bank entry" "null" "$(jq -rs '.[1].bank_seq' "$LOG")"

# The log is the artifact that finally makes "what did the interview ask?"
# answerable for a headless run, so its shape is part of the contract.
if jq -e 'has("header") and has("question") and has("answer") and has("matched") and has("offlist")' "$LOG" >/dev/null 2>&1; then
  pass "log: every line carries header/question/answer/matched/offlist"
else fail "log: a line is missing a contract field — the replay assertions read these"; fi

# A single call carrying several questions must log one line each; the interview
# routinely batches up to four.
LOG2="$TMPROOT/multi.jsonl"; : > "$LOG2"
CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_LOG="$LOG2" sh "$HOOK" < "$FIX/ask-multi.json" >/dev/null
assert_eq "log: a 2-question call logs 2 lines" "2" "$(jq -rs 'length' "$LOG2")"
r="$(CLAUDE_INTERVIEW_BANK="$B" sh "$HOOK" < "$FIX/ask-multi.json" | jq -r '.reason')"
assert_contains "hook: a batched call answers both questions" "$r" '"Reader and writer"'
assert_contains "hook: …including the second one" "$r" '"IndexedDB"'

# An answer that the current question never offered is passed through (the real
# tool allows free-text "Other") but flagged, because a bank drifting away from
# the option sets is going stale and that should be visible.
LOG3="$TMPROOT/offlist.jsonl"; : > "$LOG3"
CLAUDE_INTERVIEW_BANK="$B" CLAUDE_INTERVIEW_LOG="$LOG3" sh "$HOOK" < "$FIX/ask-offlist.json" >/dev/null
assert_eq "log: an answer outside the offered options is flagged" "true" "$(jq -rs '.[0].offlist' "$LOG3")"

# ═══════════════════════════════════════════════════════════════════════════
# THE RUNNER — and the prompts that must stay under-specified
# ═══════════════════════════════════════════════════════════════════════════
if sh "$RUNNER" >/dev/null 2>&1; then pass "runner: dry-run succeeds"
else fail "runner: dry-run failed"; fi
out="$(sh "$RUNNER" 2>&1 || true)"
assert_contains "runner: dry-run lists the answers the spec will be checked for" "$out" "Bank answers that spec.md will be checked against"

# THE POINT OF THE WHOLE EXERCISE, guarded structurally. `--yes` auto-approves a
# no-deviation gate; passing it here would turn the gate back into a rubber stamp
# and quietly delete the only test of the rejection path.
# Check the two places `--yes` could actually reach the run: the `claude`
# invocation, and the prompt text itself. A plain file-wide grep is wrong here —
# the runner DISCUSSES --yes at length explaining why it is absent, and its own
# rationale would fail the test.
if command grep -n "claude -p" "$RUNNER" | command grep -qF -- "--yes"; then
  fail "runner: passes --yes to claude — that re-disables the gate this runner exists to test"
else pass "runner: the claude invocation carries no --yes, so the gate stays a real gate"; fi
_yp=0
for p in "$HERE"/prompts/*.txt; do
  [ -f "$p" ] || continue
  command grep -qF -- "--yes" "$p" && { _yp=1; echo "   ($(basename "$p") contains --yes)"; }
done
[ "$_yp" = "0" ] && pass "runner: no replay prompt smuggles --yes into the intent" \
                 || fail "runner: a replay prompt contains --yes — the gate auto-approves"
assert_file_contains "runner: registers the hook on AskUserQuestion" "$RUNNER" 'matcher: "AskUserQuestion"'
assert_file_contains "runner: keeps the shipped /dev guards in force" "$RUNNER" '.hooks.PreToolUse +='
# The sandbox must not contain the banks: handing the run its own answers would
# let it skip the asking entirely — the same answer-key leak class the bench hit.
assert_file_contains "runner: strips the test tree (banks + answer keys) from the sandbox" "$RUNNER" 'rm -rf "$sb/.claude/tests"'

# The replay prompts must stay vague. The failure mode this guards is real and
# tempting: a flaky replay gets "fixed" by adding the answers to the prompt, and
# the interview silently becomes a no-op again — exactly the state e2e is in.
for p in "$HERE"/prompts/*.txt; do
  [ -f "$p" ] || continue
  nm="$(basename "$p")"
  if command grep -qiE "do not ask|don't ask|assume:|acceptance:|\(AC[0-9]" "$p"; then
    fail "prompt $nm suppresses the interview or hands over the ACs — it cannot test an interview"
  else pass "prompt $nm stays under-specified (nothing suppresses the interview)"; fi
done

# A bank must actually carry answers, or a replay against it is all fallbacks.
for b in "$HERE"/banks/*.json; do
  [ -f "$b" ] || continue
  nm="$(basename "$b")"
  if jq -e . "$b" >/dev/null 2>&1; then pass "bank $nm is valid JSON"
  else fail "bank $nm is not valid JSON"; fi
  n_ans="$(jq -r '[.exchanges[] | select(.answer != null)] | length' "$b" 2>/dev/null || echo 0)"
  if [ "${n_ans:-0}" -gt 0 ]; then pass "bank $nm carries $n_ans answer(s)"
  else fail "bank $nm has no answers — every question would fall back"; fi
done

finish "interview replay tests"
