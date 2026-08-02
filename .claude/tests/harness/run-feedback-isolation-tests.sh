#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
TARGET="$TMP/project"
mkdir -p "$TARGET"

assert_cmd_zero "fixture installs current Foundation runtime" \
  bash "$ROOT/install.sh" "$TARGET" --source "$ROOT" --yes
assert_cmd_zero "fixture is an initialized Git project" \
  sh -c 'git -C "$1" init -q &&
    git -C "$1" config user.name "Foundation Tests" &&
    git -C "$1" config user.email "foundation-tests@example.invalid" &&
    git -C "$1" add . &&
    git -C "$1" commit -q -m initial' _ "$TARGET"
assert_cmd_zero "fixture change is created" \
  bash "$ROOT/cli.sh" --project "$TARGET" runtime new \
    "Feedback isolation contract" --rapid

CHANGE="feedback-isolation-contract"
OPERATIONS="$TARGET/.foundation/logs/$CHANGE/operations.jsonl"
operations_before="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"

inspect_json="$(bash "$ROOT/cli.sh" --project "$TARGET" \
  sandbox inspect "$CHANGE" --json)"
operations_after="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"
assert_eq "read-only inspect emits no telemetry operation" \
  "$operations_before" "$operations_after"
printf '%s\n' "$inspect_json" > "$TMP/inspect.json"
assert_cmd_zero "interactive inspect emits its versioned JSON contract" \
  jq -e \
    --arg change "$CHANGE" \
    '.version == 1 and
     .changeId == $change and
     .workspaceIsolation.kind == "none" and
     .workspaceIsolation.status == "current" and
     (.securityBoundary.kind | type == "string") and
     (.securityBoundary.status | type == "string") and
     .execution.mode == "interactive" and
     .execution.decision == "allow"' \
    "$TMP/inspect.json"

inspect_text="$(bash "$ROOT/cli.sh" --project "$TARGET" \
  sandbox inspect "$CHANGE")"
assert_contains "text inspect names workspace isolation" \
  "$inspect_text" "workspace isolation:"
assert_contains "text inspect names the security boundary separately" \
  "$inspect_text" "security boundary:"
assert_contains "text inspect reports unattended safety" \
  "$inspect_text" "safe for unattended:"

doctor_text="$(bash "$ROOT/cli.sh" --project "$TARGET" doctor \
  --stage build --change "$CHANGE")"
assert_contains "ordinary doctor retains runtime readiness output" \
  "$doctor_text" "node:"
if printf '%s' "$doctor_text" | grep -qF "unattended-security-boundary"; then
  fail "ordinary doctor does not activate the unattended guard"
else
  pass "ordinary doctor does not activate the unattended guard"
fi

help_text="$(bash "$ROOT/cli.sh" help)"
assert_contains "CLI help advertises isolation inspection" \
  "$help_text" "sandbox inspect <change> [--json] [--unattended]"
assert_contains "CLI help advertises guarded sandbox creation" \
  "$help_text" "sandbox create <change> [--all] [--unattended]"

# Exercise the fail-closed branch deterministically even when this suite itself
# runs in a container. Only the installed fixture runtime is modified: strong
# host markers are redirected to guaranteed-absent paths.
RUNTIME="$TARGET/.claude/harness/foundation.mjs"
sed -i.bak \
  -e 's|"/.dockerenv"|"/__foundation_test_absent_dockerenv__"|g' \
  -e 's|"/run/.containerenv"|"/__foundation_test_absent_containerenv__"|g' \
  -e 's|"/proc/1/cgroup"|"/__foundation_test_absent_cgroup__"|g' \
  -e 's|"/workspaces"|"/__foundation_test_absent_workspaces__"|g' \
  "$RUNTIME"
rm "$RUNTIME.bak"
UNKNOWN_ENV_PATH="$PATH"
unknown_json="$(PATH="$UNKNOWN_ENV_PATH" CODESPACES=false DOCKER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" \
  sandbox inspect "$CHANGE" --json)"
printf '%s\n' "$unknown_json" > "$TMP/unknown.json"
assert_cmd_zero "interactive unknown boundary remains inspectable" \
  jq -e \
    '.securityBoundary.kind == "unknown" and
     .securityBoundary.status == "not-detected" and
     .execution.safeForUnattended == false and
     .execution.decision == "allow"' \
    "$TMP/unknown.json"

strict_state_before="$(jq -c . "$TARGET/.foundation/runtime/$CHANGE.json")"
strict_operations_before="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox create "$CHANGE" \
  --unattended= > "$TMP/empty-unattended.txt" 2>&1; then
  fail "empty-value unattended flag is rejected"
else
  pass "empty-value unattended flag is rejected"
fi
assert_file_contains "empty-value rejection is explicit" \
  "$TMP/empty-unattended.txt" "flag --unattended does not accept a value"
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox create "$CHANGE" \
  --unattended --unattended= > "$TMP/duplicate-unattended.txt" 2>&1; then
  fail "a later empty flag cannot clear unattended intent"
else
  pass "a later empty flag cannot clear unattended intent"
fi
if sh -c 'cd "$1" && node .claude/harness/foundation.mjs sandbox create "$2" --unattended=true' \
  _ "$TARGET" "$CHANGE" > "$TMP/direct-equals-unattended.txt" 2>&1; then
  fail "direct runtime rejects valued unattended flags"
else
  pass "direct runtime rejects valued unattended flags"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox create "$CHANGE" \
  --unattended=true > "$TMP/cli-equals-unattended.txt" 2>&1; then
  fail "CLI rejects valued unattended flags"
else
  pass "CLI rejects valued unattended flags"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$CHANGE" \
  --unattended --unattended > "$TMP/duplicate-bare-unattended.txt" 2>&1; then
  fail "duplicate bare unattended flags are rejected"
else
  pass "duplicate bare unattended flags are rejected"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$CHANGE" \
  --unattended false > "$TMP/following-value-unattended.txt" 2>&1; then
  fail "a following value cannot weaken unattended intent"
else
  pass "a following value cannot weaken unattended intent"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$CHANGE" \
  --unexpected > "$TMP/unknown-isolation-flag.txt" 2>&1; then
  fail "isolation commands reject unknown flags"
else
  pass "isolation commands reject unknown flags"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" doctor --stage build \
  --change "$CHANGE" --unattended=true > "$TMP/doctor-valued-unattended.txt" 2>&1; then
  fail "doctor rejects valued unattended flags"
else
  pass "doctor rejects valued unattended flags"
fi
if bash "$ROOT/cli.sh" --project "$TARGET" doctor --stage build \
  --change "$CHANGE" --unattended --unattended \
  > "$TMP/doctor-duplicate-unattended.txt" 2>&1; then
  fail "doctor rejects duplicate unattended flags"
else
  pass "doctor rejects duplicate unattended flags"
fi
strict_state_after="$(jq -c . "$TARGET/.foundation/runtime/$CHANGE.json")"
strict_operations_after="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"
assert_eq "malformed unattended flags leave all runtime state unchanged" \
  "$strict_state_before" "$strict_state_after"
assert_eq "malformed unattended flags emit no telemetry" \
  "$strict_operations_before" "$strict_operations_after"
assert_file_absent "malformed unattended flags create no worktree" \
  "$TARGET/.foundation/sandboxes/$CHANGE"

if PATH="$UNKNOWN_ENV_PATH" CODESPACES=false DOCKER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$CHANGE" \
    --unattended --json > "$TMP/unattended-inspect.json" 2>&1; then
  fail "unattended inspect blocks an unknown security boundary"
else
  pass "unattended inspect blocks an unknown security boundary"
fi
assert_cmd_zero "blocked inspect still emits a machine-readable decision" \
  jq -e \
    '.securityBoundary.kind == "unknown" and
     .execution.mode == "unattended" and
     .execution.safeForUnattended == false and
     .execution.decision == "block"' \
    "$TMP/unattended-inspect.json"

state_before="$(jq -c '.workspace' "$TARGET/.foundation/runtime/$CHANGE.json")"
operations_before_create="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"
if PATH="$UNKNOWN_ENV_PATH" CODESPACES=false DOCKER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox create "$CHANGE" \
    --unattended > "$TMP/unattended-create.txt" 2>&1; then
  fail "unattended sandbox creation blocks an unknown security boundary"
else
  pass "unattended sandbox creation blocks an unknown security boundary"
fi
state_after="$(jq -c '.workspace' "$TARGET/.foundation/runtime/$CHANGE.json")"
operations_after_create="$(test -f "$OPERATIONS" && wc -c < "$OPERATIONS" | tr -d ' ' || printf '0')"
assert_eq "blocked unattended creation leaves workspace state unchanged" \
  "$state_before" "$state_after"
assert_eq "blocked unattended creation emits no telemetry operation" \
  "$operations_before_create" "$operations_after_create"
assert_file_absent "blocked unattended creation creates no worktree" \
  "$TARGET/.foundation/sandboxes/$CHANGE"
assert_file_contains "blocked creation explains the security requirement" \
  "$TMP/unattended-create.txt" \
  "requires a trusted host-owned security attestation"

if PATH="$UNKNOWN_ENV_PATH" CODESPACES=false DOCKER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" doctor --stage build \
    --change "$CHANGE" --unattended > "$TMP/unattended-doctor.txt" 2>&1; then
  fail "unattended doctor blocks an unknown security boundary"
else
  pass "unattended doctor blocks an unknown security boundary"
fi
assert_file_contains "unattended doctor reports its failing check" \
  "$TMP/unattended-doctor.txt" "ERROR unattended-security-boundary:"

ordinary_unknown="$(PATH="$UNKNOWN_ENV_PATH" CODESPACES=false DOCKER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" doctor --stage build \
    --change "$CHANGE")"
assert_contains "ordinary doctor still succeeds when boundary is unknown" \
  "$ordinary_unknown" "node:"
if printf '%s' "$ordinary_unknown" | grep -qF "unattended-security-boundary"; then
  fail "ordinary doctor remains free of unattended-only checks"
else
  pass "ordinary doctor remains free of unattended-only checks"
fi

# Isolation inspection and the unattended preflight must not execute a PATH
# program. Model an existing worktree structurally, then shadow Git with a
# sentinel-producing executable.
cp "$TARGET/.foundation/runtime/$CHANGE.json" "$TMP/runtime-before-path-test.json"
mkdir -p "$TMP/structural-worktree/.git" "$TMP/fake-bin"
jq --arg path "$TMP/structural-worktree" \
  '.workspace = {"mode":"worktree","path":$path,"applied":false}' \
  "$TARGET/.foundation/runtime/$CHANGE.json" > "$TMP/runtime-path-test.json"
cp "$TMP/runtime-path-test.json" "$TARGET/.foundation/runtime/$CHANGE.json"
printf '%s\n' '#!/bin/sh' 'printf invoked > "$FOUNDATION_FAKE_GIT_SENTINEL"' 'exit 99' \
  > "$TMP/fake-bin/git"
chmod +x "$TMP/fake-bin/git"
FOUNDATION_FAKE_GIT_SENTINEL="$TMP/fake-git-invoked" \
  PATH="$TMP/fake-bin:$PATH" bash "$ROOT/cli.sh" --project "$TARGET" \
  sandbox inspect "$CHANGE" --json > "$TMP/path-safe-inspect.json"
assert_file_absent "workspace inspection executes no PATH-resolved Git" \
  "$TMP/fake-git-invoked"
assert_cmd_zero "filesystem-only worktree identity remains inspectable" \
  jq -e '.workspaceIsolation.kind == "git-worktree" and
    .workspaceIsolation.status == "active"' "$TMP/path-safe-inspect.json"
if FOUNDATION_FAKE_GIT_SENTINEL="$TMP/fake-git-invoked" \
  PATH="$TMP/fake-bin:$PATH" bash "$ROOT/cli.sh" --project "$TARGET" \
  sandbox create "$CHANGE" --unattended > "$TMP/path-safe-create.txt" 2>&1; then
  fail "unattended preflight remains fail-closed with a shadowed Git"
else
  pass "unattended preflight remains fail-closed with a shadowed Git"
fi
assert_file_absent "unattended preflight executes no PATH-resolved Git" \
  "$TMP/fake-git-invoked"
cp "$TMP/runtime-before-path-test.json" "$TARGET/.foundation/runtime/$CHANGE.json"

finish "feedback isolation contracts"
