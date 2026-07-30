#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

if command -v jq >/dev/null 2>&1; then
  blocked="$(printf '%s' '{"tool_name":"Read","tool_input":{"file_path":".env"}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_contains "secret hook blocks dotenv reads" "$blocked" '"decision": "block"'

  allowed="$(printf '%s' '{"tool_name":"Read","tool_input":{"file_path":".env.example"}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_eq "secret hook allows templates" "" "$allowed"

  assert_cmd_zero "opt-in direct-main hook self-test" \
    bash "$ROOT/.claude/hooks/no-direct-main-commit.sh" --self-test
else
  pass "hook behavior skipped without jq (hooks intentionally fail open)"
fi

event='{"tool_name":"Write","tool_input":{"file_path":"/not/a/project/file.js"}}'
assert_cmd_zero "lint hook safely ignores files outside project" \
  sh -c 'printf "%s" "$1" | CLAUDE_PROJECT_DIR="$2" bash "$3"' \
  _ "$event" "$ROOT" "$ROOT/.claude/hooks/lint.sh"

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT HUP INT TERM
session='{"session_id":"session-123","transcript_path":"/tmp/project session/session-123.jsonl"}'
assert_cmd_zero "session lifecycle exposes transcript identity to later checkpoints" \
  sh -c 'printf "%s" "$1" | CLAUDE_PROJECT_DIR="$2" CLAUDE_ENV_FILE="$3" sh "$4"' \
  _ "$session" "$ROOT" "$ENV_FILE" "$ROOT/.claude/hooks/session-context.sh"
assert_file_contains "session hook exports only the session identity" \
  "$ENV_FILE" "FOUNDATION_CLAUDE_SESSION_ID='session-123'"
assert_file_contains "session hook preserves transcript paths with spaces" \
  "$ENV_FILE" "FOUNDATION_CLAUDE_TRANSCRIPT_PATH='/tmp/project session/session-123.jsonl'"

finish "current hooks"
