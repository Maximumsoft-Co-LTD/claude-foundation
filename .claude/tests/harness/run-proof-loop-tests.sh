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
  mkdir -p "$TMP/$1/.claude/harness" "$TMP/$1/openspec"
  cp -R "$ROOT/.claude/harness/." "$TMP/$1/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$TMP/$1/openspec/"
  cp "$ROOT/openspec/config.yaml" "$TMP/$1/openspec/"
  cd "$TMP/$1"
  printf 'v1\n' > app.txt
  printf '%s\n' '#!/usr/bin/env sh' 'grep -q v2 app.txt || exit 1' \
    'mkdir -p "$(dirname "$1")"' \
    'printf "{\"numTotalTests\":1,\"numPassedTests\":1,\"success\":true}" > "$1"' \
    > run-test.sh
  printf '.foundation/\n' > .gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

# $1 = change id, $2 = report path the provider writes
draft() {
  node .claude/harness/foundation.mjs start --template > draft.json
  REPORT="$2" TITLE="$1" DECLARE_REPORT="${3:-}" node -e '
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
    d.evidence = { "greeting-updated": { capabilities: ["test"] } };
    d.execution = { version: 1, providers: { test: { adapter: "test-discovery",
      command: ["sh", "run-test.sh", process.env.REPORT], report: process.env.REPORT,
      minimum: 1, timeoutMs: 60000 } }, services: {} };
    writeFileSync("draft.json", JSON.stringify(d, null, 2));'
  node .claude/harness/foundation.mjs start draft.json > start.log 2>&1
  change_id="$(sed -n 's/^AGREED \([^[:space:]]*\).*$/\1/p' start.log | head -n 1)"
  if [ -z "$change_id" ]; then
    echo "FAIL: start did not report an agreed change id" >&2
    cat start.log >&2
    exit 1
  fi
  node .claude/harness/foundation.mjs resolve "$change_id" --approve-spec --decision-ref fixture://user/spec >> start.log 2>&1
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
printf '%s\n' '{"workflow":{"grounding":"optional","reviewPolicy":"risk-tiered"},"land":{"riskBasedCi":false}}' > foundation.json
draft "Review waiver" "test-results/report.json"
implement review-waiver
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

# Restore the accepted bytes and complete the local saga with a deterministic
# OpenSpec stub. No remote/model execution is part of this regression.
printf 'v2\n' > "$ws/app.txt"
mkdir -p "$TMP/bin"
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "$1" = "--version" ]; then echo 1.7.0; exit 0; fi' \
  'if [ "$1" = "archive" ]; then mkdir -p openspec/changes/archive; mv "openspec/changes/$2" "openspec/changes/archive/$2"; fi' \
  'exit 0' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
head_before="$(git rev-parse HEAD)"
index_before="$(git ls-files --stage | shasum)"
landed="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance review-waiver --through archived)"
assert_cmd_zero "Land emits one JSON outcome" env LAND_OUTPUT="$landed" \
  node -e 'JSON.parse(process.env.LAND_OUTPUT)'
assert_contains "accepted review risk can finish at archived" "$landed" '"reached":"archived"'
assert_eq "Land preserves HEAD" "$head_before" "$(git rev-parse HEAD)"
assert_eq "Land preserves the index" "$index_before" "$(git ls-files --stage | shasum)"
assert_file_contains "Land applies the accepted product bytes" app.txt 'v2'

finish "proof loop"
