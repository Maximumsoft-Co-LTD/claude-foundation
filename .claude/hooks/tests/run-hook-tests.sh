#!/usr/bin/env sh
# run-hook-tests.sh — self-contained test suite for the four wired hooks:
#
#   dev-agent-guard.sh    (PreToolUse / Agent)   — Cases 1, 3, 4, 5, 6
#   dev-state-validate.sh (PostToolUse / Write…) — state.json integrity net
#   dev-state-mark.sh     (PostToolUse / Agent)  — .last_worker_return marker
#   protect-secrets.sh    (PreToolUse / Read|Grep|Bash) — secret-file guard
#
# Contract under test: a hook BLOCKS by printing {"decision":"block",...} on
# stdout and exiting 0; it ALLOWS by printing nothing (dev-state-mark instead
# emits additionalContext + touches a marker). So every assertion inspects
# stdout / filesystem side effects — never the exit code — EXCEPT that any
# nonzero exit is a crash and fails the test outright.
#
# Style mirrors run-artifact-lint-tests.sh: pass/fail helpers, a failures
# counter, throwaway fixtures under a mktemp TMPROOT (trap-cleaned), a final
# "X/Y assertions" summary, exit 1 on any failure. Runnable from any cwd.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS="$HERE/.."
GUARD="$HOOKS/dev-agent-guard.sh"
VALIDATE="$HOOKS/dev-state-validate.sh"
MARK="$HOOKS/dev-state-mark.sh"
SECRETS="$HOOKS/protect-secrets.sh"

for h in "$GUARD" "$VALIDATE" "$MARK" "$SECRETS"; do
  if [ ! -f "$h" ]; then
    echo "FAIL: hook not found at $h" >&2
    exit 1
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  # Every hook fails open without jq — nothing meaningful to assert.
  echo "SKIP: jq not installed; all four hooks fail open without it" >&2
  exit 1
fi

failures=0
asserts=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT INT TERM

pass() { asserts=$((asserts + 1)); echo "PASS: $1"; }
fail() { asserts=$((asserts + 1)); failures=$((failures + 1)); echo "FAIL: $1" >&2; }

# run_hook <hook> <project_dir> <json> [VAR=value ...]
# Pipes <json> into the hook with CLAUDE_PROJECT_DIR=<project_dir> and the
# run-scoping env vars explicitly UNSET unless re-supplied as extra args.
# Captures stdout in $out and the exit code in $rc.
run_hook() {
  _hook="$1"; _proj="$2"; _json="$3"; shift 3
  set +e
  out="$(printf '%s' "$_json" | env -u CLAUDE_DEV_RUN_ID -u CLAUDE_DEV_FLOOR_MODEL \
        CLAUDE_PROJECT_DIR="$_proj" "$@" bash "$_hook")"
  rc=$?
  set -e
}

# assert_blocked <label> <reason-substring>  — after run_hook.
# Block = exit 0 AND stdout JSON with decision:"block" AND reason names why.
assert_blocked() {
  if [ "$rc" -ne 0 ]; then fail "$1 — hook crashed (exit $rc). Out: $out"; return 0; fi
  decision="$(printf '%s' "$out" | jq -r '.decision // empty' 2>/dev/null || true)"
  # grep the DECODED reason, not the raw JSON — inner quotes are escaped there.
  reason="$(printf '%s' "$out" | jq -r '.reason // empty' 2>/dev/null || true)"
  if [ "$decision" != "block" ]; then
    fail "$1 — expected decision:\"block\", got stdout: ${out:-<empty>}"
  elif ! printf '%s' "$reason" | grep -qF -- "$2"; then
    fail "$1 — block reason missing '$2'. Got: $reason"
  else
    pass "$1 (blocked: $2)"
  fi
}

# assert_allowed <label>  — after run_hook. Allow = exit 0 AND empty stdout.
assert_allowed() {
  if [ "$rc" -ne 0 ]; then fail "$1 — hook crashed (exit $rc). Out: $out"; return 0; fi
  if [ -n "$out" ]; then fail "$1 — expected silence (allow), got: $out"; else pass "$1 (allowed)"; fi
}

# mk_run <project_dir> <run_id> <state-json>  — fabricate a /dev run dir.
mk_run() {
  mkdir -p "$1/.workflow/$2"
  printf '%s' "$3" > "$1/.workflow/$2/state.json"
}

echo "Running hook test suite..."
echo

# =============================================================================
# dev-agent-guard.sh
# =============================================================================

# A project with a fake agents dir (deterministic model pin) and NO .workflow,
# so Cases 3/5 stay out of the way of Case-1/4/6 assertions.
PROJ_A="$TMPROOT/proj-agents"
mkdir -p "$PROJ_A/.claude/agents"
printf -- '---\nname: pm\ndescription: fake pm for tests\nmodel: sonnet\n---\nbody\n' > "$PROJ_A/.claude/agents/pm.md"

agent_json() { # $1=subagent_type $2=model ("" = omit)
  jq -cn --arg st "$1" --arg m "$2" \
    '{tool_name:"Agent", tool_input:({subagent_type:$st, description:"do a thing", prompt:"work"} + (if $m == "" then {} else {model:$m} end))}'
}

# --- Case 1: orchestrator is not a sub-agent -------------------------------
run_hook "$GUARD" "$PROJ_A" "$(agent_json orchestrator "")"
assert_blocked "guard C1 subagent_type=orchestrator" "there is no"

# --- Case 4: model override vs pinned frontmatter --------------------------
run_hook "$GUARD" "$PROJ_A" "$(agent_json pm opus)"
assert_blocked "guard C4 pm override opus vs pinned sonnet" "pins model: sonnet"

run_hook "$GUARD" "$PROJ_A" "$(agent_json pm sonnet)"
assert_allowed "guard C4 pm override matching pin"

run_hook "$GUARD" "$PROJ_A" "$(agent_json pm "")"
assert_allowed "guard C4 pm no override"

# Override on a worker whose agent file does not exist → fail CLOSED.
run_hook "$GUARD" "$PROJ_A" "$(agent_json team-ghost sonnet)"
assert_blocked "guard C4 missing agent file fails closed" "could not be read"

# --- Case 6: generic built-ins must pin the floor model --------------------
run_hook "$GUARD" "$PROJ_A" "$(agent_json Explore "")"
assert_blocked "guard C6 Explore without model" "must set model"

run_hook "$GUARD" "$PROJ_A" "$(agent_json general-purpose sonnet)"
assert_allowed "guard C6 general-purpose model=sonnet"

run_hook "$GUARD" "$PROJ_A" "$(agent_json Explore haiku)" CLAUDE_DEV_FLOOR_MODEL=haiku
assert_allowed "guard C6 floor override haiku + model=haiku"

# --- Case 5: fork blocked only while a /dev run is active ------------------
PROJ_RUN="$TMPROOT/proj-run"
mk_run "$PROJ_RUN" "0001-feat-x" '{"run_id":"0001-feat-x","size":"M","phase":"phase-2","step":"implement"}'

run_hook "$GUARD" "$PROJ_RUN" "$(agent_json fork "")"
assert_blocked "guard C5 fork with active run" "inside an active /dev run"

run_hook "$GUARD" "$PROJ_A" "$(agent_json fork "")"
assert_allowed "guard C5 fork with no active run"

# --- Case 3: state.json freshness between worker spawns --------------------
# Marker NEWER than state.json → next worker spawn on an M-size run blocks.
PROJ_M="$TMPROOT/proj-m"
mk_run "$PROJ_M" "0002-feat-y" '{"run_id":"0002-feat-y","size":"M","phase":"phase-2","step":"implement"}'
touch -t 202601010000 "$PROJ_M/.workflow/0002-feat-y/state.json"
touch -t 202601010100 "$PROJ_M/.workflow/0002-feat-y/.last_worker_return"

run_hook "$GUARD" "$PROJ_M" "$(agent_json engineer "")"
assert_blocked "guard C3 stale state.json blocks next worker (M)" "was not updated after the last worker returned"

# state.json NEWER than marker → allowed.
touch -t 202601010200 "$PROJ_M/.workflow/0002-feat-y/state.json"
run_hook "$GUARD" "$PROJ_M" "$(agent_json engineer "")"
assert_allowed "guard C3 fresh state.json allows next worker"

# XS run skips the freshness block entirely.
PROJ_XS="$TMPROOT/proj-xs"
mk_run "$PROJ_XS" "0003-fix-z" '{"run_id":"0003-fix-z","size":"XS","phase":"phase-2","step":"implement"}'
touch -t 202601010000 "$PROJ_XS/.workflow/0003-fix-z/state.json"
touch -t 202601010100 "$PROJ_XS/.workflow/0003-fix-z/.last_worker_return"

run_hook "$GUARD" "$PROJ_XS" "$(agent_json engineer "")"
assert_allowed "guard C3 XS run skips freshness block"

# =============================================================================
# dev-state-validate.sh
# =============================================================================

VPROJ="$TMPROOT/proj-validate"
VRUN="$VPROJ/.workflow/0004-feat-v"
mkdir -p "$VRUN" "$VPROJ/.workflow/_templates"

write_json() { # $1=file_path — PostToolUse payload for a Write to that file
  jq -cn --arg fp "$1" '{tool_name:"Write", tool_input:{file_path:$fp}}'
}

# Invalid JSON → blocked.
printf '{"phase": "one",' > "$VRUN/state.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
assert_blocked "validate invalid JSON" "not valid JSON"

# Duplicate top-level key at the canonical 2-space indent → blocked.
printf '{\n  "phase": "one",\n  "notes": "a",\n  "notes": "b"\n}\n' > "$VRUN/state.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
assert_blocked "validate duplicate key (2-space indent)" 'duplicate key "notes"'

# Duplicate key at 4-space indent — only the python3 path sees this.
if command -v python3 >/dev/null 2>&1; then
  printf '{\n    "phase": "one",\n    "notes": "a",\n    "notes": "b"\n}\n' > "$VRUN/state.json"
  run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
  assert_blocked "validate duplicate key (4-space indent, python3)" 'duplicate key "notes"'

  # Nested duplicate — also python3-only.
  printf '{\n  "phase": "one",\n  "cycles": {\n    "review": 1,\n    "review": 2\n  }\n}\n' > "$VRUN/state.json"
  run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
  assert_blocked "validate nested duplicate key (python3)" 'duplicate key "review"'
else
  echo "SKIP: validate 4-space/nested duplicate tests (python3 not installed)"
fi

# Clean file → silent.
printf '{\n  "phase": "one",\n  "notes": "a"\n}\n' > "$VRUN/state.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
assert_allowed "validate clean state.json"

# Shard file (state.plan.json) is out of scope — even when invalid.
printf 'not json at all' > "$VRUN/state.plan.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.plan.json")"
assert_allowed "validate ignores shard state.plan.json"

# _templates blueprint is out of scope — even when invalid.
printf 'not json at all' > "$VPROJ/.workflow/_templates/state.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VPROJ/.workflow/_templates/state.json")"
assert_allowed "validate ignores _templates blueprint"

# =============================================================================
# dev-state-mark.sh
# =============================================================================

MPROJ="$TMPROOT/proj-mark"
MRUN="$MPROJ/.workflow/0005-feat-m"
mk_run "$MPROJ" "0005-feat-m" '{"run_id":"0005-feat-m","size":"M","phase":"phase-1-requirements","step":"spec"}'
MARKER="$MRUN/.last_worker_return"

mark_json() { # $1=subagent_type $2=prompt $3=run_in_background ("" = omit)
  jq -cn --arg st "$1" --arg p "$2" --arg bg "$3" \
    '{tool_name:"Agent", tool_input:(({subagent_type:$st, description:"worker", prompt:$p}) + (if $bg == "" then {} else {run_in_background:($bg == "true")} end))}'
}

# Foreground pm return → marker touched + additionalContext reminder emitted.
rm -f "$MARKER"
run_hook "$MARK" "$MPROJ" "$(mark_json pm "write the spec" "")"
if [ "$rc" -ne 0 ]; then
  fail "mark foreground pm return — hook crashed (exit $rc). Out: $out"
elif [ ! -f "$MARKER" ]; then
  fail "mark foreground pm return — .last_worker_return not touched"
elif ! printf '%s' "$out" | grep -qF 'additionalContext'; then
  fail "mark foreground pm return — no additionalContext reminder. Got: ${out:-<empty>}"
else
  pass "mark foreground pm return touches marker + reminds"
fi

# Background spawn ack → NOT a return; marker untouched, no output.
rm -f "$MARKER"
run_hook "$MARK" "$MPROJ" "$(mark_json engineer "implement T001" "true")"
if [ "$rc" -ne 0 ]; then
  fail "mark background spawn — hook crashed (exit $rc). Out: $out"
elif [ -f "$MARKER" ]; then
  fail "mark background spawn — marker touched for a launch ack"
elif [ -n "$out" ]; then
  fail "mark background spawn — expected silence, got: $out"
else
  pass "mark background spawn skips marker"
fi

# Team-mode slice spawn (writes its own shard) → marker untouched, no output.
rm -f "$MARKER"
run_hook "$MARK" "$MPROJ" "$(mark_json lead "team-slice: plan — write plan.md shard" "")"
if [ "$rc" -ne 0 ]; then
  fail "mark team-slice spawn — hook crashed (exit $rc). Out: $out"
elif [ -f "$MARKER" ]; then
  fail "mark team-slice spawn — marker touched for a slice worker"
elif [ -n "$out" ]; then
  fail "mark team-slice spawn — expected silence, got: $out"
else
  pass "mark team-slice:plan spawn skips marker"
fi

# =============================================================================
# protect-secrets.sh
# =============================================================================

read_json() { jq -cn --arg fp "$1" '{tool_name:"Read", tool_input:{file_path:$fp}}'; }
bash_json() { jq -cn --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }

run_hook "$SECRETS" "$TMPROOT" "$(read_json "$TMPROOT/app/.env")"
assert_blocked "secrets Read .env" "secrets guard"

run_hook "$SECRETS" "$TMPROOT" "$(read_json "$TMPROOT/app/.env.example")"
assert_allowed "secrets Read .env.example (template allow-list)"

run_hook "$SECRETS" "$TMPROOT" "$(bash_json "cat .env")"
assert_blocked "secrets Bash cat .env" "secrets guard"

run_hook "$SECRETS" "$TMPROOT" "$(bash_json "source .env")"
assert_allowed "secrets Bash source .env (loads, never prints)"

run_hook "$SECRETS" "$TMPROOT" "$(read_json "$TMPROOT/app/README.md")"
assert_allowed "secrets Read README.md"

# =============================================================================

echo
if [ "$failures" -eq 0 ]; then
  echo "hook tests: ALL PASS ($asserts/$asserts assertions)"
  exit 0
else
  echo "hook tests: $failures/$asserts assertion(s) FAILED" >&2
  exit 1
fi
