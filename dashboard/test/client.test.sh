#!/usr/bin/env bash

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
export CF_DASHBOARD_TEST_MODE=1
export CLAUDE_FOUNDATION_STATE="$TMP/state"
set -- run
. "$ROOT/dashboard/client.sh"

escaped="$(json_escape $'line\nquote"tab\tend')"
assert_cmd_zero "client JSON escaping handles controls" \
  node -e 'JSON.parse(process.argv[1])' "\"$escaped\""

mkdir -p "$TMP/repo"
git -C "$TMP/repo" init -q -b main
git -C "$TMP/repo" config user.name test
git -C "$TMP/repo" config user.email test@example.invalid
printf 'base\n' > "$TMP/repo/base.txt"
git -C "$TMP/repo" add .
git -C "$TMP/repo" commit -qm base
git -C "$TMP/repo" remote add origin "$TMP/repo"
git -C "$TMP/repo" update-ref refs/remotes/origin/main HEAD
git -C "$TMP/repo" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
git -C "$TMP/repo" checkout -qb feature
printf 'committed feature work\n' > "$TMP/repo/feature.txt"
git -C "$TMP/repo" add .
git -C "$TMP/repo" commit -qm feature
base="$(diff_base "$TMP/repo")"
assert_eq "diff baseline retains committed branch work" "feature.txt" \
  "$(git -C "$TMP/repo" diff --name-only "$base")"

mkdir -p "$CLAUDE_FOUNDATION_STATE"
sleep 30 & sleeper=$!
printf '%s\n' "$sleeper" > "$PIDFILE"
if is_running; then fail "PID without matching start identity is rejected"
else pass "PID without matching start identity is rejected"; fi
kill "$sleeper"
wait "$sleeper" 2>/dev/null || true

AGENT_ID=test-agent GIT_USER=test GIT_EMAIL='' HOST=test RUNS_JSON='[]' PRS_JSON='[]'
CHANGES_JSON="$(node -e 'process.stdout.write(JSON.stringify([{repoId:"r",files:[{path:"large",ranges:Array.from({length:500},(_,i)=>[i,i])}]}]))')"
USAGE_JSON='[]'; SESSIONS_JSON='[]'; TOOLS_JSON='[]'; MAX_PAYLOAD_BYTES=500
bounded="$(bounded_payload online 2>/dev/null)"
assert_cmd_zero "oversize payload falls back to valid presence JSON" \
  node -e 'const p=JSON.parse(process.argv[1]);if(p.changes.length!==1||p.changes[0].files.length)process.exit(1)' "$bounded"

mkdir -p "$TMP/claude/projects/demo"
printf '%s\n' \
  '{"type":"assistant","timestamp":"2026-08-02T01:00:00Z","cwd":"/work/demo","message":{"id":"fallback-1","role":"assistant","model":"claude-sonnet-test","usage":{"input_tokens":5,"output_tokens":1},"content":[{"type":"tool_use","id":"t1","name":"Read"}]}}' \
  > "$TMP/claude/projects/demo/session.jsonl"
CLAUDE_CONFIG_DIR="$TMP/claude"; export CLAUDE_CONFIG_DIR
SCRIPT_PATH="$TMP/no-helper/client.sh"
# This assertion exercises the portable parser, not retention. Keep the fixed
# fixture inside the scan window so the test does not expire with wall time.
USAGE_CACHE="$TMP/fallback-usage.json"; USAGE_DAYS=36500; USAGE_INTERVAL=1
scan_usage
assert_cmd_zero "portable usage fallback emits valid dated aggregates" node -e \
  'const u=JSON.parse(process.argv[1]),t=JSON.parse(process.argv[2]);if(u[0].input!==5||t[0].date!=="2026-08-02")process.exit(1)' \
  "$USAGE_JSON" "$TOOLS_JSON"

mkdir -p "$TMP/current/openspec" "$TMP/current/.claude/harness" \
  "$TMP/current/.foundation/runtime" "$TMP/legacy/.workflow/0001-demo"
printf 'schema: foundation-standard\n' > "$TMP/current/openspec/config.yaml"
printf 'export {};\n' > "$TMP/current/.claude/harness/foundation.mjs"
printf '%s\n' \
  '{"version":2,"id":"current-change","schema":"foundation-standard","status":"building","createdAt":"2026-08-01T00:00:00Z","updatedAt":"2026-08-02T00:00:00Z"}' \
  > "$TMP/current/.foundation/runtime/current-change.json"
printf '%s\n' '{broken' > "$TMP/current/.foundation/runtime/broken.json"
printf '%s\n' \
  '{"id":"0001-demo","type":"feature","phase":"done","step":"done","repo_root":"'"$TMP"'/legacy"}' \
  > "$TMP/legacy/.workflow/0001-demo/state.json"
SCAN_ROOTS=("$TMP/current" "$TMP/legacy")
SCAN_DEPTH=6; DISCOVERY_INTERVAL=0
RUN_PATH_CACHE="$TMP/run-paths-current.txt"; GIT_PATH_CACHE="$TMP/git-paths-current.txt"
RUNS_SOURCE_SCHEMA=none; RUNS_FOUNDATION_VERSION=unknown
scan_runs
assert_cmd_zero "dashboard scan reads current snapshots and legacy fallback" node -e \
  'const r=JSON.parse(process.argv[1]);if(!r.some(x=>x.id==="current-change")||!r.some(x=>x.id==="0001-demo"))process.exit(1)' \
  "$RUNS_JSON"
assert_eq "current and legacy source schemas are reported" \
  "foundation-runtime-v2+legacy-workflow" "$RUNS_SOURCE_SCHEMA"
assert_cmd_zero "malformed current state is isolated" node -e \
  'const r=JSON.parse(process.argv[1]);if(r.some(x=>x.id==="broken"))process.exit(1)' "$RUNS_JSON"

snapshot_cli="$("$ROOT/cli.sh" --project "$TMP/current" dashboard snapshot --json)"
assert_cmd_zero "public dashboard snapshot route emits valid JSON" node -e \
  'const s=JSON.parse(process.argv[1]);if(s.schemaVersion!==2||s.runs[0].id!=="current-change")process.exit(1)' \
  "$snapshot_cli"

# The scans run detached, so anything they derive reaches the heartbeat only via
# a cache file. Stub the scans that need network or a full repo walk; scan_runs
# (asserted above) is the one that produces the metadata under test.
scan_changes() { CHANGES_JSON='[]'; }
scan_usage() { USAGE_JSON='[]'; SESSIONS_JSON='[]'; TOOLS_JSON='[]'; }
scan_prs() { PRS_JSON='[]'; }
RUNS_CACHE="$TMP/runs.json"; CHG_CACHE="$TMP/changes.json"
RUNS_META_CACHE="$TMP/runs-meta.txt"; SCAN_LOCK="$TMP/scan.lock"
( run_scans_to_cache )
RUNS_SOURCE_SCHEMA=lost; RUNS_FOUNDATION_VERSION=lost
load_cache
assert_eq "background scan publishes source schema to the beating parent" \
  "foundation-runtime-v2+legacy-workflow" "$RUNS_SOURCE_SCHEMA"
assert_eq "background scan publishes foundation version to the beating parent" \
  "$(cat "$ROOT/VERSION")" "$RUNS_FOUNDATION_VERSION"

finish "dashboard client"
