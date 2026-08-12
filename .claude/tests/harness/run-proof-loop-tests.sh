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
    d.tasks = [{ id: "T001", outcome: "Update app.txt", kind: "implementation",
      paths: (process.env.DECLARE_REPORT ? ["app.txt", process.env.REPORT] : ["app.txt"]),
      verify: "sh run-test.sh " + process.env.REPORT }];
    d.claims = [{ id: "greeting-updated", scenario: "app.txt carries v2",
      impact: "low", capabilities: ["test"] }];
    d.execution.providers.test = { adapter: "test-discovery",
      command: ["sh", "run-test.sh", process.env.REPORT],
      report: process.env.REPORT, minimum: 1, timeoutMs: 60000 };
    writeFileSync("draft.json", JSON.stringify(d, null, 2));'
  node .claude/harness/foundation.mjs start draft.json > start.log 2>&1
}

implement() {
  ws="$(node -e "console.log(require('./.foundation/runtime/$1.json').workspace.path)")"
  printf 'v2\n' > "$ws/app.txt"
  sed -i.bak 's/- \[ \]/- [x]/g' "$ws/openspec/changes/$1/tasks.md"
  rm "$ws/openspec/changes/$1/tasks.md.bak"
}

# --- A report inside the hashed surface is refused a silent failure. ---------
setup_project at-root
draft "Report at root" "report.json"
assert_file_contains "a report inside the hashed surface is named before a run is spent" \
  start.log "writes its report to report.json, inside the hashed workspace surface"
implement report-at-root
root_proof="$({ node .claude/harness/foundation.mjs proof-run report-at-root; } 2>&1 || true)"
assert_contains "the provider still runs and still passes" "$root_proof" "RECEIPT"
# The warning above still earns its place — a report at the root is a bad habit
# and the run says so. What it no longer does is void the run: the report is
# untracked and no task declares it, so it is not this change's surface and
# cannot expire the evidence just collected.
assert_contains "a report outside the declared surface no longer voids its own run" \
  "$root_proof" "PROVEN report-at-root"
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

finish "proof loop"
