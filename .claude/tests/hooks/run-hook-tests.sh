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

  # Quoting a path is a common accidental shape; blanking quoted spans wholesale
  # let `cat ".env"` through while `cat .env` was caught. Single plain words in
  # quotes must survive dequoting; prose strings must still be exempt.
  quoted="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"cat \".env\""}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_contains "secret hook catches a double-quoted secret path" "$quoted" '"decision": "block"'

  quoted_single="$(printf '%s' "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat '.env'\"}}" |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_contains "secret hook catches a single-quoted secret path" "$quoted_single" '"decision": "block"'

  message="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix: cat .env handling\""}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_eq "secret hook still exempts secret names inside prose strings" "" "$message"

  # A content-mode Grep glob-scoped to "*.md" can never match a .env or
  # credential file, so searching docs for mentions of example variable names
  # like "password" or "API_KEY" is safe documentation work, not exfiltration.
  docs_search="$(printf '%s' '{"tool_name":"Grep","tool_input":{"path":"docs","glob":"*.md","pattern":"password","output_mode":"content"}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_eq "secret hook allows docs-scoped content search for credential-shaped words" "" "$docs_search"

  # The same pattern with no glob (or a glob that can still hit real secret
  # files) is a genuine repo-wide leak risk and must stay blocked.
  unscoped_search="$(printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"password","output_mode":"content"}}' |
    bash "$ROOT/.claude/hooks/protect-secrets.sh")"
  assert_contains "secret hook still blocks unscoped content search for credential-shaped words" "$unscoped_search" '"decision": "block"'

  assert_cmd_zero "opt-in direct-main hook self-test" \
    bash "$ROOT/.claude/hooks/no-direct-main-commit.sh" --self-test
else
  pass "hook behavior skipped without jq (hooks intentionally fail open)"
fi

DEV_TRANSCRIPT="$(mktemp)"
printf '%s\n' '{"type":"last-prompt","lastPrompt":"/dev create app todolist"}' > "$DEV_TRANSCRIPT"
blocked_runtime="$(printf '%s' "{\"transcript_path\":\"$DEV_TRANSCRIPT\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\".claude/harness/runtime/workflow/change-validation.mjs\"}}" |
  sh "$ROOT/.claude/hooks/authoring-surface-guard.sh")"
assert_contains "dev authoring guard blocks managed runtime reads" \
  "$blocked_runtime" '"decision":"block"'
blocked_hook="$(printf '%s' "{\"transcript_path\":\"$DEV_TRANSCRIPT\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"sed -n 1,80p .claude/hooks/phase-mutation-guard.mjs\"}}" |
  sh "$ROOT/.claude/hooks/authoring-surface-guard.sh")"
assert_contains "dev authoring guard blocks managed hook archaeology" \
  "$blocked_hook" '"decision":"block"'
allowed_public="$(printf '%s' "{\"transcript_path\":\"$DEV_TRANSCRIPT\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\".claude/harness/EVIDENCE.md\"}}" |
  sh "$ROOT/.claude/hooks/authoring-surface-guard.sh")"
assert_eq "dev authoring guard allows public operator references" "" "$allowed_public"
allowed_non_dev="$(printf '%s' '{"tool_name":"Read","tool_input":{"file_path":".claude/harness/runtime/workflow/change-validation.mjs"}}' |
  sh "$ROOT/.claude/hooks/authoring-surface-guard.sh")"
assert_eq "authoring guard leaves non-dev sessions unchanged" "" "$allowed_non_dev"
rm -f "$DEV_TRANSCRIPT"

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

# The hook is named session-*context* but carried only telemetry identity, so a
# fresh context started blind on every startup, resume, clear, and compact.
# Digest content is pinned in harness/run-next-step-tests.mjs; what this suite
# owns is that the wired hook still emits it, and that adding stdout did not
# disturb the env-file contract asserted below.
session_stdout="$(printf '%s' "$session" |
  CLAUDE_PROJECT_DIR="$ROOT" CLAUDE_ENV_FILE="$ENV_FILE" sh "$ROOT/.claude/hooks/session-context.sh")"
assert_contains "session hook volunteers workflow position as SessionStart context" \
  "$session_stdout" '"hookEventName":"SessionStart"'
assert_contains "session hook digest names the loop it reports on" \
  "$session_stdout" 'Foundation:'
assert_file_contains "session hook exports only the session identity" \
  "$ENV_FILE" "FOUNDATION_CLAUDE_SESSION_ID='session-123'"
assert_file_contains "session hook preserves transcript paths with spaces" \
  "$ENV_FILE" "FOUNDATION_CLAUDE_TRANSCRIPT_PATH='/tmp/project session/session-123.jsonl'"

finish "current hooks"
