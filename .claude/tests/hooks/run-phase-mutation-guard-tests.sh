#!/usr/bin/env sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/openspec/changes/demo" "$TMP/project/.foundation" "$TMP/workspace/src" "$TMP/outside"
HOOK="$ROOT/.claude/hooks/phase-mutation-guard.mjs"

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

finish "phase mutation guard"
