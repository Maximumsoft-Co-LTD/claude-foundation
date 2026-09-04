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
node --test "$ROOT/.claude/tests/hooks/phase-guard-policy.test.mjs"

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

out="$(invoke change block "" "$(bash_event 'touch openspec/changes/demo/tasks.md')")"
assert_contains "Change shell recovery directs artifact edits to structured tools" \
  "$out" 'Use Edit or Write for openspec/changes artifacts'

out="$(invoke change block "" "$(bash_event "python3 -c 'Path().write_text()'")")"
assert_contains "Change blocks Python file-write APIs hidden behind an interpreter" \
  "$out" '"decision":"block"'

out="$(invoke change block "" "$(bash_event "node -e 'fs.writeFileSync()'")")"
assert_contains "Change blocks Node file-write APIs hidden behind an interpreter" \
  "$out" '"decision":"block"'

out="$(invoke change block "" "$(bash_event "python3 -c 'print(1)'")")"
assert_eq "Change permits a read-only interpreter command" "" "$out"

out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/workspace/src/app.js")")"
assert_eq "Build permits isolated workspace mutation" "" "$out"

out="$(invoke build block "$TMP/workspace" \
  "{\"tool_name\":\"NotebookEdit\",\"tool_input\":{\"notebook_path\":\"$TMP/workspace/notebook.ipynb\"}}")"
assert_eq "Build permits an isolated notebook mutation" "" "$out"

out="$(invoke build block "$TMP/workspace" \
  "{\"tool_name\":\"MultiEdit\",\"tool_input\":{\"edits\":[null,{\"file_path\":42},{\"file_path\":\"$TMP/workspace/src/one.js\"},{\"file_path\":\"$TMP/outside/two.js\"}]}}")"
assert_contains "Build checks every string path in a multi-edit" "$out" '"decision":"block"'

out="$(invoke build block "$TMP/workspace" "$(write_event "../workspace/src/relative.js")")"
assert_eq "Build resolves a relative mutation target from the project" "" "$out"

out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/outside/app.js")")"
assert_contains "Build blocks paths outside isolation" "$out" '"decision":"block"'

hostile_path="$TMP/workspace/src/--flag-semi-colon;literal-dollar"
out="$(invoke build block "$TMP/workspace" "$(write_event "$hostile_path")")"
assert_eq "Build treats hostile filenames as paths rather than shell text" "" "$out"
assert_file_absent "hostile filename inspection executes no embedded text" "$hostile_path"

out="$(invoke build block "$TMP/workspace" "$(bash_event 'npm install')")"
assert_contains "Build blocks an unanchored package-manager mutation" "$out" \
  'Build shell mutations must start inside the isolated workspace'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && npm install")")"
assert_eq "Build permits a package-manager command anchored in its workspace" "" "$out"

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event 'npx prettier --write src')")"
assert_contains "Build blocks an unanchored formatter mutation" "$out" \
  'Build shell mutations must start inside the isolated workspace'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && npm run generate")")"
assert_eq "Build permits an anchored package script for the isolated workspace" "" "$out"

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && /usr/bin/touch inside.txt")")"
assert_eq "Build does not mistake an absolute executable for an output path" "" "$out"

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && cp \$SOURCE ./source")")"
assert_contains "Build blocks dynamic environment paths it cannot prove isolated" "$out" \
  'dynamic path that cannot be proven isolated'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && cp \$(pwd)/source ./source")")"
assert_contains "Build blocks command-substitution paths it cannot prove isolated" "$out" \
  'dynamic path that cannot be proven isolated'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && echo x > $TMP/outside/escaped.txt")")"
assert_contains "Build blocks an absolute redirection outside isolation" "$out" \
  'obvious path outside the isolated workspace'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && cp ../outside/source ./source")")"
assert_contains "Build blocks a relative shell escape from isolation" "$out" \
  'obvious path outside the isolated workspace'

for command in \
  "touch $TMP/outside/touched.txt" \
  "cp source $TMP/outside/copied.txt" \
  "mv source $TMP/outside/moved.txt" \
  "rm $TMP/outside/removed.txt"; do
  out="$(invoke build block "$TMP/workspace" \
    "$(bash_event "cd $TMP/workspace && $command")")"
  assert_contains "Build blocks an absolute filesystem operand outside isolation ($command)" \
    "$out" 'obvious path outside the isolated workspace'
done

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && cd $TMP/outside && touch escaped.txt")")"
assert_contains "Build blocks a later cwd escape from isolation" "$out" \
  'obvious path outside the isolated workspace'

out="$(invoke build block "$TMP/workspace" "$(write_event "")")"
assert_contains "Build blocks an empty mutation target" "$out" 'mutation target is missing or invalid'

out="$(invoke build block "$TMP/workspace" \
  '{"tool_name":"Write","tool_input":{"file_path":"bad\u0000path"}}')"
assert_contains "Build blocks a NUL mutation target" "$out" 'mutation target is missing or invalid'

ln -s "$TMP/outside" "$TMP/workspace/escape"
out="$(invoke build block "$TMP/workspace" "$(write_event "$TMP/workspace/escape/app.js")")"
assert_contains "Build resolves symlink escape before allowing" "$out" '"decision":"block"'

out="$(invoke build block "$TMP/workspace" \
  "$(bash_event "cd $TMP/workspace && touch escape/from-shell.txt")")"
assert_contains "Build resolves symlinked shell targets before containment" "$out" \
  'outside the isolated workspace'

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

out="$(invoke land block "" \
  "$(bash_event 'git add foundation.json && git commit -q -m chore-land')")"
assert_contains "Land does not infer commit authority" "$out" '"decision":"block"'

out="$(invoke land block "" "$(bash_event 'git push origin main')")"
assert_contains "Land does not infer push authority" "$out" '"decision":"block"'

out="$(invoke land block "" "$(bash_event 'git push --force origin main')")"
assert_contains "Land does not infer destructive push authority" "$out" '"decision":"block"'

out="$(invoke land block "" "$(bash_event 'git checkout -- src')")"
assert_contains "Land still refuses a tree-mutating git command" "$out" '"decision":"block"'
assert_contains "Land names the missing runtime authority" "$out" \
  'Land shell mutations require the runtime transaction marker'

out="$(invoke land block "" "$(bash_event 'git commit -m x && rm -rf build')")"
assert_contains "Land refuses delivery mixed with a tree mutation" "$out" '"decision":"block"'

out="$(invoke land block "" "$(bash_event 'sh -c cd-and-commit.sh')")"
assert_contains "Land refuses a mutation hidden inside a shell runner" "$out" '"decision":"block"'

# The operation screen blanks quoted spans before it reads command words, so a
# substitution inside a commit message arrived as whitespace and delivery saw
# only `git commit` while the shell still ran the removal.
out="$(invoke land block "" \
  "$(bash_event 'git commit -m \"$(rm -rf build)\"')")"
assert_contains "Land refuses delivery hiding a command substitution" \
  "$out" '"decision":"block"'

out="$(invoke prove audit "" "$(write_event "$TMP/project/src/app.js")")"
assert_eq "audit-only rollout does not block" "" "$out"
assert_file_contains "audit-only rollout records violation" "$TMP/project/.foundation/logs/guardrail-audit.jsonl" '"phase":"prove"'

out="$(printf '%s' "$(write_event "$TMP/project/src/app.js")" | CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_contains "block mode fails closed when phase context is missing" "$out" 'active phase is unavailable'

# `change start` is the atomic creation path, so its versioned input draft must
# be writable before a phase exists. Keep this bootstrap capability confined to
# one direct .foundation JSON filename; product paths, nested paths, loose
# names, and shell redirects remain denied.
out="$(printf '%s' "$(write_event "$TMP/project/.foundation/change-start-fix-window.json")" |
  CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_eq "pre-phase atomic Change draft is writable" "" "$out"

out="$(printf '%s' "$(write_event "$TMP/project/.foundation/drafts/change-start-fix.json")" |
  CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_eq "pre-phase semantic draft is writable" "" "$out"

for target in \
  "$TMP/project/.foundation/change-start-.json" \
  "$TMP/project/.foundation/change-start-Fix.json" \
  "$TMP/project/.foundation/drafts/Change-start-fix.json" \
  "$TMP/project/.foundation/change-start-fix.yaml"; do
  out="$(printf '%s' "$(write_event "$target")" |
    CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
  assert_contains "pre-phase draft capability rejects $target" "$out" 'active phase is unavailable'
done

out="$(printf '%s' "$(bash_event 'echo x > .foundation/change-start-fix.json')" |
  CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_contains "pre-phase draft capability never permits shell mutation" \
  "$out" 'active phase is unavailable'

out="$(printf '%s' "$(bash_event 'git status')" | CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_eq "read-only shell commands do not require phase context" "" "$out"

out="$(printf '%s' "$(write_event "$TMP/project/src/app.js")" |
  CLAUDE_PROJECT_DIR="$TMP/project" FOUNDATION_ACTIVE_PHASE=prove node "$HOOK")"
assert_contains "default auto mode blocks an active lifecycle phase" \
  "$out" '"decision":"block"'

out="$(printf '%s' "$(write_event "$TMP/outside/adoption.js")" |
  CLAUDE_PROJECT_DIR="$TMP/outside" node "$HOOK")"
assert_eq "default auto mode stays out of adoption-only sessions" "" "$out"

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

assert_cmd_zero "guardrail mode off resolves without starting Node" \
  pre_isolated off "$(write_event "$TMP/pre/src/app.js")"

out="$(pre audit "" "$(write_event "$TMP/pre/src/app.js")")"
assert_eq "audit mode delegates event-local transcript detection to the guard" "" "$out"

# /dev opts into the lifecycle. Its transcript makes even an explicit audit
# rollout enforce from the first mutation, before a phase packet has been read.
printf '%s\n' '{"type":"last-prompt","lastPrompt":"/dev --yes build it"}' \
  > "$TMP/dev-transcript.jsonl"
out="$(printf '%s' "$(write_event "$TMP/pre/src/app.js")" |
  CLAUDE_PROJECT_DIR="$TMP/pre" FOUNDATION_GUARDRAIL_MODE=audit \
  FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$TMP/dev-transcript.jsonl" sh "$PREFILTER")"
assert_contains "a dev session fails closed before its first phase packet" \
  "$out" 'active phase is unavailable'

# The real Claude PreToolUse schema carries transcript_path on the event. A
# claude -p hook process may not inherit SessionStart's CLAUDE_ENV_FILE export,
# so event-local identity must enforce /dev on its own.
event_with_transcript="{\"transcript_path\":\"$TMP/dev-transcript.jsonl\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/pre/src/app.js\"}}"
out="$(printf '%s' "$event_with_transcript" |
  CLAUDE_PROJECT_DIR="$TMP/pre" FOUNDATION_GUARDRAIL_MODE=audit sh "$PREFILTER")"
assert_contains "a dev PreToolUse event enforces without exported transcript env" \
  "$out" 'active phase is unavailable'

out="$(pre block "" "$(write_event "$TMP/pre/src/app.js")")"
assert_contains "block mode delegates even when no phase is recorded" \
  "$out" 'active phase is unavailable'

out="$(pre audit prove "$(write_event "$TMP/pre/src/app.js")")"
assert_eq "an exported phase delegates and audit mode still does not block" "" "$out"
assert_file_contains "an exported phase reaches the guard through the prefilter" \
  "$TMP/pre/.foundation/logs/guardrail-audit.jsonl" '"phase":"prove"'

# A recorded Build phase can recover its workspace from runtime state; Claude
# Code hook processes do not need a manually exported workspace variable.
mkdir -p "$TMP/buildpre/.foundation/logs/build-change" "$TMP/buildpre/.foundation/runtime" \
  "$TMP/buildpre/.foundation/sandboxes/build-change/src" \
  "$TMP/buildpre/openspec/changes/build-change"
printf '{"timestamp":"%s","phase":"build","changeId":"build-change"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$TMP/buildpre/.foundation/logs/build-change/phase-context.jsonl"
printf '{"workspace":{"path":"%s"}}\n' \
  "$TMP/buildpre/.foundation/sandboxes/build-change" \
  > "$TMP/buildpre/.foundation/runtime/build-change.json"
out="$(printf '%s' "$(write_event "$TMP/buildpre/.foundation/sandboxes/build-change/src/app.js")" |
  CLAUDE_PROJECT_DIR="$TMP/buildpre" FOUNDATION_GUARDRAIL_MODE=block node "$HOOK")"
assert_eq "Build derives the recorded sandbox when the host exports no workspace" "" "$out"

# Logs outlive their change. A fixture change left a fresh `building` row with
# no workspace in a real repository, and because it was the newest row every
# session there was refused every mutation until it aged out — for work that had
# nothing to do with it. Only an active OpenSpec change may govern.
mkdir -p "$TMP/orphan/.foundation/logs/gone" "$TMP/orphan/.foundation/logs/live" \
  "$TMP/orphan/openspec/changes/live" "$TMP/orphan/src"
printf '{"timestamp":"%s","phase":"build","changeId":"gone"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$TMP/orphan/.foundation/logs/gone/phase-context.jsonl"
out="$(printf '%s' "$(write_event "$TMP/orphan/src/app.js")" |
  CLAUDE_PROJECT_DIR="$TMP/orphan" node "$HOOK")"
assert_eq "an orphaned change's phase row does not govern the session" "" "$out"

printf '{"timestamp":"%s","phase":"prove","changeId":"live"}\n' \
  "$(date -u -r "$(($(date +%s) - 3600))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null ||
    date -u -d '@'"$(($(date +%s) - 3600))" '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$TMP/orphan/.foundation/logs/live/phase-context.jsonl"
out="$(printf '%s' "$(write_event "$TMP/orphan/src/app.js")" |
  CLAUDE_PROJECT_DIR="$TMP/orphan" node "$HOOK")"
assert_contains "an older active change still governs past a newer orphan" \
  "$out" 'Prove keeps product and instruction files read-only'

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
