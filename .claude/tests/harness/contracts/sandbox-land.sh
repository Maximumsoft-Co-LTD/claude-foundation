# Sandbox, apply transaction, recovery, spec-sync, and Land contracts.
# Non-Git repositories use a manifest-guarded isolated copy.
node .claude/harness/foundation.mjs new 'Copy sandbox' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve copy-sandbox --impact low --coupling isolated >/dev/null
copy_output="$(node .claude/harness/foundation.mjs sandbox create copy-sandbox)"
assert_contains "non-git sandbox uses isolated copy" "$copy_output" "mode: isolated-copy"
assert_eq "copy sandbox enters Build" "building" \
  "$(jq -r '.status' .foundation/runtime/copy-sandbox.json)"
copy_path="$(jq -r '.workspace.path' .foundation/runtime/copy-sandbox.json)"
# A sandbox is a full copy, marker files included, so root resolution from a
# cwd inside it must walk past the copy instead of splitting runtime state —
# unless an explicit CLAUDE_FOUNDATION_PROJECT pin asks for the copy itself.
sandbox_resolution="$( (cd "$copy_path" && node .claude/harness/foundation.mjs changes) 2>&1 )"
assert_contains "runtime resolution walks past a sandbox copy" \
  "$sandbox_resolution" "control-plane state resolves at the project root"
assert_contains "runtime resolution preserves provider execution semantics" \
  "$sandbox_resolution" "provider commands still execute in the registered change sandbox"
assert_contains "commands from inside a sandbox act on the project root" \
  "$sandbox_resolution" "copy-sandbox"
pinned_resolution="$( (cd "$copy_path" && CLAUDE_FOUNDATION_PROJECT="$copy_path" \
  node .claude/harness/foundation.mjs changes) 2>&1 )"
case "$pinned_resolution" in
  *"control-plane state resolves at the project root"*) fail "an explicit pin keeps sandbox-local resolution" ;;
  *) pass "an explicit pin keeps sandbox-local resolution" ;;
esac
# External build commands are wall time the harness never saw: `exec` runs
# them, passes the exit code through, and records the duration for metrics.
assert_cmd_zero "exec passes a zero exit code through" \
  node .claude/harness/foundation.mjs exec copy-sandbox --phase build -- true
exec_failure_code=0
node .claude/harness/foundation.mjs exec copy-sandbox -- sh -c 'exit 3' \
  || exec_failure_code=$?
assert_eq "exec passes a failing exit code through" "3" "$exec_failure_code"
assert_cmd_fails_with "exec refuses an empty command" \
  "exec requires a command after --" \
  node .claude/harness/foundation.mjs exec copy-sandbox
assert_file_contains "exec records the observed external duration" \
  .foundation/logs/copy-sandbox/operations.jsonl '"operation":"exec"'
assert_file_contains "exec attributes the declared phase" \
  .foundation/logs/copy-sandbox/operations.jsonl '"phase":"build"'
exec_metrics="$(node .claude/harness/foundation.mjs metrics copy-sandbox)"
assert_contains "metrics reports external execution time separately" \
  "$exec_metrics" '"externalExecutionTimeMs"'
printf 'copy-applied\n' > "$copy_path/app.txt"
ln -s app.txt "$copy_path/current-link"
printf '%s\n' '{"lockfileVersion":3}' > "$copy_path/package-lock.json"
sed -i.bak 's/- \[ \]/- [x]/g' "$copy_path/openspec/changes/copy-sandbox/tasks.md"
rm "$copy_path/openspec/changes/copy-sandbox/tasks.md.bak"
copy_plan="$(node .claude/harness/foundation.mjs proof-plan copy-sandbox)"
# The lockfile edit still raises `dependency-supply-chain` from the changed
# surface, and this fixture wires no provider for it. That combination used to
# become a required provider with adapter "external" — a gate that appeared
# only after Build, could not be executed, and stopped Prove and Land for good.
# It is now carried as an advisory: still reported, so the inference is not lost,
# and not counted as evidence, because there is none to count.
assert_contains "changed lockfile reports supply-chain as an advisory" \
  "$copy_plan" "advisory dependency-supply-chain: not blocking"
assert_not_contains "an unwired inferred capability is not a required provider" \
  "$copy_plan" "dependency-supply-chain: missing"
node .claude/harness/foundation.mjs receipt copy-sandbox test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox discovery pass \
  --discovered 1 --minimum 1 --observed "1 test discovered" \
  --source harness-test --artifact app.txt >/dev/null
# No supply-chain receipt is recorded, and Prove still finishes. This is the
# regression: the loop completes without evidence nobody could ever produce.
node .claude/harness/foundation.mjs prove copy-sandbox >/dev/null

mkdir -p "$TMP/bin"
cp /dev/null "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "${1:-}" = "--version" ]; then echo "1.7.0"; exit 0; fi' \
  'if [ "${1:-}" = "archive" ]; then' \
  '  if [ "${FOUNDATION_TEST_OPEN_SPEC_FAIL:-0}" = "1" ]; then echo "injected archive failure" >&2; exit 1; fi' \
  '  mkdir -p "openspec/changes/archive"' \
  '  mv "openspec/changes/$2" "openspec/changes/archive/$2"' \
  '  echo "archived $2"' \
  '  exit 0' \
  'fi' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
printf 'user-owned and unrelated\n' > NOTES.md
if PATH="$TMP/bin:$PATH" FOUNDATION_TEST_OPEN_SPEC_FAIL=1 \
  node .claude/harness/foundation.mjs archive copy-sandbox >/dev/null 2>&1; then
  fail "archive failure is surfaced after code apply"
else
  pass "archive failure is surfaced after code apply"
fi
assert_eq "failed archive retains recoverable applied state" "applied" \
  "$(jq -r '.status' .foundation/runtime/copy-sandbox.json)"
assert_eq "code remains applied for archive retry" "copy-applied" \
  "$(tr -d '\n' < app.txt)"
assert_eq "copy apply preserves a new symlink" "app.txt" "$(readlink current-link)"
assert_file_contains "unrelated target file survives apply" NOTES.md \
  "user-owned and unrelated"
# Work done in the sandbox after the first projection is proven, so archive
# must re-project it. Landing the earlier code and then deleting the sandbox
# would make the proven fix unrecoverable.
printf 'v2-critical-fix\n' > "$copy_path/app.txt"
node .claude/harness/foundation.mjs receipt copy-sandbox test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox discovery pass \
  --discovered 1 --minimum 1 --observed "1 test discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox dependency-supply-chain pass \
  --observed "lockfile inspected" --source harness-test --artifact package-lock.json >/dev/null
node .claude/harness/foundation.mjs prove copy-sandbox >/dev/null
archive_output="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive delegates once to pinned OpenSpec" "$archive_output" "ARCHIVED copy-sandbox"
copy_applied="$(tr -d '\n' < app.txt)"
assert_eq "archive re-projects sandbox work done after the first apply" \
  "v2-critical-fix" "$copy_applied"
assert_file_absent "archive cleans the applied temporary copy" "$copy_path"
archive_again="$(node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive is idempotent after spec sync" "$archive_again" "ALREADY ARCHIVED copy-sandbox"

# 'openspec archive' can move the change directory and still fail. Recovery
# cannot distinguish that from a crash after success, so it re-checks the Land
# guards instead of declaring the change landed.
node .claude/harness/foundation.mjs new 'Interrupted archive' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve interrupted-archive \
  --impact low --coupling isolated >/dev/null
node .claude/harness/foundation.mjs sandbox create interrupted-archive >/dev/null
interrupted_path="$(jq -r '.workspace.path' .foundation/runtime/interrupted-archive.json)"
printf 'never-landed\n' > "$interrupted_path/app.txt"
sed -i.bak 's/- \[ \]/- [x]/g' "$interrupted_path/openspec/changes/interrupted-archive/tasks.md"
rm "$interrupted_path/openspec/changes/interrupted-archive/tasks.md.bak"
node .claude/harness/foundation.mjs receipt interrupted-archive test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt interrupted-archive discovery pass \
  --discovered 1 --minimum 1 --observed "1 test discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs prove interrupted-archive >/dev/null
mkdir -p openspec/changes/archive
mv openspec/changes/interrupted-archive openspec/changes/archive/interrupted-archive
assert_cmd_fails_with "a recovered archive refuses a projection that never ran" \
  "never projected the sandbox into the target" \
  node .claude/harness/foundation.mjs archive interrupted-archive
assert_eq "a refused recovery leaves the change unarchived" "proven" \
  "$(jq -r '.status' .foundation/runtime/interrupted-archive.json)"
assert_file_contains "a refused recovery leaves the target untouched" app.txt \
  "v2-critical-fix"
mv openspec/changes/archive/interrupted-archive openspec/changes/interrupted-archive
node .claude/harness/foundation.mjs abandon interrupted-archive \
  --reason "recovery fixture" --decision-ref fixture://user/recovery >/dev/null

# A separate clean Git fixture exercises the complete worktree proof/apply path.
mkdir -p "$TMP/git-project/.claude/harness" "$TMP/git-project/openspec" "$TMP/git-project/.foundation"
install_harness_fixture "$ROOT" "$TMP/git-project"
cp "$ROOT/.claude/harness/commands.json" "$TMP/git-project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/git-project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/git-project/openspec/"
cp "$ROOT/.foundation/.gitignore" "$TMP/git-project/.foundation/"
printf 'before\n' > "$TMP/git-project/app.txt"
printf 'first\n' > "$TMP/git-project/target-a.txt"
printf 'second\n' > "$TMP/git-project/target-b.txt"
ln -s target-a.txt "$TMP/git-project/current-link"
cd "$TMP/git-project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git add .
git commit -qm "fixture"
node .claude/harness/foundation.mjs new 'Sandbox copy' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve sandbox-copy --impact low --coupling isolated >/dev/null
node .claude/harness/foundation.mjs sandbox create sandbox-copy >/dev/null
assert_eq "Git sandbox enters Build" "building" \
  "$(jq -r '.status' .foundation/runtime/sandbox-copy.json)"
printf 'after\n' > .foundation/sandboxes/sandbox-copy/app.txt
rm .foundation/sandboxes/sandbox-copy/current-link
ln -s target-b.txt .foundation/sandboxes/sandbox-copy/current-link
sed -i.bak 's/- \[ \]/- [x]/g' .foundation/sandboxes/sandbox-copy/openspec/changes/sandbox-copy/tasks.md
rm .foundation/sandboxes/sandbox-copy/openspec/changes/sandbox-copy/tasks.md.bak
printf '\nRevised during build.\n' >> openspec/changes/sandbox-copy/proposal.md
sync_output="$(node .claude/harness/foundation.mjs sandbox sync sandbox-copy)"
assert_contains "active sandbox change syncs" "$sync_output" "SYNCED sandbox-copy"
assert_file_contains "sync carries revised proposal into sandbox" \
  .foundation/sandboxes/sandbox-copy/openspec/changes/sandbox-copy/proposal.md \
  "Revised during build."
assert_file_contains "sync preserves unchanged completed task" \
  .foundation/sandboxes/sandbox-copy/openspec/changes/sandbox-copy/tasks.md \
  "- [x]"
node .claude/harness/foundation.mjs receipt sandbox-copy test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass \
  --discovered 2 --minimum 1 --observed "2 tests discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
rm .foundation/sandboxes/sandbox-copy/current-link
ln -s target-a.txt .foundation/sandboxes/sandbox-copy/current-link
if node .claude/harness/foundation.mjs land-check sandbox-copy >/dev/null 2>&1; then
  fail "dirty symlink target change invalidates proof"
else
  pass "dirty symlink target change invalidates proof"
fi
rm .foundation/sandboxes/sandbox-copy/current-link
ln -s target-b.txt .foundation/sandboxes/sandbox-copy/current-link
node .claude/harness/foundation.mjs receipt sandbox-copy test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass \
  --discovered 2 --minimum 1 --observed "2 tests discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
printf '\nSecond revision after proof.\n' >> openspec/changes/sandbox-copy/proposal.md
node .claude/harness/foundation.mjs sandbox sync sandbox-copy >/dev/null
if node .claude/harness/foundation.mjs land-check sandbox-copy >/dev/null 2>&1; then
  fail "sandbox revision invalidates prior proof"
else
  pass "sandbox revision invalidates prior proof"
fi
node .claude/harness/foundation.mjs receipt sandbox-copy test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass \
  --discovered 2 --minimum 1 --observed "2 tests discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
printf 'user-conflict\n' > app.txt
if node .claude/harness/foundation.mjs sandbox apply sandbox-copy >/dev/null 2>&1; then
  fail "touched-path conflict blocks before mutation"
else
  pass "touched-path conflict blocks before mutation"
fi
assert_eq "conflicting target content is preserved" "user-conflict" \
  "$(tr -d '\n' < app.txt)"
printf 'before\n' > app.txt
printf 'unrelated during build\n' > NOTES.md
if FOUNDATION_TEST_MODE=1 FOUNDATION_TEST_FAIL_APPLY_AFTER=1 \
  node .claude/harness/foundation.mjs sandbox apply sandbox-copy >/dev/null 2>&1; then
  fail "injected partial apply fails"
else
  pass "injected partial apply fails"
fi
assert_eq "failed partial apply rolls target back" "before" \
  "$(tr -d '\n' < app.txt)"
assert_eq "rollback keeps proof state retryable" "proven" \
  "$(jq -r '.status' .foundation/runtime/sandbox-copy.json)"
assert_file_contains "rollback preserves unrelated target edits" NOTES.md \
  "unrelated during build"
assert_cmd_zero "proven sandbox applies transactionally" \
  node .claude/harness/foundation.mjs sandbox apply sandbox-copy
applied="$(tr -d '\n' < app.txt)"
assert_eq "target matches sandbox content" "after" "$applied"
assert_eq "Git worktree apply preserves changed symlink" "target-b.txt" \
  "$(readlink current-link)"
assert_file_contains "land returns completed task ledger" \
  openspec/changes/sandbox-copy/tasks.md "- [x]"
assert_file_contains "successful apply preserves unrelated target edits" NOTES.md \
  "unrelated during build"

# An applied change whose sandbox has not moved resumes its recorded
# transaction instead of opening a redundant one.
prior_transaction="$(jq -r '.workspace.apply.transactionId' \
  .foundation/runtime/sandbox-copy.json)"
reapply_noop="$(node .claude/harness/foundation.mjs sandbox apply sandbox-copy)"
assert_contains "unchanged re-apply resumes the prior transaction" \
  "$reapply_noop" "resumed:"
assert_eq "unchanged re-apply keeps the recorded transaction" "$prior_transaction" \
  "$(jq -r '.workspace.apply.transactionId' .foundation/runtime/sandbox-copy.json)"

# A sandbox that moves forward after apply must be projected again. Resuming
# the stale transaction here left a half-landed change with no way out.
printf 'after-second-pass\n' > .foundation/sandboxes/sandbox-copy/app.txt
node .claude/harness/foundation.mjs sandbox sync sandbox-copy >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass \
  --discovered 2 --minimum 1 --observed "2 tests discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
assert_cmd_zero "applied sandbox rolls forward after a later revision" \
  node .claude/harness/foundation.mjs sandbox apply sandbox-copy
assert_eq "roll-forward projects the newer sandbox content" "after-second-pass" \
  "$(tr -d '\n' < app.txt)"
if [ "$prior_transaction" = "$(jq -r '.workspace.apply.transactionId' \
  .foundation/runtime/sandbox-copy.json)" ]; then
  fail "roll-forward opens a new apply transaction"
else
  pass "roll-forward opens a new apply transaction"
fi
assert_file_contains "roll-forward preserves unrelated target edits" NOTES.md \
  "unrelated during build"

# OpenSpec reads a MODIFIED block as the complete scenario list, so a renamed
# scenario archives as a deletion. 'openspec archive' only reports that after
# the code has landed, so the harness has to catch it while the change is still
# cheap to fix.
node .claude/harness/foundation.mjs new 'Scenario rename guard' >/dev/null
node .claude/harness/foundation.mjs resolve scenario-rename-guard \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
mkdir -p openspec/specs/appearance \
  openspec/changes/scenario-rename-guard/specs/appearance
printf '%s\n' \
  '# appearance Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' '' \
  '#### Scenario: A value that is not one of the three is discarded' '' \
  '- **WHEN** an unknown value is stored' '- **THEN** it is discarded' \
  > openspec/specs/appearance/spec.md
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' '' \
  '#### Scenario: A value that is not one of the four is discarded' '' \
  '- **WHEN** an unknown value is stored' '- **THEN** it is discarded' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
assert_cmd_fails_with "renamed scenario is refused before any projection" \
  'A value that is not one of the three is discarded' \
  node .claude/harness/foundation.mjs validate scenario-rename-guard
# Renaming the requirement as well is the form OpenSpec actually accepts;
# reusing one requirement name in both sections is rejected by OpenSpec itself.
printf '%s\n' \
  '## REMOVED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '**Migration:** Existing stored choices continue to work under the renamed requirement.' '' \
  '## ADDED Requirements' '' \
  '### Requirement: The choice is remembered across four values' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' '' \
  '#### Scenario: A value that is not one of the four is discarded' '' \
  '- **WHEN** an unknown value is stored' '- **THEN** it is discarded' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
declared_removal="$({ node .claude/harness/foundation.mjs validate \
  scenario-rename-guard; } 2>&1 || true)"
assert_not_contains "a declared removal clears the scenario guard" \
  "$declared_removal" "spec delta drops"
assert_cmd_zero "rename expressed as removed plus added validates before Build" \
  node .claude/harness/foundation.mjs validate scenario-rename-guard

# Existing capabilities also select operations from requirement identity. These
# checks belong before Build rather than in the post-archive sync oracle.
printf '%s\n' \
  '## ADDED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
assert_cmd_fails_with "ADDED cannot redeclare an existing requirement" \
  "canonical spec already declares it" \
  node .claude/harness/foundation.mjs validate scenario-rename-guard
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: A requirement that does not exist' '' \
  'The system SHALL not guess its identity.' '' \
  '#### Scenario: An absent target is requested' '' \
  '- **WHEN** validation runs' '- **THEN** it refuses the delta' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
assert_cmd_fails_with "MODIFIED must target an existing requirement" \
  "targets a requirement the canonical spec does not declare" \
  node .claude/harness/foundation.mjs validate scenario-rename-guard
printf '%s\n' \
  '## REMOVED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
assert_cmd_fails_with "REMOVED requires a migration consequence" \
  "must state a non-empty '**Migration:**'" \
  node .claude/harness/foundation.mjs validate scenario-rename-guard
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' '' \
  '#### Scenario: A value that is not one of the three is discarded' '' \
  '- **WHEN** an unknown value is stored' '- **THEN** it is discarded' '' \
  '## ADDED Requirements' '' \
  '### Requirement: The choice is remembered' '' \
  'The system SHALL remember the choice.' '' \
  '#### Scenario: A choice survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the choice is kept' \
  > openspec/changes/scenario-rename-guard/specs/appearance/spec.md
assert_cmd_fails_with "one requirement name cannot carry two operations" \
  "same requirement is declared in multiple operations" \
  node .claude/harness/foundation.mjs validate scenario-rename-guard

# A capability with no canonical spec has nothing to modify or remove.
# OpenSpec used to reveal this only during archive, after implementation and
# proof. Foundation validates the delta operation before Build instead.
node .claude/harness/foundation.mjs new 'New capability operation guard' >/dev/null
node .claude/harness/foundation.mjs resolve new-capability-operation-guard \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
mkdir -p openspec/changes/new-capability-operation-guard/specs/brand-new-capability
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: A new behavior' '' \
  'The system SHALL expose the behavior.' '' \
  '#### Scenario: The behavior is used' '' \
  '- **WHEN** the behavior is requested' '- **THEN** it is available' \
  > openspec/changes/new-capability-operation-guard/specs/brand-new-capability/spec.md
assert_cmd_fails_with "a new capability cannot modify an absent requirement" \
  "'MODIFIED Requirements'" \
  node .claude/harness/foundation.mjs validate new-capability-operation-guard
assert_cmd_fails_with "the new-capability refusal names the valid operation" \
  "declare every new requirement under '## ADDED Requirements'" \
  node .claude/harness/foundation.mjs validate new-capability-operation-guard
sed 's/## MODIFIED Requirements/## REMOVED Requirements/' \
  openspec/changes/new-capability-operation-guard/specs/brand-new-capability/spec.md \
  > "$TMP/new-capability-removed.md"
cp "$TMP/new-capability-removed.md" \
  openspec/changes/new-capability-operation-guard/specs/brand-new-capability/spec.md
assert_cmd_fails_with "a new capability cannot remove an absent requirement" \
  "'REMOVED Requirements'" \
  node .claude/harness/foundation.mjs validate new-capability-operation-guard
sed 's/## REMOVED Requirements/## ADDED Requirements/' \
  openspec/changes/new-capability-operation-guard/specs/brand-new-capability/spec.md \
  > "$TMP/new-capability-added.md"
cp "$TMP/new-capability-added.md" \
  openspec/changes/new-capability-operation-guard/specs/brand-new-capability/spec.md
assert_cmd_zero "an additive delta remains valid for a new capability" \
  node .claude/harness/foundation.mjs validate new-capability-operation-guard

# Self-measurement must not depend on being launched through the shell wrapper.
# A direct 'node' invocation is measured unless telemetry is explicitly off,
# and a refusal is recorded as a lifecycle stop rather than a failure so real
# breakage stays visible under the guards that are working as designed.
node .claude/harness/foundation.mjs new 'Telemetry default' --rapid >/dev/null
assert_file_exists "direct runtime invocation records operation telemetry" \
  .foundation/logs/telemetry-default/operations.jsonl
node .claude/harness/foundation.mjs land-check telemetry-default >/dev/null 2>&1 || true
assert_file_contains "a refused command records a lifecycle stop" \
  .foundation/logs/telemetry-default/operations.jsonl '"status":"blocked"'
assert_file_not_contains "a refused command is not counted as a failure" \
  .foundation/logs/telemetry-default/operations.jsonl '"status":"failed"'
telemetry_rows="$(wc -l < .foundation/logs/telemetry-default/operations.jsonl | tr -d ' ')"
FOUNDATION_TELEMETRY=0 node .claude/harness/foundation.mjs land-check \
  telemetry-default >/dev/null 2>&1 || true
assert_eq "explicit opt-out suppresses operation telemetry" "$telemetry_rows" \
  "$(wc -l < .foundation/logs/telemetry-default/operations.jsonl | tr -d ' ')"
node .claude/harness/foundation.mjs metrics telemetry-default \
  > "$TMP/telemetry-metrics.json"
assert_cmd_zero "wall-clock time is measured without a shell wrapper" \
  jq -e '.wallTimeMs != null and .wallTimeMs >= 0' "$TMP/telemetry-metrics.json"
assert_cmd_zero "a refused command surfaces as an expected stop" \
  jq -e '.rework.expectedStops >= 1 and .rework.unexpectedFailures == 0' \
  "$TMP/telemetry-metrics.json"

# A fresh sandbox has no installed dependencies; `sandbox.setupCommand` runs
# once inside it after creation. Absent config must stay byte-identical, and a
# failing command must keep the sandbox and say how to recover.
node .claude/harness/foundation.mjs new 'Setup absent' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve setup-absent --impact low --coupling isolated >/dev/null
setup_absent_output="$(node .claude/harness/foundation.mjs sandbox create setup-absent)"
assert_not_contains "absent setup config adds no setup line" "$setup_absent_output" "setup:"
assert_eq "absent setup config records nothing" "null" \
  "$(jq -r '.workspace.setup // "null"' .foundation/runtime/setup-absent.json)"

printf '%s\n' '{"version":1,"sandbox":{"setupCommand":"printf ready > setup-marker.txt"}}' > foundation.json
node .claude/harness/foundation.mjs new 'Setup ok' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve setup-ok --impact low --coupling isolated >/dev/null
setup_ok_output="$(node .claude/harness/foundation.mjs sandbox create setup-ok)"
assert_contains "sandbox create reports setup ok" "$setup_ok_output" "setup: ok"
setup_ok_path="$(jq -r '.workspace.path' .foundation/runtime/setup-ok.json)"
assert_file_exists "setup command ran inside the new sandbox" "$setup_ok_path/setup-marker.txt"
assert_eq "setup outcome is recorded on the workspace" "ok" \
  "$(jq -r '.workspace.setup.status' .foundation/runtime/setup-ok.json)"

printf '%s\n' '{"version":1,"sandbox":{"setupCommand":"echo install exploded >&2; exit 7"}}' > foundation.json
node .claude/harness/foundation.mjs new 'Setup fail' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve setup-fail --impact low --coupling isolated >/dev/null
setup_fail_output="$(node .claude/harness/foundation.mjs sandbox create setup-fail 2>&1)"
assert_contains "failed setup warns with the command" "$setup_fail_output" \
  "WARNING: sandbox setup command failed"
assert_contains "failed setup says how to recover" "$setup_fail_output" \
  "rerun it there manually"
assert_eq "failed setup keeps the sandbox in Build" "building" \
  "$(jq -r '.status' .foundation/runtime/setup-fail.json)"
assert_eq "failed setup records the exit code" "7" \
  "$(jq -r '.workspace.setup.exitCode' .foundation/runtime/setup-fail.json)"
assert_file_exists "failed setup keeps the workspace" \
  "$(jq -r '.workspace.path' .foundation/runtime/setup-fail.json)/app.txt"

printf '%s\n' '{"version":1,"sandbox":{"setupCommand":5}}' > foundation.json
assert_cmd_fails_with "invalid setup command is rejected by policy" \
  "sandbox.setupCommand must be a non-empty string" \
  node .claude/harness/foundation.mjs doctor
printf '%s\n' '{"version":1,"sandbox":{"setupTimeoutMs":"soon"}}' > foundation.json
assert_cmd_fails_with "invalid setup timeout is rejected by policy" \
  "sandbox.setupTimeoutMs must be 1000..3600000" \
  node .claude/harness/foundation.mjs doctor
rm foundation.json
