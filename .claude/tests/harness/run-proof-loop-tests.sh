#!/usr/bin/env sh
# The change loop, walked end to end with an executable provider.
#
# Every other suite records receipts directly, which skips the one step where
# the loop actually blocked in practice: a provider that runs, passes, and then
# expires its own evidence because its report landed inside the hashed
# workspace surface. The hash is taken before providers run and again at
# finalization, so a report written to the workspace root guarantees the second
# hash differs from the first — the run passes and reports itself void, and the
# only word for it was `stale`.
#
# This suite pins both halves: the warning that names the report path before a
# run is wasted, the finalization message that names the cause after, and the
# same loop reaching PROVEN once the report is written somewhere excluded.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

# One project per scenario. Two changes holding sandboxes on the same
# repository is a repository conflict — a real blocker, and not the one under
# test here.
setup_project() {
  if [ "$1" = review-waiver ]; then
    # Exercise the shipped installer, not just copied runtime modules, through
    # proof, a fixture-owned review-risk decision, and archive below.
    bash "$ROOT/install.sh" "$TMP/$1" --source "$ROOT" --yes >/dev/null
  else
    mkdir -p "$TMP/$1/.claude/harness" "$TMP/$1/openspec"
    cp -R "$ROOT/.claude/harness/." "$TMP/$1/.claude/harness/"
    cp -R "$ROOT/openspec/schemas" "$TMP/$1/openspec/"
    cp "$ROOT/openspec/config.yaml" "$TMP/$1/openspec/"
  fi
  cd "$TMP/$1"
  printf 'v1\n' > app.txt
  printf '%s\n' '#!/usr/bin/env sh' \
    'mkdir -p "$(dirname "$1")"' \
    'if grep -q v2 app.txt; then' \
    '  printf "{\"numTotalTests\":1,\"numPassedTests\":1,\"success\":true}" > "$1"' \
    'else' \
    '  printf "{\"numTotalTests\":1,\"numFailedTests\":1,\"success\":false}" > "$1"; exit 1' \
    'fi' \
    > run-test.sh
  printf '.foundation/\n' > .gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

# $1 = change id, $2 = report path the provider writes
draft() {
  node .claude/harness/foundation.mjs start --template > draft.json
  REPORT="$2" TITLE="$1" DECLARE_REPORT="${3:-}" ADD_LINT="${4:-}" node -e '
    const { readFileSync, writeFileSync } = require("fs");
    const d = JSON.parse(readFileSync("draft.json", "utf8"));
    d.intent = process.env.TITLE;
    d.requirements = [{ key: "greeting-updated", capability: "application",
      operation: "added", scenario: { name: "app.txt carries v2",
        when: "the change is built", then: "app.txt carries v2" },
      outcome: "write v2 to app.txt" }];
    d.tasks = [{ key: "update-app", outcome: "Update app.txt", kind: "implementation",
      paths: (process.env.DECLARE_REPORT ? ["app.txt", process.env.REPORT] : ["app.txt"]),
      verify: "sh run-test.sh " + process.env.REPORT,
      covers: ["greeting-updated"] }];
    d.evidence = { "greeting-updated": { capabilities:
      process.env.ADD_LINT ? ["test", "static-analysis"] : ["test"] } };
    d.discovery.coverage = d.discovery.coverage.map((row) => ({
      dimension: row.dimension, status: "covered", covers: ["greeting-updated"]
    }));
    d.execution = { version: 1, providers: { test: { adapter: "test-discovery",
      command: ["sh", "run-test.sh", process.env.REPORT], report: process.env.REPORT,
      minimum: 1, timeoutMs: 60000 } }, services: {} };
    if (process.env.ADD_LINT) d.execution.providers.lint = {
      adapter: "command", capability: "static-analysis", claims: ["greeting-updated"],
      inputs: ["run-test.sh"], command: ["sh", "-n", "run-test.sh"], timeoutMs: 60000
    };
    writeFileSync("draft.json", JSON.stringify(d, null, 2));'
  mkdir -p .foundation
  node .claude/harness/foundation.mjs start draft.json --inspect > .foundation/start-inspect.json
  SOURCE_DIGEST="$(node -p 'require("./.foundation/start-inspect.json").intakeState.sourceDigest')" node -e '
    const { readFileSync, writeFileSync } = require("fs");
    const d = JSON.parse(readFileSync("draft.json", "utf8"));
    d.discovery.sourceDigest = process.env.SOURCE_DIGEST;
    writeFileSync("draft.json", JSON.stringify(d, null, 2));'
  node .claude/harness/foundation.mjs start draft.json --inspect > .foundation/start-inspect.json
  node -e 'if (require("./.foundation/start-inspect.json").action !== "DONE") process.exit(1)'
  if ! node .claude/harness/foundation.mjs start draft.json > start.log 2>&1; then
    cat start.log >&2
    exit 1
  fi
  change_id="$(sed -n 's/^AGREED \([^[:space:]]*\).*$/\1/p' start.log | head -n 1)"
  if [ -z "$change_id" ]; then
    echo "FAIL: start did not report an agreed change id" >&2
    cat start.log >&2
    exit 1
  fi
  node .claude/harness/foundation.mjs resolve "$change_id" --approve-spec --decision-ref fixture://user/spec >> start.log 2>&1
  if [ "${5:-}" = worktree ]; then
    # Fixture-only intake outputs must be in the base before isolation; an
    # evolving untracked start.log otherwise selects copy isolation.
    git add draft.json start.log
    git commit -qm 'record fixture intake outputs before worktree isolation'
  fi
  node .claude/harness/foundation.mjs advance "$change_id" --through build >> start.log 2>&1
}

implement() {
  ws="$(node -e "console.log(require('./.foundation/runtime/$1.json').workspace.path)")"
  printf 'v2\n' > "$ws/app.txt"
  sed -i.bak 's/- \[ \]/- [x]/g' "$ws/openspec/changes/$1/tasks.md"
  rm "$ws/openspec/changes/$1/tasks.md.bak"
}

# --- A report inside the hashed surface is refused a silent failure. ---------
setup_project at-root
draft "Report / API::  Root" "report.json"
assert_file_contains "a report inside the hashed surface is named before a run is spent" \
  start.log "writes its report to report.json, inside the hashed workspace surface"
assert_file_exists "the exact agreed id survives punctuation and repeated separators" \
  ".foundation/runtime/$change_id.json"
implement "$change_id"
root_proof="$({ node .claude/harness/foundation.mjs proof-run "$change_id"; } 2>&1 || true)"
assert_contains "the provider still runs and still passes" "$root_proof" "RECEIPT"
# The warning above still earns its place — a report at the root is a bad habit
# and the run says so. What it no longer does is void the run: the report is
# untracked and no task declares it, so it is not this change's surface and
# cannot expire the evidence just collected.
assert_contains "a report outside the declared surface no longer voids its own run" \
  "$root_proof" "PROVEN $change_id"
assert_not_contains "an undeclared report is not reported as a mid-run change" \
  "$root_proof" "the workspace hash changed while providers ran"

# The expiry message still has a job. Declare the report path and the same run
# voids itself again: a declared path written while providers run is a real
# mid-run change to this change's surface, and finalization has to name it.
setup_project at-root-declared
draft "Report at root declared" "report.json" 1
implement report-at-root-declared
declared_proof="$({ node .claude/harness/foundation.mjs proof-run report-at-root-declared; } 2>&1 || true)"
assert_contains "a declared report written mid-run still expires the evidence" \
  "$declared_proof" "the workspace hash changed while providers ran"
assert_contains "finalization names the remedy" "$declared_proof" "test-results/"

# --- `prove` finalizes; it does not execute. --------------------------------
setup_project excluded
draft "Report excluded" "test-results/report.json"
assert_not_contains "an excluded report path draws no warning" \
  "$(cat start.log)" "inside the hashed workspace surface"
implement report-excluded
premature="$({ node .claude/harness/foundation.mjs prove report-excluded; } 2>&1 || true)"
assert_contains "finalizing before execution names the operation that executes" \
  "$premature" "claude-foundation proof run report-excluded"

# --- The same loop, completed. ----------------------------------------------
assert_cmd_zero "readiness clears once the implementation is complete" \
  node .claude/harness/foundation.mjs proof-readiness report-excluded
proven="$(node .claude/harness/foundation.mjs proof-run report-excluded)"
assert_contains "an executable provider proves the change" "$proven" "PROVEN report-excluded"
assert_contains "proof names Land as the next phase" "$proven" "next: /land report-excluded"
assert_contains "land check confirms the proven projection" \
  "$(node .claude/harness/foundation.mjs land-check report-excluded)" "LAND READY"
assert_contains "changes reports the change as ready to land" \
  "$(node .claude/harness/foundation.mjs changes)" "ready-to-land"

# A user may accept the remaining review risk without discarding earned tests.
setup_project review-waiver
export FOUNDATION_FIXTURE_PREREQUISITE="$TMP/dependency-ready"
printf '%s\n' '{"workflow":{"grounding":"optional","reviewPolicy":"risk-tiered"},"land":{"riskBasedCi":false},"sandbox":{"setupCommand":"test -f \"$FOUNDATION_FIXTURE_PREREQUISITE\""}}' > foundation.json
draft "Review waiver" "test-results/report.json"
assert_eq "installed consumer retains failed setup for retry" failed \
  "$(node -p 'require("./.foundation/runtime/review-waiver.json").workspace.setup.status')"
printf 'available\n' > "$FOUNDATION_FIXTURE_PREREQUISITE"
node .claude/harness/foundation.mjs advance review-waiver --through build >/dev/null
assert_eq "fresh installed runtime retries restored setup" ok \
  "$(node -p 'require("./.foundation/runtime/review-waiver.json").workspace.setup.status')"
# Synthetic fixture telemetry exercises an explicitly authorized continuation.
unset FOUNDATION_CLAUDE_SESSION_ID FOUNDATION_CLAUDE_TRANSCRIPT_PATH CODEX_THREAD_ID FOUNDATION_SESSION_ID
export FOUNDATION_RUN_ID=fixture-budget-recovery
node .claude/harness/foundation.mjs event review-waiver --request fixture-exhaustion --input 800000 --output 0 >/dev/null
assert_eq "installed consumer stops at exhausted budget" operator-required \
  "$(node -p 'require("./.foundation/runtime/review-waiver.json").budget.window.mode')"
node .claude/harness/foundation.mjs budget-continue review-waiver --reason "Fixture user authorizes completion" --decision-ref fixture://user/budget >/dev/null
assert_eq "installed continuation records one authorized window" 1 \
  "$(node -p 'require("./.foundation/runtime/review-waiver.json").budget.window.extensionNumber')"
implement review-waiver
review_ws="$ws"
# An installed consumer must recover on a fresh CLI process after a missing
# provider dependency and a real product failure, without a replacement Change.
mv "$ws/run-test.sh" "$TMP/run-test.saved"
missing_provider="$({ node .claude/harness/foundation.mjs proof-collect review-waiver; } 2>&1 || true)"
assert_not_contains "missing provider cannot produce proof" "$missing_provider" 'PROVEN review-waiver'
assert_contains "missing provider identifies its command" "$missing_provider" 'run-test.sh'
mv "$TMP/run-test.saved" "$ws/run-test.sh"
printf 'v1\n' > "$ws/app.txt"
failed_product="$({ node .claude/harness/foundation.mjs proof-collect review-waiver; } 2>&1 || true)"
assert_not_contains "failed product cannot produce proof" "$failed_product" 'PROVEN review-waiver'
assert_cmd_zero "installed consumer records the failed product test" node -e \
  'const r=require("./.foundation/receipts/review-waiver/test.json"); if (r.status !== "fail") process.exit(1)'
printf 'v2\n' > "$ws/app.txt"
node .claude/harness/foundation.mjs proof-collect review-waiver >/dev/null
pending_review="$({ node .claude/harness/foundation.mjs proof-run review-waiver; } 2>&1 || true)"
assert_contains "review is required before the waiver" "$pending_review" 'review'
if [ ! -f .foundation/receipts/review-waiver/test.json ]; then
  printf '%s\n' "$pending_review" >&2
fi
test_receipt_before="$(shasum .foundation/receipts/review-waiver/test.json)"
node .claude/harness/foundation.mjs waive review-waiver --capability review \
  --reason "User accepts unreviewed scope after repair" --decision-ref fixture://user/land-risk >/dev/null
waived_proof="$(node .claude/harness/foundation.mjs advance review-waiver --through proven)"
assert_contains "waived review resumes through the normal coordinator" "$waived_proof" '"reached":"proven"'
assert_eq "review waiver preserves the earned test receipt" "$test_receipt_before" \
  "$(shasum .foundation/receipts/review-waiver/test.json)"
assert_contains "Land exposes the accepted review exception" \
  "$(node .claude/harness/foundation.mjs land-check review-waiver)" 'review'
printf 'v3\n' > "$ws/app.txt"
stale_waiver="$({ node .claude/harness/foundation.mjs proof-readiness review-waiver; } 2>&1 || true)"
assert_contains "changing the diff expires the review waiver" "$stale_waiver" 'waiver-stale'

# A v4 amendment uses the same public intake gate, preserves an unaffected
# declared-input receipt, reruns the affected provider through advance, and
# leaves a durable rebind audit.
setup_project amendment-selective
draft "Selective amendment" "test-results/report.json" "" 1 worktree
implement selective-amendment
node .claude/harness/foundation.mjs proof-collect selective-amendment >/dev/null
lint_before="$(shasum .foundation/receipts/selective-amendment/lint.json)"
test_before="$(shasum .foundation/receipts/selective-amendment/test.json)"
node -e '
  const { writeFileSync } = require("fs");
  const dimensions = ["current-behavior", "affected-actor", "desired-behavior",
    "success-path", "failure-path", "input-boundary", "compatibility", "non-goals",
    "verification"];
  const amendment = { version: 1, reason: "Cover the observed v2 persistence",
    size: "l", coupling: "isolated",
    addRequirements: [{ key: "v2-persists", capability: "application", operation: "added",
      scenario: "The updated value is read", outcome: "v2 remains observable" }],
    updateTasks: [{ key: "update-app", covers: ["greeting-updated", "v2-persists"] }],
    evidence: { "v2-persists": { capabilities: ["test"] } },
    discovery: { coverage: dimensions.map((dimension) => ({ dimension,
      status: "covered", covers: ["v2-persists"] })), decisions: [] } };
  writeFileSync("amendment.json", JSON.stringify(amendment, null, 2));'
node .claude/harness/foundation.mjs amend selective-amendment amendment.json --inspect \
  > .foundation/amendment-inspect.json
assert_contains "amendment first inspection pauses for intake repair" \
  "$(cat .foundation/amendment-inspect.json)" '"action": "EDIT"'
assert_contains "amendment inspection adapts coverage to the installed repository" \
  "$(cat .foundation/amendment-inspect.json)" 'data-migration'
AMENDMENT_SOURCE_DIGEST="$(node -p 'require("./.foundation/amendment-inspect.json").intakeState.sourceDigest')" \
  node -e '
    const { readFileSync, writeFileSync } = require("fs");
    const a = JSON.parse(readFileSync("amendment.json", "utf8"));
    const inspected = JSON.parse(readFileSync(".foundation/amendment-inspect.json", "utf8"));
    a.discovery.coverage = inspected.intelligence.depth.requiredDimensions.map(
      (dimension) => ({ dimension, status: "covered", covers: ["v2-persists"] }));
    a.discovery.sourceDigest = process.env.AMENDMENT_SOURCE_DIGEST;
    writeFileSync("amendment.json", JSON.stringify(a, null, 2));'
node .claude/harness/foundation.mjs amend selective-amendment amendment.json --inspect \
  > .foundation/amendment-inspect.json
assert_contains "amendment reaches the resumable DONE gate" \
  "$(cat .foundation/amendment-inspect.json)" '"action": "DONE"'
amended="$(node .claude/harness/foundation.mjs amend selective-amendment amendment.json \
  --consume-amendment)"
assert_contains "amendment prints the exact proof recovery command" "$amended" \
  'claude-foundation advance selective-amendment --through proven'
assert_not_contains "unaffected lint receipt is rebound rather than left byte-identical" \
  "$(shasum .foundation/receipts/selective-amendment/lint.json)" "$lint_before"
assert_eq "affected test receipt remains stale until Prove reruns it" "$test_before" \
  "$(shasum .foundation/receipts/selective-amendment/test.json)"
assert_file_contains "preserved receipt records its amendment rebind" \
  .foundation/receipts/selective-amendment/lint.json 'unaffected-semantic-amendment'
lint_execution_before="$(node -p \
  'require("./.foundation/receipts/selective-amendment/lint.json").commandExecutionId')"
assert_cmd_zero "amendment writes one digest-bound rebind audit" sh -c '
  set -- .foundation/evidence/selective-amendment/receipt-rebinds/*.json
  [ "$#" -eq 1 ] && grep -q priorReceiptDigest "$1" && grep -q reboundReceiptDigest "$1"'
amendment_blocked="$(node .claude/harness/foundation.mjs advance selective-amendment --through proven)"
assert_contains "amended agreement fails closed until its exact spec is re-approved" \
  "$amendment_blocked" 'spec-approval-required'
assert_contains "blocked advance preserves the exact recovery command" \
  "$amendment_blocked" 'claude-foundation advance selective-amendment --through proven'
assert_eq "authority pause does not spend the affected test receipt" "$test_before" \
  "$(shasum .foundation/receipts/selective-amendment/test.json)"
node .claude/harness/foundation.mjs resolve selective-amendment --approve-spec \
  --decision-ref fixture://user/amended-spec >/dev/null

# Replay must carry the isolated amended agreement, never import the old
# target packet or erase it while replacing the worktree.
packet_hash() {
  node --input-type=module -e '
    import { createStateRuntime } from "./.claude/harness/runtime/core/state-runtime.mjs";
    console.log(createStateRuntime({}).directoryHash(process.argv[1]));' "$1"
}
amended_ws="$ws"
packet_before="$(packet_hash "$ws/openspec/changes/selective-amendment")"
target_packet_before="$(packet_hash openspec/changes/selective-amendment)"
approval_before="$(node -p 'JSON.stringify(require("./.foundation/runtime/selective-amendment.json").specApproval)')"
revisions_before="$(node -p 'const s=require("./.foundation/runtime/selective-amendment.json"); [s.contractRevision,s.executionRevision].join(":")')"
assert_eq "amendment replay fixture uses a worktree" worktree \
  "$(node -p 'require("./.foundation/runtime/selective-amendment.json").workspace.mode')"
git commit --allow-empty -qm 'unrelated target movement after amendment'
moved_head="$(git rev-parse HEAD)"
amendment_sync="$(node .claude/harness/foundation.mjs sandbox sync selective-amendment)"
assert_contains "amended worktree replays to the moved base" "$amendment_sync" 'rebased: '
assert_eq "replay preserves every amended packet byte" "$packet_before" \
  "$(packet_hash "$ws/openspec/changes/selective-amendment")"
assert_eq "replay leaves the target agreement untouched" "$target_packet_before" \
  "$(packet_hash openspec/changes/selective-amendment)"
assert_eq "replay retains exact amendment approval" "$approval_before" \
  "$(node -p 'JSON.stringify(require("./.foundation/runtime/selective-amendment.json").specApproval)')"
assert_eq "replay does not invent contract or execution revisions" "$revisions_before" \
  "$(node -p 'const s=require("./.foundation/runtime/selective-amendment.json"); [s.contractRevision,s.executionRevision].join(":")')"
assert_eq "replay records the moved base" "$moved_head" \
  "$(node -p 'require("./.foundation/runtime/selective-amendment.json").workspace.baseHead')"
node .claude/harness/foundation.mjs advance selective-amendment --through proven \
  > .foundation/amendment-advance.out
amendment_proven="$(cat .foundation/amendment-advance.out)"
assert_contains "advance reruns affected proof and reaches proven" "$amendment_proven" \
  '"reached":"proven"'
assert_eq "advance does not re-execute the preserved lint provider" \
  "$lint_execution_before" "$(node -p \
    'require("./.foundation/receipts/selective-amendment/lint.json").commandExecutionId')"
assert_file_contains "advance retains the auditable amendment rebind" \
  .foundation/receipts/selective-amendment/lint.json 'unaffected-semantic-amendment'
assert_not_contains "advance replaces the affected test receipt" \
  "$(shasum .foundation/receipts/selective-amendment/test.json)" "$test_before"

# Restore the accepted bytes and complete the local saga with a deterministic
# OpenSpec stub. No remote/model execution is part of this regression.
cd "$TMP/review-waiver"
ws="$review_ws"
printf 'v2\n' > "$ws/app.txt"
mkdir -p "$TMP/bin"
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "$1" = "--version" ]; then echo 1.7.0; exit 0; fi' \
  'if [ "$1" = "archive" ]; then mkdir -p openspec/changes/archive; mv "openspec/changes/$2" "openspec/changes/archive/$2"; if [ -f .foundation/interrupt-archive ]; then rm .foundation/interrupt-archive; exit 1; fi; fi' \
  'exit 0' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"

cd "$TMP/amendment-selective"
git commit --allow-empty -qm 'second unrelated move before automatic Land recovery'
head_before="$(git rev-parse HEAD)"
index_before="$(git ls-files --stage | shasum)"
amendment_landed="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance selective-amendment --through archived)"
assert_contains "amended work reaches archived after base movement" "$amendment_landed" '"reached":"archived"'
assert_eq "amended Land preserves target HEAD" "$head_before" "$(git rev-parse HEAD)"
assert_eq "amended Land preserves target index" "$index_before" "$(git ls-files --stage | shasum)"
assert_file_contains "amended Land applies verified product bytes" app.txt 'v2'
assert_eq "archive retains the exact amended packet" "$packet_before" \
  "$(packet_hash openspec/changes/archive/selective-amendment)"

cd "$TMP/review-waiver"
printf 'operator work must survive\n' > operator-staged.txt
git add operator-staged.txt
printf 'untracked operator note\n' > operator-note.txt
head_before="$(git rev-parse HEAD)"
index_before="$(git ls-files --stage | shasum)"
printf 'newer operator edit\n' > app.txt
conflicted="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance review-waiver --through archived)"
assert_cmd_zero "installed consumer pauses on target conflict" env CONFLICT_OUTPUT="$conflicted" node -e \
  'const r=JSON.parse(process.env.CONFLICT_OUTPUT); if (r.action === "DONE" || !/conflict/i.test(JSON.stringify(r))) { console.error(r); process.exit(1); }'
assert_file_contains "target conflict preserves newer operator bytes" app.txt 'newer operator edit'
assert_eq "target conflict preserves index" "$index_before" "$(git ls-files --stage | shasum)"
# Fixture owner explicitly chooses the original target version; product work
# and earned proof remain in the isolated workspace, then Land can resume.
printf 'v1\n' > app.txt
touch .foundation/interrupt-archive
interrupted="$({ PATH="$TMP/bin:$PATH" FOUNDATION_SESSION_ID=before-interruption node .claude/harness/foundation.mjs archive review-waiver; } 2>&1 || true)"
assert_contains "archive interruption surfaces after moving the packet" "$interrupted" 'OpenSpec archive failed'
assert_file_exists "interrupted archive retains the moved packet" openspec/changes/archive/review-waiver/proposal.md
export FOUNDATION_SESSION_ID=after-interruption
# Execute the route taught by the installed slash command, through the public
# CLI. A stale instruction pointing at a compatibility primitive must fail this
# interrupted-archive regression even when the coordinator itself still works.
documented_land() {
  PATH="$TMP/bin:$PATH" node --input-type=module - "$ROOT/cli.sh" "$PWD" <<'NODE'
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [cli, project] = process.argv.slice(2);
const instruction = readFileSync(`${project}/.claude/commands/land.md`, "utf8");
const command = instruction.match(/Run `claude-foundation ([^`]+)`/)?.[1];
if (!command) throw new Error("installed Land instruction has no executable route");
const args = command.split(/\s+/).map((arg) => arg === "<change>" ? "review-waiver" : arg);
const result = spawnSync("bash", [cli, "--project", project, ...args], {
  encoding: "utf8", env: process.env
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE
}
landed="$(documented_land)"
assert_cmd_zero "Land emits one JSON outcome" env LAND_OUTPUT="$landed" \
  node -e 'JSON.parse(process.env.LAND_OUTPUT)'
assert_contains "accepted review risk can finish at archived" "$landed" '"reached":"archived"'
assert_eq "Land preserves HEAD" "$head_before" "$(git rev-parse HEAD)"
assert_eq "Land preserves the index" "$index_before" "$(git ls-files --stage | shasum)"
assert_file_contains "Land applies the accepted product bytes" app.txt 'v2'
assert_file_contains "installed consumer Land preserves unrelated staged work" \
  operator-staged.txt 'operator work must survive'
assert_file_contains "installed consumer Land preserves unrelated untracked work" \
  operator-note.txt 'untracked operator note'
assert_eq "installed consumer archive records mode-bound delivery evidence" 2 \
  "$(node -p 'require("./.foundation/runtime/review-waiver.json").deliveryIntegrity.version')"
assert_eq "recovered Land consumes the fresh-session grant" consumed \
  "$(node -p 'require("./.foundation/transactions/review-waiver/land-grant.json").status')"
resumed="$(documented_land)"
assert_contains "fresh installed runtime resumes completed Land idempotently" "$resumed" '"reached":"archived"'
assert_eq "repeated archive preserves target HEAD" "$head_before" "$(git rev-parse HEAD)"
assert_eq "repeated archive preserves target index" "$index_before" "$(git ls-files --stage | shasum)"

finish "proof loop"
