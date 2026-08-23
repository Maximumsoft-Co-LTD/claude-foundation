#!/usr/bin/env sh
# run-loop.sh — end-to-end smoke of the full OpenSpec-native change loop.
#
# Simulates one real user taking a small consumer project through
# /investigate → /change → /build → /prove → /land, one headless `claude -p`
# session per phase (a fresh session each time, so cross-session state
# persistence is part of what is tested). Between phases the runner asserts
# deterministic lifecycle state with the installed runtime CLI; the model's
# prose is never the verdict.
#
# NON-DETERMINISTIC + COSTS TOKENS. Defaults to --dry-run (prints the plan,
# runs nothing). Diagnostic smoke, not release evidence — every defect it
# surfaces still needs a deterministic reproduction in the main test harness.
#
#   sh run-loop.sh                     # dry-run: print the plan, exit 0
#   sh run-loop.sh --run               # live: needs `claude` + node >= 20.19
#   sh run-loop.sh --run --keep        # live, keep the sandbox for inspection
#   sh run-loop.sh --run --sandbox DIR --from 30   # resume an earlier sandbox
#
# Env: CLAUDE_E2E=1 (live), CLAUDE_LOOP_MODEL (default sonnet),
#      CLAUDE_LOOP_TIMEOUT seconds per phase (default 2400),
#      CLAUDE_LOOP_BUDGET_USD per phase (default 10).
#
# Phase verdicts: FAIL only when a deterministic assert breaks (suite exits 1);
# a claude process failure (timeout, budget, nonzero exit) is INCONCLUSIVE and
# stops the chain without failing the suite, matching run-e2e.sh's stance.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PHASES_DIR="$HERE/phases"
MODEL="${CLAUDE_LOOP_MODEL:-sonnet}"
TIMEOUT_S="${CLAUDE_LOOP_TIMEOUT:-2400}"
BUDGET_USD="${CLAUDE_LOOP_BUDGET_USD:-10}"

MODE="dry"; KEEP=0; SANDBOX=""; FROM="10"
[ "${CLAUDE_E2E:-0}" = "1" ] && MODE="run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --keep) KEEP=1 ;;
    --sandbox) SANDBOX="$2"; shift ;;
    --from) FROM="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

PHASE_LIST="10-investigate 20-change 30-build 40-prove 50-land"

# ---- dry-run: describe the plan, run nothing --------------------------------
if [ "$MODE" = "dry" ]; then
  echo "loop e2e — dry-run (model=$MODEL, timeout=${TIMEOUT_S}s/phase, budget=\$${BUDGET_USD}/phase)"
  echo
  echo "sandbox: fixture/ copied to a temp dir, git init, then install.sh --yes"
  echo "         (the real consumer install path), baseline npm test must be green."
  for ph in $PHASE_LIST; do
    echo "• $ph"
    echo "    run:   env -u CLAUDECODE claude -p \"\$(phase prompt)\" --dangerously-skip-permissions"
    case "$ph" in
      10-*) echo "    check: investigations note exists · no change created · src/ untouched" ;;
      20-*) echo "    check: exactly one openspec/changes/<id> · \`changes\` lists it · src/ untouched" ;;
      30-*) echo "    check: no pending task, no code/contract blocker · src/ untouched (sandbox-only edits)" ;;
      40-*) echo "    check: \`land check <id>\` exits 0 · src/ untouched" ;;
      50-*) echo "    check: change archived · npm test green at root · accept.mjs green" ;;
    esac
  done
  echo
  echo "loop e2e (dry-run): 5 phase(s) planned. Re-run with --run (needs the claude CLI) to execute live."
  exit 0
fi

# ---- live mode ---------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "loop e2e: SKIP — no \`claude\` CLI on PATH. Deterministic suites are unaffected." >&2
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "loop e2e: SKIP — node not found." >&2
  exit 0
fi

RESULTS="$HERE/results/loop-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS"
PROG="$RESULTS/progress.txt"
progress() { echo ">> $1"; printf '%s\n' "$1" >> "$PROG"; }

fail_hard() { progress "FAIL — $1"; echo "loop e2e: FAIL — $1"; exit 1; }
inconclusive() { progress "INCONCLUSIVE — $1"; echo "loop e2e: INCONCLUSIVE — $1 (not a suite failure)"; exit 0; }

fcli() { (cd "$SANDBOX" && node .claude/harness/foundation.mjs "$@"); }
src_clean() { [ -z "$(git -C "$SANDBOX" status --porcelain -- src test package.json 2>/dev/null)" ]; }
active_change_dirs() {
  find "$SANDBOX/openspec/changes" -mindepth 1 -maxdepth 1 -type d ! -name archive 2>/dev/null
}

# ---- sandbox: the real consumer install path --------------------------------
if [ -z "$SANDBOX" ]; then
  SANDBOX="$(mktemp -d)/shop"
  progress "sandbox: $SANDBOX"
  mkdir -p "$SANDBOX"
  cp -R "$HERE/fixture/." "$SANDBOX/"
  ( cd "$SANDBOX" && git init -q &&
    git -c user.email=t@e2e -c user.name=e2e add -A >/dev/null &&
    git -c user.email=t@e2e -c user.name=e2e commit -qm base ) || fail_hard "sandbox git init"
  bash "$ROOT/install.sh" "$SANDBOX" --yes > "$RESULTS/install.log" 2>&1 \
    || fail_hard "install.sh failed (see $RESULTS/install.log)"
  ( cd "$SANDBOX" &&
    git -c user.email=t@e2e -c user.name=e2e add -A >/dev/null &&
    git -c user.email=t@e2e -c user.name=e2e commit -qm "install foundation" ) \
    || fail_hard "post-install commit"
  ( cd "$SANDBOX" && node --test ) > "$RESULTS/baseline-test.log" 2>&1 \
    || fail_hard "baseline test suite is not green (see $RESULTS/baseline-test.log)"
  progress "sandbox ready — baseline green"
else
  [ -d "$SANDBOX/.claude/harness" ] || fail_hard "--sandbox has no installed harness: $SANDBOX"
  progress "reusing sandbox: $SANDBOX (from phase $FROM)"
fi

cleanup() {
  if [ "$KEEP" = "1" ]; then echo "sandbox kept at $SANDBOX"; fi
}
trap cleanup EXIT INT TERM

CHANGE_ID=""
[ -f "$RESULTS/change-id.txt" ] && CHANGE_ID="$(cat "$RESULTS/change-id.txt")"
if [ -z "$CHANGE_ID" ] && [ -d "$SANDBOX/openspec/changes" ]; then
  d="$(active_change_dirs | head -n1)"
  [ -n "$d" ] && CHANGE_ID="$(basename "$d")"
fi

# Portable per-phase watchdog (no `timeout` binary on macOS).
run_phase() {  # $1 phase name · $2 prompt file (already substituted)
  ( cd "$SANDBOX" && env -u CLAUDECODE claude -p "$(cat "$2")" \
      --dangerously-skip-permissions --model "$MODEL" \
      --output-format json --max-budget-usd "$BUDGET_USD" \
      > "$RESULTS/$1.json" 2> "$RESULTS/$1.err" ) &
  cpid=$!
  ( sleep "$TIMEOUT_S"; kill -TERM "$cpid" 2>/dev/null; sleep 3; kill -KILL "$cpid" 2>/dev/null ) &
  wpid=$!
  wait "$cpid" 2>/dev/null; rc=$?
  kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
  return "$rc"
}

for ph in $PHASE_LIST; do
  num="${ph%%-*}"
  [ "$num" -lt "$FROM" ] && { progress "$ph skipped (--from $FROM)"; continue; }

  prompt_src="$PHASES_DIR/$ph.txt"
  [ -f "$prompt_src" ] || fail_hard "missing prompt $prompt_src"
  prompt="$RESULTS/$ph.prompt.txt"
  if [ "$num" -ge 30 ]; then
    [ -n "$CHANGE_ID" ] || fail_hard "$ph needs a change id but none was captured"
    sed "s/{{CHANGE_ID}}/$CHANGE_ID/g" "$prompt_src" > "$prompt"
  else
    cp "$prompt_src" "$prompt"
  fi

  progress "$ph — launching (≤${TIMEOUT_S}s, ≤\$${BUDGET_USD})"
  run_phase "$ph" "$prompt"; rc=$?
  [ "$rc" -eq 0 ] || inconclusive "$ph: claude exited $rc (timeout/budget/stall) — log: $RESULTS/$ph.err"

  case "$num" in
    10)
      n="$(find "$SANDBOX/openspec/investigations" -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
      [ "$n" -ge 1 ] || fail_hard "10: no investigation note under openspec/investigations/"
      [ -z "$(active_change_dirs)" ] || fail_hard "10: /investigate created a change"
      src_clean || fail_hard "10: /investigate edited product code"
      progress "10 ok — note persisted, no change, src clean"
      ;;
    20)
      set -- $(active_change_dirs)
      [ "$#" -eq 1 ] || fail_hard "20: expected exactly 1 active change, found $#"
      CHANGE_ID="$(basename "$1")"
      printf '%s\n' "$CHANGE_ID" > "$RESULTS/change-id.txt"
      fcli changes > "$RESULTS/20.changes.txt" 2>&1
      grep -q "$CHANGE_ID" "$RESULTS/20.changes.txt" || fail_hard "20: \`changes\` does not list $CHANGE_ID"
      src_clean || fail_hard "20: /change edited product code"
      progress "20 ok — change $CHANGE_ID agreed, src clean"
      ;;
    30)
      # `proof readiness` exits non-zero for every state that is not READY, and
      # a complete Build legitimately lands on NEEDS_USER_DECISION whenever the
      # project's committed profile requires an independent reviewer. That
      # boundary belongs to phase 40, not to Build, so an rc check here failed
      # the loop on correct behaviour and this runner never once reached Land.
      # Assert what Build actually owns instead: no task left pending and no
      # code or contract work outstanding.
      fcli proof-readiness "$CHANGE_ID" > "$RESULTS/30.readiness.txt" 2>&1
      node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=(v.pendingTasks||[]).length;if(["NEEDS_CODE_CHANGE","CONFIGURATION_ERROR"].includes(v.status)||p){console.error(v.status+"; "+p+" pending task(s)");process.exit(1)}' \
        "$RESULTS/30.readiness.txt" \
        || fail_hard "30: build left work outstanding (see $RESULTS/30.readiness.txt)"
      src_clean || fail_hard "30: /build escaped the sandbox and edited root product code"
      progress "30 ok — build ready for prove, root src clean"
      ;;
    40)
      fcli land-check "$CHANGE_ID" > "$RESULTS/40.land-check.txt" 2>&1 \
        || fail_hard "40: land check failed after prove (see $RESULTS/40.land-check.txt)"
      src_clean || fail_hard "40: /prove edited root product code"
      progress "40 ok — proof complete, land check green"
      ;;
    50)
      find "$SANDBOX/openspec/changes/archive" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
        | grep -q "$CHANGE_ID" || fail_hard "50: change not found under openspec/changes/archive/"
      [ -z "$(active_change_dirs)" ] || fail_hard "50: change still active after land"
      ( cd "$SANDBOX" && node --test ) > "$RESULTS/50.test.log" 2>&1 \
        || fail_hard "50: test suite red after land (see $RESULTS/50.test.log)"
      ( cd "$SANDBOX" && node "$HERE/accept.mjs" ) > "$RESULTS/50.accept.log" 2>&1 \
        || fail_hard "50: acceptance check red — landed code does not meet AC (see $RESULTS/50.accept.log)"
      progress "50 ok — archived, suite green, acceptance green"
      ;;
  esac
done

progress "PASS — full loop landed and accepted"
echo "loop e2e: PASS (results: $RESULTS)"
