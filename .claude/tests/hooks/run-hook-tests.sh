#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

if command -v jq >/dev/null 2>&1; then
  SECRETS="$ROOT/.claude/hooks/protect-secrets.sh"
  SECRET_DIR="$(mktemp -d)"
  printf 'API_KEY=hunter2\n# retired: oldkey\nDB_URL=postgres://u:p@h/db\n' > "$SECRET_DIR/.env"
  secret_event() { printf '{"cwd":"%s","tool_name":"%s","tool_input":%s}' "$SECRET_DIR" "$1" "$2"; }

  # The guard never refuses: a secret read is pointed at a redacted copy that
  # keeps every key and the layout, and no value reaches the model.
  shown="$(secret_event Read "{\"file_path\":\"$SECRET_DIR/.env\"}" | bash "$SECRETS")"
  assert_not_contains "secret hook never refuses a dotenv read" "$shown" '"decision"'
  copy="$(printf '%s' "$shown" | jq -r '.hookSpecificOutput.updatedInput.file_path')"
  assert_file_contains "the redacted copy keeps the key" "$copy" 'API_KEY=<redacted>'
  assert_file_not_contains "the redacted copy withholds the value" "$copy" 'hunter2'
  assert_file_not_contains "the redacted copy withholds a commented-out key" "$copy" 'oldkey'
  assert_contains "the redirect tells the agent how to change the real file" "$shown" 'ask the user'

  for command in 'cat .env' 'cat \".env\"' "cat '.env'"; do
    out="$(secret_event Bash "{\"command\":\"$command\"}" | bash "$SECRETS")"
    assert_contains "secret hook reads the redacted copy for: $command" "$out" 'claude-foundation-redacted'
    assert_not_contains "secret hook never refuses: $command" "$out" '"decision"'
  done

  absent="$(printf '%s' '{"tool_name":"Read","tool_input":{"file_path":"/nonexistent/.env"}}' | bash "$SECRETS")"
  assert_eq "a missing secret file passes through to the tool's own error" "" "$absent"

  allowed="$(printf '%s' '{"tool_name":"Read","tool_input":{"file_path":".env.example"}}' | bash "$SECRETS")"
  assert_eq "secret hook allows templates" "" "$allowed"

  message="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix: cat .env handling\""}}' | bash "$SECRETS")"
  assert_eq "secret hook still exempts secret names inside prose strings" "" "$message"

  docs_search="$(printf '%s' '{"tool_name":"Grep","tool_input":{"path":"docs","glob":"*.md","pattern":"password","output_mode":"content"}}' | bash "$SECRETS")"
  assert_eq "secret hook allows docs-scoped content search for credential-shaped words" "" "$docs_search"

  # A content search that could reach secret files is scoped away from them,
  # or limited to file names, instead of refused.
  unscoped="$(printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"password","output_mode":"content"}}' | bash "$SECRETS")"
  assert_contains "an unscoped credential search skips secret files" "$unscoped" '"glob":"!{**/.env'
  # The exclusion must cover every file name is_secret_path treats as secret,
  # or a content search still prints those values.
  if command -v rg >/dev/null 2>&1; then
    GLOB_DIR="$(mktemp -d)"
    mkdir -p "$GLOB_DIR/.ssh" "$GLOB_DIR/.gnupg"
    for name in .env .pypirc _netrc .htpasswd .dockercfg auth.json id_rsa id_ed25519 \
      app.ppk vault.kdbx release.jks svc-key.json my-service-account.json \
      .ssh/deploy .gnupg/private.txt; do
      printf 'password=leaked\n' > "$GLOB_DIR/$name"
      is_secret="$(printf '{"tool_name":"Read","tool_input":{"file_path":"%s"}}' "$GLOB_DIR/$name" | bash "$SECRETS")"
      assert_contains "is_secret_path treats $name as secret" "$is_secret" 'redacted'
    done
    printf 'const password = input;\n' > "$GLOB_DIR/app.ts"
    exclusion="$(printf '%s' "$unscoped" | jq -r '.hookSpecificOutput.updatedInput.glob')"
    found="$(rg --hidden --no-ignore -n -g "$exclusion" password "$GLOB_DIR" || true)"
    assert_not_contains "the rewritten search prints no secret-file line" "$found" 'leaked'
    assert_contains "the rewritten search still reads ordinary code" "$found" 'app.ts'
    rm -rf "$GLOB_DIR"
  fi
  broad="$(printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"password","glob":"**/*","output_mode":"content"}}' | bash "$SECRETS")"
  assert_contains "a broad-glob credential search lists file names only" "$broad" '"output_mode":"files_with_matches"'
  targeted="$(printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"x","glob":"**/.env*","output_mode":"content"}}' | bash "$SECRETS")"
  assert_contains "a secret-file glob lists file names only" "$targeted" '"output_mode":"files_with_matches"'

  for event in \
    '{"tool_name":"Bash","tool_input":{"command":"rg -n process.env src"}}' \
    '{"tool_name":"Bash","tool_input":{"command":"grep -rn \\"import.meta.env\\" src"}}' \
    '{"tool_name":"Grep","tool_input":{"pattern":"password","glob":"*.ts","output_mode":"content"}}' \
    '{"tool_name":"Grep","tool_input":{"pattern":"secret","type":"py","output_mode":"content"}}'; do
    assert_eq "secret hook allows ordinary code search: $event" "" \
      "$(printf '%s' "$event" | bash "$SECRETS")"
  done

  # A host that explicitly asks for refusals keeps them.
  strict="$(secret_event Read "{\"file_path\":\"$SECRET_DIR/.env\"}" | FOUNDATION_SECRETS_GUARD=block bash "$SECRETS")"
  assert_contains "strict secrets mode still refuses" "$strict" '"decision": "block"'
  assert_not_contains "strict refusal does not recommend disabling itself" "$strict" "temporarily disable the hook"
  rm -rf "$SECRET_DIR"

  assert_cmd_zero "detached authority run is rewritten to run attached" \
    node --test "$ROOT/.claude/tests/hooks/no-detached-authority.test.mjs"

  assert_cmd_zero "opt-in direct-main hook self-test" \
    bash "$ROOT/.claude/hooks/no-direct-main-commit.sh" --self-test
else
  pass "hook behavior skipped without jq (hooks intentionally fail open)"
fi

event='{"tool_name":"Write","tool_input":{"file_path":"/not/a/project/file.js"}}'
assert_cmd_zero "lint hook safely ignores files outside project" \
  sh -c 'printf "%s" "$1" | CLAUDE_PROJECT_DIR="$2" bash "$3"' \
  _ "$event" "$ROOT" "$ROOT/.claude/hooks/lint.sh"

if command -v gofmt >/dev/null 2>&1; then
  GO_DIR="$(mktemp -d)"
  printf 'package main\nfunc main(){x:=1;_=x}\n' > "$GO_DIR/main.go"
  assert_cmd_zero "lint hook formats Go itself instead of returning the diff" \
    sh -c 'printf "%s" "$1" | CLAUDE_PROJECT_DIR="$2" bash "$3"' \
    _ "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$GO_DIR/main.go\"}}" "$GO_DIR" \
    "$ROOT/.claude/hooks/lint.sh"
  assert_eq "gofmt rewrote the file" "" "$(gofmt -l "$GO_DIR/main.go")"
  rm -rf "$GO_DIR"
fi

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

assert_file_not_contains "session hook adds no PATH entry without an installed CLI shim" \
  "$ENV_FILE" "export PATH="

# A source-checkout install has no global `claude-foundation`; the hook puts
# the installer's project-local shim on PATH, and only when nothing resolves.
SHIM_PROJECT="$(mktemp -d)"
trap 'rm -f "$ENV_FILE"; rm -rf "$SHIM_PROJECT"' EXIT HUP INT TERM
mkdir -p "$SHIM_PROJECT/.foundation/bin" "$SHIM_PROJECT/global" "$SHIM_PROJECT/stale"
touch "$SHIM_PROJECT/.foundation/bin/claude-foundation" "$SHIM_PROJECT/global/claude-foundation" \
  "$SHIM_PROJECT/stale/claude-foundation"
chmod +x "$SHIM_PROJECT/global/claude-foundation"
NODE_DIR="$(dirname "$(command -v node)")"
: > "$ENV_FILE"
printf '%s' "$session" | CLAUDE_PROJECT_DIR="$SHIM_PROJECT" CLAUDE_ENV_FILE="$ENV_FILE" \
  PATH="$NODE_DIR:/usr/bin:/bin" node "$ROOT/.claude/hooks/session-context.mjs" >/dev/null
assert_file_contains "session hook puts the installed CLI shim on PATH" \
  "$ENV_FILE" "export PATH='$SHIM_PROJECT/.foundation/bin':\"\$PATH\""
: > "$ENV_FILE"
printf '%s' "$session" | CLAUDE_PROJECT_DIR="$SHIM_PROJECT" CLAUDE_ENV_FILE="$ENV_FILE" \
  PATH="$SHIM_PROJECT/global:$NODE_DIR:/usr/bin:/bin" node "$ROOT/.claude/hooks/session-context.mjs" >/dev/null
assert_file_not_contains "session hook keeps a CLI already on PATH first" \
  "$ENV_FILE" "export PATH="
: > "$ENV_FILE"
printf '%s' "$session" | CLAUDE_PROJECT_DIR="$SHIM_PROJECT" CLAUDE_ENV_FILE="$ENV_FILE" \
  PATH="$SHIM_PROJECT/stale:$NODE_DIR:/usr/bin:/bin" node "$ROOT/.claude/hooks/session-context.mjs" >/dev/null
assert_file_contains "session hook ignores a non-executable CLI on PATH" \
  "$ENV_FILE" "export PATH='$SHIM_PROJECT/.foundation/bin':\"\$PATH\""

finish "current hooks"
