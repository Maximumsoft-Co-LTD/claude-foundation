#!/usr/bin/env sh
# Large multi-repository change packets fit the default packet budgets.
#
# Replays the semantic draft of a real three-repository API-keys change (root
# project, a Git submodule, and a writable sibling checkout; three tasks with
# 10, 4, and 20 claims; standard lane with design.md) through Change and the
# Build boundary, writes the ~22 product paths the real run changed, and
# measures every packet scope. Each packet must render without BLOCKED and
# keep headroom under the default budget; an oversize packet still blocks with
# the largest-fields diagnostic, and a completed task renders a read-only
# packet instead of "unknown pending task".

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
. "$ROOT/.claude/tests/lib/harness-fixture.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
export GIT_AUTHOR_NAME="Foundation Test" GIT_AUTHOR_EMAIL="foundation@example.invalid"
export GIT_COMMITTER_NAME="Foundation Test" GIT_COMMITTER_EMAIL="foundation@example.invalid"
export GIT_CONFIG_NOSYSTEM=1
unset FOUNDATION_CLAUDE_SESSION_ID 2>/dev/null || true
DRAFT="$HERE/fixtures/large-change/api-keys.draft.json"

assert_cmd_fail() { # <label> <cmd> [args...]: expect a non-zero exit.
  _label="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$_label - command succeeded: $*"; else pass "$_label"; fi
}

seed_package() { # <dir> <name>
  mkdir -p "$1/src" "$1/test"
  printf '{"name":"%s","private":true,"type":"module","scripts":{"test":"node test/smoke.test.js"}}\n' \
    "$2" > "$1/package.json"
  printf '# %s\n' "$2" > "$1/README.md"
  printf 'export const name = "%s";\n' "$2" > "$1/src/index.js"
  printf 'import "../src/index.js";\n' > "$1/test/smoke.test.js"
}

for repo in users sdk; do
  seed_package "$TMP/$repo" "$repo"
  git -C "$TMP/$repo" init -q -b main
  git -C "$TMP/$repo" add -A
  git -C "$TMP/$repo" -c commit.gpgsign=false commit -qm "$repo baseline"
done

PROJECT="$TMP/gateway"
seed_package "$PROJECT" gateway
for file in auth config logger main server; do
  printf 'export const %s = true;\n' "$file" > "$PROJECT/src/$file.js"
done
mkdir -p "$PROJECT/docs" "$PROJECT/.claude/harness" "$PROJECT/openspec" "$PROJECT/.foundation"
printf '# API keys\n\nRevocable, scoped, rate-limited API keys.\n' > "$PROJECT/docs/API-KEYS.md"
install_harness_fixture "$ROOT" "$PROJECT"
cp "$ROOT/.claude/harness/commands.json" "$PROJECT/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$PROJECT/openspec/"
cp "$ROOT/openspec/config.yaml" "$PROJECT/openspec/"
cp "$ROOT/.foundation/.gitignore" "$PROJECT/.foundation/"
# Drop the seeded packet budgets so the runtime defaults are what is measured.
jq 'del(.execution.packetBytes) | .telemetry.requireUsage = false' \
  "$ROOT/foundation.json" > "$PROJECT/foundation.json"
printf '%s\n' '{"version":1,"repositories":[' \
  '  {"id":"users","type":"submodule","path":"services/users","mode":"write"},' \
  '  {"id":"sdk","type":"git","path":"../sdk","mode":"write","allowOutsideRoot":true}' \
  ']}' > "$PROJECT/openspec/repositories.yaml"
cd "$PROJECT"
git init -q -b main
git -c protocol.file.allow=always submodule add -q "$TMP/users" services/users
git add -A
git -c commit.gpgsign=false commit -qm "gateway baseline"

RUNTIME=".claude/harness/foundation.mjs"
mkdir -p .foundation/drafts
cp "$DRAFT" .foundation/drafts/api-keys.json
node "$RUNTIME" start .foundation/drafts/api-keys.json >/dev/null
ID="$(ls openspec/changes | grep -v '^archive$' | head -1)"
assert_cmd_zero "large draft compiles a standard change with design.md" \
  test -f "openspec/changes/$ID/design.md"
assert_cmd_zero "large change advances to the Build boundary" \
  node "$RUNTIME" advance "$ID" --approve-spec --decision-ref large-packet-test --through build

SANDBOX=".foundation/sandboxes/$ID"
REPO_SANDBOXES=".foundation/repository-sandboxes/$ID"
assert_cmd_zero "root build workspace exists" test -d "$SANDBOX/src"
assert_cmd_zero "submodule build workspace exists" test -d "$REPO_SANDBOXES/users/src"
assert_cmd_zero "sibling build workspace exists" test -d "$REPO_SANDBOXES/sdk/src"

# The real run's changed surface: 10 root, 6 submodule, and 6 sibling paths.
write_paths() { # <workspace> <path>...
  workspace="$1"; shift
  for path in "$@"; do
    mkdir -p "$workspace/$(dirname "$path")"
    printf '// changed for api keys: %s\n' "$path" >> "$workspace/$path"
  done
}
write_paths "$SANDBOX" README.md src/auth.js src/config.js src/logger.js src/main.js \
  src/server.js test/config-router.test.js src/rate-limit.js src/routes/api-keys.js \
  test/api-keys.test.js
write_paths "$REPO_SANDBOXES/users" README.md src/index.js src/store.js src/users.js \
  src/apikeys.js test/apikeys.test.js
write_paths "$REPO_SANDBOXES/sdk" README.md src/errors.js src/http.js src/index.js \
  src/api-keys.js test/api-keys.test.js

# packet <label> <limit> <args...>: renders without BLOCKED and keeps >=20%
# headroom under the default budget for this measured realistic change.
check_packet() {
  label="$1"; limit="$2"; shift 2
  if output="$(node "$RUNTIME" packet "$ID" "$@" 2>"$TMP/packet.err")"; then
    bytes="$(printf '%s' "$output" | wc -c | tr -d ' ')"
    if grep -q BLOCKED "$TMP/packet.err"; then
      fail "$label packet renders without BLOCKED"
    else
      pass "$label packet renders without BLOCKED ($bytes bytes)"
    fi
    if [ "$bytes" -le $((limit * 4 / 5)) ]; then
      pass "$label packet keeps headroom under $limit bytes ($bytes)"
    else
      fail "$label packet keeps headroom under $limit bytes ($bytes)"
    fi
  else
    fail "$label packet renders without BLOCKED: $(head -c 300 "$TMP/packet.err")"
  fi
}
check_packet "task T001 (10 claims)" 20480 --task T001
check_packet "task T002 (4 claims)" 20480 --task T002
check_packet "task T003 (20 claims)" 20480 --task T003
check_packet "global" 32768
check_packet "global build-phase" 32768 --phase build
check_packet "global prove-phase" 32768 --phase prove
check_packet "root repository" 24576 --repo root
check_packet "submodule repository" 24576 --repo users
check_packet "sibling repository" 24576 --repo sdk
check_packet "review" 20480 --phase review
assert_cmd_fail "review packet is not truncated" grep -q truncated "$TMP/packet.err"

# A completed task is read-only context, not an unknown pending task.
TASKS="$SANDBOX/openspec/changes/$ID/tasks.md"
sed 's/^- \[ \] \*\*T002\*\*/- [x] **T002**/' "$TASKS" > "$TMP/tasks.md"
cp "$TMP/tasks.md" "$TASKS"
completed="$(node "$RUNTIME" packet "$ID" --task T002 2>"$TMP/packet.err" || true)"
assert_cmd_zero "completed task packet renders read-only" sh -c \
  'printf "%s" "$1" | jq -e ".packetType == \"task\" and .executionAuthority.status == \"completed\" and .executionAuthority.readOnly == true and (.tasks | tostring | test(\"\\\"done\\\":true\"))"' _ "$completed"
assert_cmd_fail "completed task is not reported as unknown pending task" \
  grep -q "unknown pending task" "$TMP/packet.err"
assert_cmd_fail "unknown task still blocks" node "$RUNTIME" packet "$ID" --task T999

# Oversize beyond the new ceiling still blocks with the largest-fields diagnostic.
# Task text is capped at 1,000 characters, so inflate the uncapped resource
# annotations: 20 resources of ~1,100 bytes exceed the 20 KiB task ceiling.
filler="$(node -e 'process.stdout.write(Array.from({ length: 20 },
  (_, i) => `resource-${i}-` + "x".repeat(1100)).join(","))')"
sed "s/^\(- \[ \] \*\*T003\*\* .*\)$/\1 [resources:$filler]/" "$TASKS" > "$TMP/tasks.md"
cp "$TMP/tasks.md" "$TASKS"
if node "$RUNTIME" packet "$ID" --task T003 >/dev/null 2>"$TMP/packet.err"; then
  fail "oversize task packet blocks at the default ceiling"
else
  assert_contains "oversize task packet blocks at the default ceiling" \
    "$(cat "$TMP/packet.err")" "task packet exceeds 20480 bytes"
  assert_contains "oversize diagnostic names the largest fields" \
    "$(cat "$TMP/packet.err")" "largest fields: tasks="
fi

# foundation.json overrides still win over the raised defaults.
jq '.execution.packetBytes = {task: 8192}' foundation.json > "$TMP/foundation.json"
cp "$TMP/foundation.json" foundation.json
if node "$RUNTIME" packet "$ID" --task T001 >/dev/null 2>"$TMP/packet.err"; then
  fail "configured task budget override still applies"
else
  assert_contains "configured task budget override still applies" \
    "$(cat "$TMP/packet.err")" "task packet exceeds 8192 bytes"
fi

finish "large change packets"
