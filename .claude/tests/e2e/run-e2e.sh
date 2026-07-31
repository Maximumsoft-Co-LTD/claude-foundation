#!/usr/bin/env sh
# run-e2e.sh — end-to-end smoke of the live /dev pipeline (Layer 2 + judge).
#
# For each prompt in prompts/, it stands up a throwaway sandbox repo with the
# workflow machinery, runs `/dev` there via the `claude` CLI, then validates the
# produced .workflow/<id>/ with the SAME deterministic checks the fixtures use
# (artifact-lint + axis conformance) and grades quality with judge/judge.sh.
#
# NON-DETERMINISTIC + COSTS TOKENS. Defaults to --dry-run (prints the plan, runs
# nothing) so it is safe in CI. Go live with `--run` (or CLAUDE_E2E=1).
#
#   sh run-e2e.sh                    # dry-run: list scenarios + plan, exit 0
#   sh run-e2e.sh --run              # live: needs the `claude` CLI (+ jq)
#   sh run-e2e.sh --run --only 03-chore-xs   # just one scenario
#   CLAUDE_E2E=1 sh run-e2e.sh       # live (env switch, used by run-all.sh)
#   sh run-e2e.sh --run --keep       # live, keep sandboxes for inspection
#
# Live % streams to stdout AND results/progress.txt (watch: cat that file, or
# tail -f the redirected log). A portable watchdog (there is no `timeout` binary
# on macOS) kills a run after CLAUDE_E2E_TIMEOUT seconds so a stalled interview
# or interactive gate can't hang the suite.
#
# ⚠ Interview + gate caveat: /dev's interview AND its approval gate use
# AskUserQuestion, which a headless `-p` session can't answer. Prompts are
# fully-specified to make the interview a no-op; to clear the gate headless the
# prompt must pass `/dev --yes` (auto-approve a no-deviation gate). Without it a
# run stalls at the gate, gets watchdog-killed, and is reported SKIP — best-effort
# smoke, not a merge gate.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LINTER="$ROOT/.claude/hooks/artifact-lint.sh"
PROMPTS="$HERE/prompts"
MODEL="${CLAUDE_E2E_MODEL:-sonnet}"
TIMEOUT_S="${CLAUDE_E2E_TIMEOUT:-1800}"
RESULTS="$HERE/results"
PROG="$RESULTS/progress.txt"

MODE="dry"; KEEP=0; ONLY=""
[ "${CLAUDE_E2E:-0}" = "1" ] && MODE="run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --keep) KEEP=1 ;;
    --only) ONLY="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

. "$HERE/../lib/assert.sh"   # json_get + counters (we tally manually below)

prompt_type() { basename "$1" .txt | cut -d- -f2; }
prompt_list() {
  for p in "$PROMPTS"/*.txt; do
    [ -f "$p" ] || continue
    [ -n "$ONLY" ] && [ "$(basename "$p" .txt)" != "$ONLY" ] && continue
    echo "$p"
  done
}

echo "e2e smoke — mode=$MODE model=$MODEL${ONLY:+ only=$ONLY}"
echo

# ---- dry-run: describe the plan, verify prompts, run nothing ---------------
if [ "$MODE" = "dry" ]; then
  n=0
  for p in $(prompt_list); do
    n=$((n + 1))
    echo "• $(basename "$p" .txt)  (type=$(prompt_type "$p"))"
    echo "    sandbox: fresh git repo + copied .claude/ + .workflow/_templates"
    echo "    run:     claude -p \"\$(cat $(basename "$p"))\" --dangerously-skip-permissions"
    echo "    check:   artifact-lint + state.type==$(prompt_type "$p") + judge/judge.sh"
  done
  echo
  echo "e2e (dry-run): $n scenario(s) planned. Re-run with --run (needs the claude CLI) to execute live."
  exit 0
fi

# ---- live mode -------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "e2e: SKIP — no \`claude\` CLI on PATH (live e2e needs it). Deterministic suites are unaffected." >&2
  exit 0
fi

mkdir -p "$RESULTS"
TOTAL=0; for _p in $(prompt_list); do TOTAL=$((TOTAL + 1)); done; [ "$TOTAL" -gt 0 ] || TOTAL=1
DONE=0
progress() {
  pct=$(( DONE * 100 / TOTAL ))
  msg="[$DONE/$TOTAL ${pct}%] $1"
  echo ">> $msg"
  printf '%s\n' "$msg" > "$PROG"
}

# Portable watchdog: run the /dev session in the background, kill it after N
# seconds so a stalled interview/gate can't hang the suite. Output → sandbox/run.log.
run_timeout() {  # $1 secs · $2 sandbox · $3 prompt-file
  ( cd "$2" && claude -p "$(cat "$3")" --dangerously-skip-permissions --model "$MODEL" >"$2/run.log" 2>&1 ) &
  cpid=$!
  ( sleep "$1"; kill -TERM "$cpid" 2>/dev/null; sleep 3; kill -KILL "$cpid" 2>/dev/null ) &
  wpid=$!
  wait "$cpid" 2>/dev/null; rc=$?
  kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
  return "$rc"
}

SANDROOT="$(mktemp -d)"
cleanup() { [ "$KEEP" = "1" ] && echo "sandboxes kept under $SANDROOT" || rm -rf "$SANDROOT"; }
trap cleanup EXIT INT TERM

passed=0; failed=0; skipped=0
echo "progress file: $PROG"
progress "starting — $TOTAL scenario(s)"

setup_sandbox() {  # $1 = sandbox dir
  s="$1"
  mkdir -p "$s/.workflow"
  cp -R "$ROOT/.claude" "$s/.claude"
  [ -f "$ROOT/WORKFLOW.md" ] && cp "$ROOT/WORKFLOW.md" "$s/WORKFLOW.md"
  [ -f "$ROOT/CLAUDE.md" ]   && cp "$ROOT/CLAUDE.md"   "$s/CLAUDE.md"
  cp -R "$ROOT/.workflow/_templates" "$s/.workflow/_templates"
  if [ -f "$ROOT/.workflow/INDEX.md" ]; then
    cp "$ROOT/.workflow/INDEX.md" "$s/.workflow/INDEX.md"
  else
    printf '# Index\n\n| ID | Type | Title | Status | Created | Updated |\n|----|------|-------|--------|---------|---------|\n' > "$s/.workflow/INDEX.md"
  fi
  ( cd "$s" && git init -q && git add -A && git -c user.email=t@e2e -c user.name=e2e commit -qm base >/dev/null 2>&1 )
}

for p in $(prompt_list); do
  name="$(basename "$p" .txt)"; want="$(prompt_type "$p")"
  progress "$name (expect type=$want) — launching (≤${TIMEOUT_S}s)"
  sandbox="$SANDROOT/$name"
  setup_sandbox "$sandbox"

  run_timeout "$TIMEOUT_S" "$sandbox" "$p"; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "   SKIP — claude run exited $rc (timeout/interview/gate stall). Log: $sandbox/run.log"
    skipped=$((skipped + 1)); DONE=$((DONE + 1)); progress "$name SKIP"; echo; continue
  fi

  rd="$(find "$sandbox/.workflow" -mindepth 1 -maxdepth 1 -type d ! -name _templates 2>/dev/null | head -n1)"
  if [ -z "$rd" ]; then
    echo "   FAIL — no .workflow/<id>/ produced"; failed=$((failed + 1)); DONE=$((DONE + 1)); progress "$name FAIL"; echo; continue
  fi

  ok=1
  if sh "$LINTER" "$rd" >/dev/null 2>&1; then echo "   ✓ artifact-lint"; else echo "   ✗ artifact-lint"; ok=0; fi
  got="$(json_get "$rd/state.json" type)"
  if [ "$got" = "$want" ]; then echo "   ✓ state.type=$got"; else echo "   ✗ state.type=$got (want $want)"; ok=0; fi

  # Quality grade (best-effort; an un-judgeable run does not fail the smoke).
  if sh "$HERE/judge/judge.sh" "$rd" --model "$MODEL"; then
    echo "   ✓ judge pass"
  else
    jrc=$?
    [ "$jrc" = "2" ] && echo "   ~ judge skipped" || { echo "   ✗ judge fail"; ok=0; }
  fi

  if [ "$ok" = "1" ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
  DONE=$((DONE + 1)); progress "$name done — $([ "$ok" = 1 ] && echo pass || echo fail)"
  echo
done

echo "e2e smoke: passed=$passed failed=$failed skipped=$skipped"
[ "$failed" -eq 0 ]
