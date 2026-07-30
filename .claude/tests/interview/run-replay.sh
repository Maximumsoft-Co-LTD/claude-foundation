#!/usr/bin/env sh
# run-replay.sh — drive a headless `/dev` run through its REAL interview and its
# REAL gate, answering both from a recorded bank.
#
#   sh run-replay.sh                                  # dry-run: print the plan
#   sh run-replay.sh --run                            # live
#   sh run-replay.sh --run --gate reject              # test the gate's reject path
#   sh run-replay.sh --run --prompt prompts/02-vague-search.txt --bank banks/x.json
#   sh run-replay.sh --run --miss fail --keep
#
# WHAT THIS IS FOR. Every other live test in this repo writes its prompt as
# *"do not ask clarifying questions — assume …"* with the acceptance criteria
# handed over inline, because `AskUserQuestion` cannot be answered headlessly.
# That makes the interview a no-op and the gate a rubber stamp (`--yes`), so the
# two mechanisms that distinguish a spec-driven workflow from vibe-coding have
# never been under test. This runner inverts that:
#
#   - the prompt is DELIBERATELY under-specified, and carries NO acceptance
#     criteria, so the orchestrator has to ask;
#   - `replay-hook.sh` answers from a bank captured off a real interactive run;
#   - `--yes` is NOT passed, so the gate is a real gate — and `--gate reject`
#     exercises the rejection path, which `--yes` structurally cannot reach.
#
# WHAT IT PROVES, and the seam it does not close: the hook DENIES the tool and
# hands the recorded answers back as the denial reason, so the model reads them as
# a blocked-tool explanation rather than as a genuine AskUserQuestion result. The
# question generation, the round count, the spec-vs-answers fit and the gate
# decision are all real; the tool-result plumbing of one turn is not. See the
# header of replay-hook.sh.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LINTER="$ROOT/.claude/hooks/artifact-lint.sh"
HOOK="$HERE/replay-hook.sh"

MODE="dry"; PROMPT=""; BANK=""; GATE=""; MISS="first"; KEEP=0
MODEL="${BENCH_MODEL:-sonnet}"; TIMEOUT_S="${REPLAY_TIMEOUT:-1800}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --prompt) PROMPT="${2:-}"; shift ;;
    --bank)   BANK="${2:-}"; shift ;;
    --gate)   GATE="${2:-}"; shift ;;
    --miss)   MISS="${2:-}"; shift ;;
    --keep)   KEEP=1 ;;
    *) echo "run-replay: unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done
PROMPT="${PROMPT:-$HERE/prompts/01-vague-feature.txt}"
BANK="${BANK:-$HERE/banks/01-vague-feature.json}"

[ -f "$PROMPT" ] || { echo "run-replay: no prompt at $PROMPT" >&2; exit 2; }
[ -f "$BANK" ]   || { echo "run-replay: no bank at $BANK — build one with capture-interview.sh" >&2; exit 2; }
case "${GATE:-}" in ''|approve|reject) ;; *) echo "run-replay: --gate must be approve|reject" >&2; exit 2 ;; esac

if [ "$MODE" = "dry" ]; then
  echo "interview replay plan"
  echo "  prompt : $PROMPT"
  printf '  intent : '; head -c 140 "$PROMPT"; echo
  echo "  bank   : $BANK  ($(jq -r '"\(.calls) call(s), \(.answered)/\(.questions) answered"' "$BANK" 2>/dev/null || echo '?'))"
  echo "  gate   : ${GATE:-from the bank (not forced)}"
  echo "  miss   : $MISS"
  echo
  echo "  It will:"
  echo "    1. build a sandbox with the /dev machinery (no bench, no answer keys)"
  echo "    2. register replay-hook.sh as a PreToolUse hook on AskUserQuestion"
  echo "    3. run \`/dev\` WITHOUT --yes, so the gate is a real gate"
  echo "    4. assert: the interview fired · every question was answered from the bank ·"
  echo "       artifact-lint clean · spec.md reflects the recorded answers · the gate"
  echo "       decision was honoured"
  echo
  echo "  Bank answers that spec.md will be checked against:"
  jq -r '.exchanges[] | "    - [\(.header)] \(.answer // "‹unanswered›")"' "$BANK" 2>/dev/null || true
  echo
  echo "interview replay (dry-run). Re-run with --run (needs the claude CLI; costs tokens)."
  echo "The matcher itself is already proven with no tokens: sh run-interview-tests.sh"
  exit 0
fi

command -v claude >/dev/null 2>&1 || { echo "run-replay: SKIP — no \`claude\` CLI on PATH." >&2; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "run-replay: jq required" >&2; exit 2; }

SAND="$(mktemp -d)"
cleanup() { [ "$KEEP" = "1" ] && echo "sandbox kept: $SAND" || rm -rf "$SAND"; }
# A trap that does not exit SWALLOWS the signal and the script carries on against
# a deleted sandbox — the runaway-runner shape documented in bench/README.md.
on_signal() { cleanup; trap - EXIT; exit 130; }
trap cleanup EXIT
trap on_signal INT TERM

sb="$SAND/run"; mkdir -p "$sb/.workflow"
cp -R "$ROOT/.claude" "$sb/.claude"
# Never ship the test tree into the sandbox: `.claude/tests/bench/tasks/*/
# acceptance.txt` is an answer key, and `.claude/tests/interview/banks/` would
# hand the run the very answers it is supposed to have to ask for.
rm -rf "$sb/.claude/tests"
[ -f "$ROOT/WORKFLOW.md" ] && cp "$ROOT/WORKFLOW.md" "$sb/"
[ -f "$ROOT/CLAUDE.md" ]   && cp "$ROOT/CLAUDE.md"   "$sb/"
cp -R "$ROOT/.workflow/_templates" "$sb/.workflow/_templates"
if [ -f "$ROOT/.workflow/INDEX.md" ]; then cp "$ROOT/.workflow/INDEX.md" "$sb/.workflow/INDEX.md"
else printf '# Index\n\n| ID | Type | Title | Status | Created | Updated |\n|----|------|-------|--------|---------|---------|\n' > "$sb/.workflow/INDEX.md"; fi
printf '# sandbox\n' > "$sb/README.md"
( cd "$sb" && git init -q && git add -A && git -c user.email=r@replay -c user.name=replay commit -qm base >/dev/null 2>&1 )

# Register the hook. The command is an ABSOLUTE path into the repo, deliberately:
# the sandbox's own `.claude/tests` is deleted above, so a relative copy would not
# survive. Merged into the existing settings so the /dev guards stay in force —
# an interview replay that silently disabled dev-agent-guard.sh would be testing
# a workflow nobody ships.
SETTINGS="$sb/.claude/settings.json"
[ -f "$SETTINGS" ] || printf '{}' > "$SETTINGS"
jq --arg cmd "$HOOK" '
  .hooks //= {} | .hooks.PreToolUse //= []
  | .hooks.PreToolUse += [{matcher: "AskUserQuestion",
                           hooks: [{type: "command", command: $cmd, timeout: 10}]}]
' "$SETTINGS" > "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS"

LOG="$SAND/interview.jsonl"; : > "$LOG"
export CLAUDE_INTERVIEW_BANK="$BANK"
export CLAUDE_INTERVIEW_LOG="$LOG"
export CLAUDE_INTERVIEW_MISS="$MISS"
export CLAUDE_INTERVIEW_GATE="$GATE"

echo "sandbox: $sb"
echo "bank:    $BANK"
echo "gate:    ${GATE:-from bank}"
echo "running /dev headless (no --yes; ≤${TIMEOUT_S}s)…"

# Same portable watchdog as run-bench.sh: no `timeout` binary here, and a run that
# stalls must not hang the suite.
( cd "$sb" && claude -p "$(cat "$PROMPT")" --output-format json \
    --dangerously-skip-permissions --model "$MODEL" ) > "$SAND/envelope.json" 2>"$SAND/run.err" &
cpid=$!
( sleep "$TIMEOUT_S"; : > "$SAND/timeout"; kill -TERM "$cpid" 2>/dev/null; sleep 3; kill -KILL "$cpid" 2>/dev/null ) &
wpid=$!
wait "$cpid" 2>/dev/null; rc=$?
kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null

echo
if [ -f "$SAND/timeout" ]; then
  echo "✗ watchdog fired at ${TIMEOUT_S}s — nothing below grades the workflow" >&2
fi

# ─── assertions ────────────────────────────────────────────────────────────────
fails=0
say_ok()   { echo "   ✓ $1"; }
say_bad()  { echo "   ✗ $1" >&2; fails=$((fails + 1)); }

# 1. THE HEADLINE: did the interview happen at all? Before this runner existed
#    there was no way to answer that question about a headless run.
asked="$(jq -rs 'length' "$LOG" 2>/dev/null || echo 0)"
if [ "${asked:-0}" -gt 0 ]; then say_ok "the interview FIRED — $asked question(s) asked"
else say_bad "the interview never asked anything (log empty) — the run went straight past Phase 1"; fi

if [ "${asked:-0}" -gt 0 ]; then
  echo
  echo "   what it asked, and where each answer came from:"
  jq -r '"     [\(.matched)] \(.header): \(.question[0:64])\n           → \(.answer)"' "$LOG"
  echo

  # 2. Coverage of the bank. A run answered mostly by `fallback-first` was not
  #    really replayed — it was given the first option each time, which is a
  #    different (and much weaker) test. Name it rather than let it pass quietly.
  fb="$(jq -rs '[.[] | select(.matched == "fallback-first" or .matched == "miss")] | length' "$LOG")"
  if [ "$fb" = "0" ]; then say_ok "every question was answered from the bank (no fallbacks)"
  else say_bad "$fb question(s) fell back or missed — the bank does not cover this interview; re-capture it"; fi

  off="$(jq -rs '[.[] | select(.offlist)] | length' "$LOG")"
  [ "$off" = "0" ] || echo "   ~ $off recorded answer(s) were not among the offered options (bank drifting from the option sets)"
fi

# 3. The run produced a valid artifact set.
rd="$(find "$sb/.workflow" -mindepth 1 -maxdepth 1 -type d ! -name _templates 2>/dev/null | head -n1)"
if [ -n "$rd" ] && [ -d "$rd" ]; then
  say_ok "run dir created: $(basename "$rd")"
  if sh "$LINTER" "$rd" >/dev/null 2>&1; then say_ok "artifact-lint clean"
  else say_bad "artifact-lint failed on $(basename "$rd")"; fi
else
  say_bad "no run dir under .workflow/ — Phase 1 produced nothing"
fi

# 4. THE OTHER PRIZE: does the spec reflect what the user actually said? A
#    replayed interview is only worth running if the answers reach the artifact.
#    Substring presence is a floor, not proof of comprehension — but a spec that
#    does not contain the chosen option anywhere has clearly not used it.
spec=""
[ -n "${rd:-}" ] && { [ -f "$rd/spec.md" ] && spec="$rd/spec.md" || { [ -f "$rd/run.md" ] && spec="$rd/run.md"; }; }
if [ -n "$spec" ]; then
  miss_n=0; tot_n=0
  # Compare against what the hook actually ANSWERED, not the whole bank: a
  # question the interview never asked cannot be expected in the spec.
  while IFS= read -r ans; do
    [ -n "$ans" ] || continue
    tot_n=$((tot_n + 1))
    # Match on the answer's first few significant words — an option label is
    # often a phrase the spec paraphrases rather than quotes verbatim.
    key="$(printf '%s' "$ans" | tr -d '"' | awk '{print $1" "$2}' | sed 's/[[:space:]]*$//')"
    if [ -n "$key" ] && grep -qiF -- "$key" "$spec" 2>/dev/null; then :; else
      miss_n=$((miss_n + 1)); echo "   ~ spec.md does not mention: $ans"
    fi
  done <<EOF
$(jq -rs '[.[] | select(.matched != "miss") | .answer] | unique | .[]' "$LOG" 2>/dev/null)
EOF
  if [ "$tot_n" -gt 0 ] && [ "$miss_n" = "0" ]; then
    say_ok "spec reflects all $tot_n answered choice(s)"
  elif [ "$tot_n" -gt 0 ]; then
    say_bad "$miss_n/$tot_n interview answers do not appear in the spec"
  fi
fi

# 5. The gate. `--yes` can only ever approve, so the reject path has never been
#    exercised. `next_step` past the gate on a rejected run is a real defect.
if [ -n "${rd:-}" ] && [ -f "$rd/state.json" ]; then
  nstep="$(jq -r '.next_step // ""' "$rd/state.json" 2>/dev/null || true)"
  step="$(jq -r '.step // ""' "$rd/state.json" 2>/dev/null || true)"
  echo "   state: step=$step next_step=$nstep"
  case "$GATE" in
    reject)
      # A rejected gate must not have proceeded to build. Anything at or past
      # implement means the rejection was ignored.
      case "$nstep$step" in
        *implement*|*test*|*review*|*ship*)
          say_bad "the gate was REJECTED but the run moved to '$step'/'$nstep' — rejection ignored" ;;
        *) say_ok "gate rejection honoured (run halted before implement)" ;;
      esac ;;
    approve)
      case "$nstep$step" in
        *implement*|*test*|*review*|*ship*|*docs*|*retro*|*close*) say_ok "gate approval carried the run into Phase 2" ;;
        *) say_bad "the gate was APPROVED but the run stopped at '$step'/'$nstep'" ;;
      esac ;;
  esac
fi

echo
cost="$(jq -r '.total_cost_usd // "?"' "$SAND/envelope.json" 2>/dev/null || echo '?')"
echo "cost: \$$cost   exit: $rc"
# Context comes free off the transcript the CLI just wrote.
if [ -x "$ROOT/.claude/tests/bench/context-metrics.sh" ]; then
  sh "$ROOT/.claude/tests/bench/context-metrics.sh" "$sb" --table 2>/dev/null | sed 's/^/  /' || true
fi
echo
if [ "$KEEP" = "1" ]; then echo "interview log: $LOG"; fi
if [ "$fails" = "0" ]; then echo "interview replay: PASS"; exit 0
else echo "interview replay: $fails check(s) FAILED" >&2; exit 1; fi
