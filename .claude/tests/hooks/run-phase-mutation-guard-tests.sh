#!/usr/bin/env sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/openspec/changes/demo" "$TMP/project/.foundation" "$TMP/workspace/src" "$TMP/outside"
HOOK="$ROOT/.claude/hooks/phase-mutation-guard.mjs"

node --test "$ROOT/.claude/tests/hooks/phase-state.test.mjs"

invoke() {
  phase="$1" mode="$2" workspace="$3" event="$4"
  printf '%s' "$event" | CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_ACTIVE_PHASE="$phase" \
    FOUNDATION_GUARDRAIL_MODE="$mode" FOUNDATION_WORKSPACE_ROOT="$workspace" node "$HOOK"
}

write_event() { printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$1"; }
bash_event() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"; }

out="$(invoke change block "" "$(write_event "$TMP/project/openspec/changes/demo/tasks.md")")"
assert_eq "Change permits its OpenSpec draft" "" "$out"

out="$(invoke change block "" "$(write_event "$TMP/project/src/app.js")")"
assert_contains "Change blocks product mutation" "$out" '"decision":"block"'

out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/workspace/src/app.js")")"
assert_eq "Build permits isolated workspace mutation" "" "$out"

out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/outside/app.js")")"
assert_contains "Build blocks paths outside isolation" "$out" '"decision":"block"'

ln -s "$TMP/outside" "$TMP/workspace/escape"
out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/workspace/escape/app.js")")"
assert_contains "Build resolves symlink escape before allowing" "$out" '"decision":"block"'

out="$(invoke prove block "" "$(write_event "$TMP/project/src/app.js")")"
assert_contains "Prove keeps product files read-only" "$out" '"decision":"block"'

out="$(invoke prove block "" "$(bash_event 'git commit -m x')")"
assert_contains "Prove blocks mutating shell command" "$out" '"decision":"block"'

# /dev/null redirects are how read-only commands silence noise; treating them
# as mutations blocked every `2>/dev/null` during Change/Prove.
out="$(invoke prove block "" "$(bash_event 'git log 2>/dev/null')")"
assert_eq "Prove permits read-only commands silencing stderr" "" "$out"

out="$(invoke prove block "" "$(bash_event 'echo x > notes.txt')")"
assert_contains "Prove still blocks redirects to real files" "$out" '"decision":"block"'

# /investigate writes openspec/investigations and records no phase; a phase
# left behind by an earlier packet must not block investigation notes.
out="$(invoke change block "" "$(write_event "$TMP/project/openspec/investigations/probe.md")")"
assert_eq "Change permits investigation notes" "" "$out"

out="$(invoke prove block "" "$(write_event "$TMP/project/openspec/investigations/probe.md")")"
assert_eq "Prove permits investigation notes" "" "$out"

out="$(invoke land block "" "$(write_event "$TMP/project/src/app.js")")"
assert_contains "Land requires transaction marker" "$out" '"decision":"block"'

out="$(printf '%s' "$(write_event "$TMP/project/src/app.js")" | CLAUDE_PROJECT_DIR="$TMP/project" \
  FOUNDATION_ACTIVE_PHASE=land FOUNDATION_GUARDRAIL_MODE=block FOUNDATION_LAND_TRANSACTION=1 node "$HOOK")"
assert_eq "Land runtime transaction may mutate" "" "$out"

out="$(invoke prove audit "" "$(write_event "$TMP/project/src/app.js")")"
assert_eq "audit-only rollout does not block" "" "$out"
assert_file_contains "audit-only rollout records violation" "$TMP/project/.foundation/logs/guardrail-audit.jsonl" '"phase":"prove"'

out="$(printf '%s' "$(write_event "$TMP/project/src/app.js")" | CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_contains "block mode fails closed when phase context is missing" "$out" 'active phase is unavailable'

out="$(printf '%s' "$(bash_event 'git status')" | CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_eq "read-only shell commands do not require phase context" "" "$out"

# --- The prefilter: what it may skip, and what it must never skip. ----------
#
# The wired hook is the shell prefilter; the guard above is what it execs. These
# assertions pin the seam between them, because a prefilter that skips one case
# too many turns a mutation boundary into silence without failing anything.

PREFILTER="$ROOT/.claude/hooks/phase-mutation-guard.sh"
mkdir -p "$TMP/pre/.foundation/logs"

# `env -i` with an unusable PATH is the proof, not a proxy for it: if the fast
# path started Node — or any external command — this could not exit 0.
pre_isolated() {
  printf '%s' "$2" | env -i CLAUDE_PROJECT_DIR="$TMP/pre" PATH=/nonexistent \
    FOUNDATION_GUARDRAIL_MODE="$1" /bin/sh "$PREFILTER"
}

pre() {
  printf '%s' "$3" | CLAUDE_PROJECT_DIR="$TMP/pre" FOUNDATION_GUARDRAIL_MODE="$1" \
    FOUNDATION_ACTIVE_PHASE="$2" sh "$PREFILTER"
}

assert_cmd_zero "audit mode with no phase context resolves without starting Node" \
  pre_isolated audit "$(write_event "$TMP/pre/src/app.js")"
assert_cmd_zero "guardrail mode off resolves without starting Node" \
  pre_isolated off "$(write_event "$TMP/pre/src/app.js")"

out="$(pre block "" "$(write_event "$TMP/pre/src/app.js")")"
assert_contains "block mode delegates even when no phase is recorded" \
  "$out" 'active phase is unavailable'

out="$(pre audit prove "$(write_event "$TMP/pre/src/app.js")")"
assert_eq "an exported phase delegates and audit mode still does not block" "" "$out"
assert_file_contains "an exported phase reaches the guard through the prefilter" \
  "$TMP/pre/.foundation/logs/guardrail-audit.jsonl" '"phase":"prove"'

# The guard lowercases the mode, so "BLock" means enforcement there. A
# prefilter that only recognised three block spellings took the audit fast
# path and failed open — the one direction it promises never to skip.
out="$(pre BLock "" "$(write_event "$TMP/pre/src/app.js")")"
assert_contains "an unrecognised mode spelling delegates instead of fast-pathing" \
  "$out" 'active phase is unavailable'

# Presence of any recorded phase context must delegate, whatever its age: the
# freshness window is the guard's policy, and the prefilter must not second-guess it.
rm -f "$TMP/pre/.foundation/logs/guardrail-audit.jsonl"
mkdir -p "$TMP/pre/.foundation/logs/demo"
printf '{"timestamp":"1970-01-01T00:00:00Z","phase":"prove"}\n' \
  > "$TMP/pre/.foundation/logs/demo/phase-context.jsonl"
out="$(pre audit "" "$(write_event "$TMP/pre/src/app.js")")"
assert_eq "a stale recorded phase still delegates rather than being judged here" "" "$out"
assert_file_absent "the guard, not the prefilter, decides a stale phase is no phase" \
  "$TMP/pre/.foundation/logs/guardrail-audit.jsonl"

# --- The audit log is bounded. ----------------------------------------------
mkdir -p "$TMP/rot/.foundation/logs"
audit="$TMP/rot/.foundation/logs/guardrail-audit.jsonl"
# One byte over the cap the guard rotates at.
node -e 'require("fs").writeFileSync(process.argv[1], "x".repeat(1024*1024 + 1))' "$audit"
printf '%s' "$(write_event "$TMP/rot/src/app.js")" | CLAUDE_PROJECT_DIR="$TMP/rot" \
  FOUNDATION_ACTIVE_PHASE=prove FOUNDATION_GUARDRAIL_MODE=audit node "$HOOK" >/dev/null

assert_file_exists "an oversized audit log is rotated to one generation" "$audit.1"
assert_file_contains "the new audit log carries the row that triggered rotation" \
  "$audit" '"phase":"prove"'
assert_eq "the rotated log is the only generation kept" "1" \
  "$(ls "$TMP/rot/.foundation/logs" | grep -c 'guardrail-audit.jsonl.1')"
assert_cmd_zero "the new audit log starts under the cap" \
  node -e 'process.exit(require("fs").statSync(process.argv[1]).size < 1024*1024 ? 0 : 1)' "$audit"

finish "phase mutation guard"
