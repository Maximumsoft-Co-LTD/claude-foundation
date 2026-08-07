#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

assert_cmd_fails_with() {
  label="$1"; needle="$2"; shift 2
  output="$({ "$@"; } 2>&1 || true)"
  if [ -n "$output" ] && printf '%s' "$output" | grep -qF -- "$needle"; then
    pass "$label"
  else
    fail "$label — expected failure containing '$needle'"
  fi
}

assert_not_eq() {
  if [ "$2" != "$3" ]; then pass "$1"; else fail "$1 — both values were '$2'"; fi
}

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
help_all_text="$(bash "$ROOT/cli.sh" help --all)"
assert_contains "full CLI help retains isolation diagnostics" \
  "$help_all_text" "sandbox inspect <change> [--json]"
assert_contains "CLI help advertises guarded sandbox creation" \
  "$help_text" "sandbox create <change> [--all] [--unattended --attestation <file>]"

# Exercise the fail-closed branch deterministically even when this suite itself
# runs in a container. Only the installed fixture runtime is modified: strong
# host markers are redirected to guaranteed-absent paths.
RUNTIME="$TARGET/.claude/harness/runtime/evidence/attestation.mjs"
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

# A host can authorize unattended creation with a short-lived signed challenge.
# The testing trust root is gated by FOUNDATION_TESTING and is unavailable in
# production, where only system trust roots are accepted.
#
# The host-control-socket scan reads absolute paths, so an unprepared runner
# decides the outcome: any machine with Docker installed owns a writable
# /var/run/docker.sock, which is a real hazard and correctly denies unattended
# work no matter how valid the attestation is. Re-root the scan at an empty
# fixture (same FOUNDATION_TESTING gate as the trust root) so these assertions
# measure the attestation contract rather than the host.
HOST_ROOT="$TMP/host-root"
mkdir -p "$HOST_ROOT"
assert_cmd_zero "signed fixture change is created" \
  bash "$ROOT/cli.sh" --project "$TARGET" runtime new \
    "Signed unattended contract" --rapid
SIGNED_CHANGE="signed-unattended-contract"
FOUNDATION_TESTING=1 FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HOST_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox challenge "$SIGNED_CHANGE" \
  > "$TMP/attestation-challenge.json"
assert_cmd_zero "fixture host signs the unattended challenge" \
  node "$ROOT/.claude/tests/harness/sign-attestation.mjs" \
    "$TMP/attestation-challenge.json" "$TMP/trusted-hosts.json" \
    "$TMP/attestation.json" fixture-host
# A bare command substitution here would abort the whole suite under `set -eu`
# with no assertion line at all, hiding both the failure and its reason.
if signed_inspect="$(FOUNDATION_TESTING=1 \
  FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HOST_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$SIGNED_CHANGE" \
    --unattended --attestation "$TMP/attestation.json" --json 2>&1)"; then
  pass "unattended inspection with a valid attestation exits zero"
else
  fail "unattended inspection with a valid attestation exits zero"
  printf '%s\n' "$signed_inspect" >&2
fi
assert_contains "valid signed attestation authorizes unattended inspection" \
  "$signed_inspect" '"safeForUnattended": true'
assert_cmd_zero "valid signed attestation authorizes unattended creation" \
  env FOUNDATION_TESTING=1 FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HOST_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox create "$SIGNED_CHANGE" \
    --unattended --attestation "$TMP/attestation.json"
if FOUNDATION_TESTING=1 FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HOST_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$SIGNED_CHANGE" \
    --unattended --attestation "$TMP/attestation.json" >/dev/null 2>&1; then
  fail "consumed unattended attestation cannot be replayed"
else
  pass "consumed unattended attestation cannot be replayed"
fi

# Positive control: re-rooting must relocate the scan, not disable it. A typo in
# the fixture path would silently make every hazard invisible and turn the
# assertions above into a rubber stamp, so plant a writable control socket in
# the fixture tree and require that the same signed flow is refused.
assert_cmd_zero "hazard fixture change is created" \
  bash "$ROOT/cli.sh" --project "$TARGET" runtime new \
    "Hazardous unattended contract" --rapid
HAZARD_CHANGE="hazardous-unattended-contract"
HAZARD_ROOT="$TMP/hazard-root"
mkdir -p "$HAZARD_ROOT/var/run"
touch "$HAZARD_ROOT/var/run/docker.sock"
FOUNDATION_TESTING=1 FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HAZARD_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox challenge "$HAZARD_CHANGE" \
  > "$TMP/hazard-challenge.json"
assert_cmd_zero "fixture host signs the hazardous challenge" \
  node "$ROOT/.claude/tests/harness/sign-attestation.mjs" \
    "$TMP/hazard-challenge.json" "$TMP/trusted-hosts.json" \
    "$TMP/hazard-attestation.json" fixture-host
if hazard_inspect="$(FOUNDATION_TESTING=1 \
  FOUNDATION_TEST_TRUST_ROOT="$TMP/trusted-hosts.json" \
  FOUNDATION_TEST_HOST_ROOT="$HAZARD_ROOT" \
  SSH_AUTH_SOCK= XDG_RUNTIME_DIR= DOCKER_HOST= CONTAINER_HOST= \
  bash "$ROOT/cli.sh" --project "$TARGET" sandbox inspect "$HAZARD_CHANGE" \
    --unattended --attestation "$TMP/hazard-attestation.json" --json 2>&1)"; then
  fail "a writable control socket denies unattended work despite a valid attestation"
else
  pass "a writable control socket denies unattended work despite a valid attestation"
fi
assert_contains "the refusal names the writable control socket" \
  "$hazard_inspect" 'writable host-control socket'

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

# ---------------------------------------------------------------------------
# An isolated copy is what a dirty target gets instead of a worktree, and it is
# by far the more common case: a scaffold in progress has untracked files, so
# the copy path is the one real work lands on. It used to be created in the
# system temp directory without `.git`, which quietly removed every git-aware
# behaviour the runtime depends on — the changed surface degraded to a walk of
# the whole tree, the workspace hash stopped honouring `.gitignore`, and macOS
# was free to delete the sandbox mid-run.
# ---------------------------------------------------------------------------
COPY_TARGET="$TMP/copy-project"
mkdir -p "$COPY_TARGET"
assert_cmd_zero "copy fixture installs current Foundation runtime" \
  bash "$ROOT/install.sh" "$COPY_TARGET" --source "$ROOT" --yes
printf '.next/\nnoise.log\n' > "$COPY_TARGET/.gitignore"
assert_cmd_zero "copy fixture is an initialized Git project" \
  sh -c 'git -C "$1" init -q &&
    git -C "$1" config user.name "Foundation Tests" &&
    git -C "$1" config user.email "foundation-tests@example.invalid" &&
    git -C "$1" add . &&
    git -C "$1" commit -q -m initial' _ "$COPY_TARGET"
assert_cmd_zero "copy fixture change is created" \
  bash "$ROOT/cli.sh" --project "$COPY_TARGET" runtime new \
    "Isolated copy contract" --rapid

COPY_CHANGE="isolated-copy-contract"
# An unrelated untracked file is all it takes to make the runtime choose a copy.
printf 'work in progress\n' > "$COPY_TARGET/unrelated-wip.txt"
copy_create="$(bash "$ROOT/cli.sh" --project "$COPY_TARGET" \
  sandbox create "$COPY_CHANGE")"
assert_contains "a dirty target still selects an isolated copy" \
  "$copy_create" "mode: isolated-copy"
assert_contains "the copy reports that it carries git metadata" \
  "$copy_create" "git: carried"

COPY_STATE="$COPY_TARGET/.foundation/runtime/$COPY_CHANGE.json"
copy_path="$(jq -r '.workspace.path' "$COPY_STATE")"
assert_cmd_zero "the copy sandbox lives under .foundation/sandboxes, not the system temp dir" \
  sh -c 'case "$1" in */.foundation/sandboxes/*) exit 0 ;; *) exit 1 ;; esac' _ "$copy_path"
assert_cmd_zero "the copy sandbox records the base commit it was taken from" \
  jq -e '.workspace.baseHead != null and .workspace.git == "carried"' "$COPY_STATE"
assert_cmd_zero "the copy sandbox is itself a git repository" \
  git -C "$copy_path" rev-parse HEAD
assert_cmd_zero "the copy sandbox carries the target's uncommitted work" \
  test -f "$copy_path/unrelated-wip.txt"
# A copied `.git/worktrees` would name the target's linked worktrees by
# absolute path, letting a `git worktree` command inside the sandbox act
# outside it.
assert_cmd_zero "the copy sandbox inherits no worktree registrations" \
  sh -c 'test ! -d "$1/.git/worktrees"' _ "$copy_path"

# The evidence for a frontend change is collected by building it. If the build
# output counts as workspace surface, collecting the evidence expires it.
hash_before="$(bash "$ROOT/cli.sh" --project "$COPY_TARGET" runtime hash "$COPY_CHANGE")"
mkdir -p "$copy_path/.next/cache"
printf 'built artifact\n' > "$copy_path/.next/cache/chunk.js"
printf 'ignored noise\n' > "$copy_path/noise.log"
hash_after="$(bash "$ROOT/cli.sh" --project "$COPY_TARGET" runtime hash "$COPY_CHANGE")"
assert_eq "build output does not expire the evidence that produced it" \
  "$hash_before" "$hash_after"

# Source edits must still move the hash, or the check above only proves the
# hash stopped working.
printf 'real source change\n' > "$copy_path/src-change.txt"
hash_source="$(bash "$ROOT/cli.sh" --project "$COPY_TARGET" runtime hash "$COPY_CHANGE")"
assert_not_eq "a real source edit still expires prior evidence" \
  "$hash_before" "$hash_source"

# A second create must not silently merge into an occupied directory.
assert_cmd_fails_with "an occupied sandbox path is refused, not merged into" \
  "sandbox already exists" \
  bash "$ROOT/cli.sh" --project "$COPY_TARGET" sandbox create "$COPY_CHANGE"

finish "feedback isolation contracts"
