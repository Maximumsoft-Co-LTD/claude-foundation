#!/usr/bin/env sh
# run-hook-tests.sh — self-contained test suite for the five wired hooks:
#
#   dev-agent-guard.sh    (PreToolUse / Agent)   — Cases 1, 3, 4, 5, 6
#   dev-state-validate.sh (PostToolUse / Write…) — state.json integrity net
#   dev-state-mark.sh     (PostToolUse / Agent)  — .last_worker_return marker
#   protect-secrets.sh    (PreToolUse / Read|Grep|Bash) — secret-file guard
#   lint.sh               (PostToolUse / Write…) — fast default vs opt-in full checks
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
LINT="$HOOKS/lint.sh"

for h in "$GUARD" "$VALIDATE" "$MARK" "$SECRETS" "$LINT"; do
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

# The guard also writes a side-effect file (the spawn ledger), so these two
# compare values rather than the hook's stdout that assert_blocked/allowed read.
# assert_eq <label> <expected> <actual>
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1 (= $2)"; else fail "$1 — expected '$2', got '$3'"; fi
}
# assert_file_contains <label> <path> <fixed-substring>
assert_file_contains() {
  if grep -qF -- "$3" "$2" 2>/dev/null; then pass "$1"; else fail "$1 — '$3' not in $2"; fi
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

agent_json() { # $1=subagent_type $2=model ("" = omit) $3=prompt
  jq -cn --arg st "$1" --arg m "$2" --arg p "${3:-work}" \
    '{tool_name:"Agent", tool_input:({subagent_type:$st, description:"do a thing", prompt:$p} + (if $m == "" then {} else {model:$m} end))}'
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

# --- Case 5: fork blocked in an active run EXCEPT phase-1 (warm drafting) ---
PROJ_RUN="$TMPROOT/proj-run"
mk_run "$PROJ_RUN" "0001-feat-x" '{"run_id":"0001-feat-x","size":"M","phase":"phase-2","step":"implement"}'

run_hook "$GUARD" "$PROJ_RUN" "$(agent_json fork "")"
assert_blocked "guard C5 fork blocked in phase-2" "inside an active /dev run"

run_hook "$GUARD" "$PROJ_A" "$(agent_json fork "")"
assert_allowed "guard C5 fork with no active run"

# Phase 1 (requirements) is the sanctioned warm-drafting exception: fork inherits
# the pre-work context instead of a lossy digest, so it is ALLOWED there.
PROJ_P1="$TMPROOT/proj-p1"
mk_run "$PROJ_P1" "0003-feat-z" '{"run_id":"0003-feat-z","size":"S","phase":"phase-1-requirements","step":"spec"}'
run_hook "$GUARD" "$PROJ_P1" "$(agent_json fork "")"
assert_allowed "guard C5 fork allowed in phase-1-requirements"

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

# ...but the XS/S skip is scoped to FRESHNESS and must not take the tier guard
# with it. It used to `exit 0`, which left the hook and silently disabled Case 4
# on exactly the lanes that exist to control cost: a brownfield-S benchmark
# caught three of six runs buying opus for `lead` with nothing to stop them.
# These fixtures need an agents dir, since Case 4 reads the pin from disk.
mkdir -p "$PROJ_XS/.claude/agents"
printf -- '---\nname: qa\nmodel: sonnet\n---\n'       > "$PROJ_XS/.claude/agents/qa.md"
printf -- '---\nname: engineer\nmodel: sonnet\n---\n' > "$PROJ_XS/.claude/agents/engineer.md"
run_hook "$GUARD" "$PROJ_XS" "$(agent_json qa opus)"
assert_blocked "guard C4 tier guard applies on an XS run too" "pins model: sonnet"
# The one sanctioned override needs a named high-stakes reason; L alone cannot
# silently buy Opus.
run_hook "$GUARD" "$PROJ_XS" "$(agent_json engineer opus)"
assert_blocked "guard C4 engineer opus needs model_reason" "requires a prompt field"
run_hook "$GUARD" "$PROJ_XS" "$(agent_json engineer opus "model_reason:auth-boundary")"
assert_allowed "guard C4 engineer may escalate to opus with reason"
# Escalation only — a downward override is still the leak this case stops.
run_hook "$GUARD" "$PROJ_XS" "$(agent_json engineer haiku)"
assert_blocked "guard C4 engineer may not be downgraded" "pins model: sonnet"

# --- spawn ledger: count what actually went out ----------------------------
# state.json > spawn_count is self-reported and has been wrong in practice (0 on
# a run whose own notes said "combined lead spawn"). The guard sees every spawn,
# so it keeps an append-only ledger the orchestrator cannot forget to write.
# XS/S matter most here: they take the early return above, so the ledger has to
# be recorded on that path too — the size range where the metric was first wrong.
spawn_lines() {  # redirect fails before `wc` runs when the ledger is absent
  if [ -f "$1/.spawn_log" ]; then wc -l < "$1/.spawn_log" | tr -d ' '; else printf 0; fi
}

PROJ_LED="$TMPROOT/proj-ledger"
mk_run "$PROJ_LED" "0007-feat-led" '{"run_id":"0007-feat-led","size":"XS","phase":"phase-2","step":"implement"}'
LED_RUN="$PROJ_LED/.workflow/0007-feat-led"

# Every real .workflow/ ships _templates/state.json as a blueprint. It is not a
# run, but a naive "count dirs holding state.json" reads it as a second one and
# silently disables the ledger — which is exactly how the first live run came
# back with spawn_observed: null. Every ledger fixture carries it from here on.
mkdir -p "$PROJ_LED/.workflow/_templates"
printf '{"id":"NNNN-type-slug","spawn_count":0}' > "$PROJ_LED/.workflow/_templates/state.json"

assert_eq "ledger absent before any spawn" "0" "$(spawn_lines "$LED_RUN")"
run_hook "$GUARD" "$PROJ_LED" "$(agent_json engineer "")"
assert_eq "ledger records an XS worker spawn" "1" "$(spawn_lines "$LED_RUN")"
run_hook "$GUARD" "$PROJ_LED" "$(agent_json lead "")"
assert_eq "ledger accumulates across spawns" "2" "$(spawn_lines "$LED_RUN")"
assert_file_contains "ledger names the worker" "$LED_RUN/.spawn_log" "lead"

# --- ledger column 3: the TIER the spawn actually ran at ---------------------
# `lead` may vary sonnet<->opus (Case 4 exempts it), and the playbook says sonnet
# at XS/S. But with no `model` param the frontmatter pin decides silently, so a
# run could pay opus twice and no scorecard would show it. The ledger now records
# which of the two governed. Column, not a new file: every consumer reads this
# with `wc -l` or a name grep, and both survive an appended field.
mkdir -p "$PROJ_LED/.claude/agents"
printf -- '---\nname: lead\nmodel: opus\n---\n'     > "$PROJ_LED/.claude/agents/lead.md"
printf -- '---\nname: engineer\nmodel: sonnet\n---\n' > "$PROJ_LED/.claude/agents/engineer.md"
run_hook "$GUARD" "$PROJ_LED" "$(agent_json lead "")"
assert_file_contains "ledger records the frontmatter pin when no model is passed" \
  "$LED_RUN/.spawn_log" "pin:opus"
run_hook "$GUARD" "$PROJ_LED" "$(agent_json engineer sonnet)"
assert_file_contains "ledger records an explicit override as req:" \
  "$LED_RUN/.spawn_log" "req:sonnet"
assert_eq "tier column did not change the row count" "4" "$(spawn_lines "$LED_RUN")"

# A BLOCKED spawn never happened — counting it would overstate the machinery.
run_hook "$GUARD" "$PROJ_LED" "$(agent_json orchestrator "")"
assert_blocked "guard C1 still blocks with ledger in place" "there is no"
assert_eq "ledger ignores a blocked spawn" "4" "$(spawn_lines "$LED_RUN")"

# Non-worker built-ins are not /dev machinery and stay out of the count.
run_hook "$GUARD" "$PROJ_LED" "$(agent_json general-purpose sonnet)"
assert_allowed "guard C6 general-purpose allowed in a run"
assert_eq "ledger ignores generic built-ins" "4" "$(spawn_lines "$LED_RUN")"

# M-size runs reach the end of the hook instead of the XS/S early return — the
# ledger must be written on BOTH paths, or the counts silently depend on size.
PROJ_LEDM="$TMPROOT/proj-ledger-m"
mk_run "$PROJ_LEDM" "0008-feat-ledm" '{"run_id":"0008-feat-ledm","size":"M","phase":"phase-2","step":"implement"}'
run_hook "$GUARD" "$PROJ_LEDM" "$(agent_json qa "")"
assert_eq "ledger records an M worker spawn too" "1" "$(spawn_lines "$PROJ_LEDM/.workflow/0008-feat-ledm")"

# Two active runs → the ledger cannot tell which run this spawn belongs to. It
# writes nothing rather than charging the spawn to the wrong run.
PROJ_TWO="$TMPROOT/proj-two-runs"
mk_run "$PROJ_TWO" "0009-feat-a" '{"run_id":"0009-feat-a","size":"M","phase":"phase-2","step":"implement"}'
mk_run "$PROJ_TWO" "0010-feat-b" '{"run_id":"0010-feat-b","size":"M","phase":"phase-2","step":"implement"}'
run_hook "$GUARD" "$PROJ_TWO" "$(agent_json engineer "")"
assert_eq "ledger stays silent when the run is ambiguous" "0" "$(spawn_lines "$PROJ_TWO/.workflow/0009-feat-a")"
# …unless the orchestrator named the run explicitly.
run_hook "$GUARD" "$PROJ_TWO" "$(agent_json engineer "")" CLAUDE_DEV_RUN_ID=0010-feat-b
assert_eq "ledger uses CLAUDE_DEV_RUN_ID to disambiguate" "1" "$(spawn_lines "$PROJ_TWO/.workflow/0010-feat-b")"

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

# --- "__now__" sentinel substitution ------------------------------------------
# The orchestrator has no clock, so it writes the literal "__now__" and this hook
# stamps real UTC. That replaced seven `date -u` Bash turns per XS run. Pin the
# behaviour: the sentinel must vanish everywhere (including nested), real values
# must survive untouched, and the sentinel must not leak past the hook — a run
# that resumes off a literal "__now__" has a corrupt clock.
printf '{\n  "phase": "one",\n  "last_updated": "__now__",\n  "created_at": "2020-01-02T03:04:05Z",\n  "phase_times": { "plan": "__now__" },\n  "done_at": null\n}\n' > "$VRUN/state.json"
run_hook "$VALIDATE" "$VPROJ" "$(write_json "$VRUN/state.json")"
assert_allowed "validate stamps __now__ sentinel"
if grep -q '__now__' "$VRUN/state.json"; then
  fail "sentinel __now__ survived the hook (resume would read a corrupt clock)"
else
  pass "sentinel __now__ replaced everywhere"
fi
if jq -e '.last_updated | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$VRUN/state.json" >/dev/null 2>&1; then
  pass "last_updated stamped as ISO-8601 UTC"
else
  fail "last_updated not stamped as ISO-8601 UTC"
fi
if jq -e '.phase_times.plan | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$VRUN/state.json" >/dev/null 2>&1; then
  pass "nested phase_times sentinel stamped too"
else
  fail "nested phase_times sentinel not stamped"
fi
if [ "$(jq -r '.created_at' "$VRUN/state.json")" = "2020-01-02T03:04:05Z" ]; then
  pass "an already-real timestamp is left alone"
else
  fail "hook overwrote a real timestamp"
fi
if [ "$(jq -r '.done_at' "$VRUN/state.json")" = "null" ]; then
  pass "null done_at untouched by substitution"
else
  fail "hook disturbed a null field"
fi

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
# lint.sh — project-wide checks stay out of the default edit hot loop
# =============================================================================

LPROJ="$TMPROOT/proj-lint"
mkdir -p "$LPROJ/src" "$LPROJ/node_modules/.bin"
printf 'const value: number = 1;\n' > "$LPROJ/src/app.ts"
printf '{}\n' > "$LPROJ/tsconfig.json"
printf '#!/bin/sh\ntouch "$CLAUDE_PROJECT_DIR/.eslint-ran"\nexit 0\n' > "$LPROJ/node_modules/.bin/eslint"
printf '#!/bin/sh\ntouch "$CLAUDE_PROJECT_DIR/.tsc-ran"\nexit 0\n' > "$LPROJ/node_modules/.bin/tsc"
chmod +x "$LPROJ/node_modules/.bin/eslint" "$LPROJ/node_modules/.bin/tsc"

lint_json() { jq -cn --arg fp "$1" '{tool_name:"Write", tool_input:{file_path:$fp}}'; }

rm -f "$LPROJ/.eslint-ran" "$LPROJ/.tsc-ran"
run_hook "$LINT" "$LPROJ" "$(lint_json "$LPROJ/src/app.ts")"
assert_allowed "lint default edit check"
if [ -e "$LPROJ/.eslint-ran" ]; then
  fail "lint default started eslint in the edit hot loop"
else
pass "lint default defers eslint to the Ship Gate"
fi
if [ -e "$LPROJ/.tsc-ran" ]; then
  fail "lint default ran project-wide tsc in the edit hot loop"
else
  pass "lint default skips project-wide tsc"
fi

run_hook "$LINT" "$LPROJ" "$(lint_json "$LPROJ/src/app.ts")" CLAUDE_EDIT_LINT=1
assert_allowed "lint opt-in file edit check"
if [ -e "$LPROJ/.eslint-ran" ]; then
  pass "lint opt-in runs eslint"
else
  fail "lint opt-in did not run eslint"
fi

rm -f "$LPROJ/.tsc-ran"
run_hook "$LINT" "$LPROJ" "$(lint_json "$LPROJ/src/app.ts")" CLAUDE_EDIT_FULL_CHECKS=1
assert_allowed "lint opt-in full edit check"
if [ -e "$LPROJ/.tsc-ran" ]; then
  pass "lint opt-in runs project-wide tsc"
else
  fail "lint opt-in did not run project-wide tsc"
fi

# =============================================================================

echo
if [ "$failures" -eq 0 ]; then
  echo "hook tests: ALL PASS ($asserts/$asserts assertions)"
  exit 0
else
  echo "hook tests: $failures/$asserts assertion(s) FAILED" >&2
  exit 1
fi
