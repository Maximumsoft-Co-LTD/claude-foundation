#!/usr/bin/env sh
# The seams of the change loop, where state crosses a boundary.
#
# Every defect pinned here survived the rest of the suite because each half
# works alone. `evidence init --write` writes; `sandbox sync` syncs; together
# the sync deleted what the init had just written. `sandbox create` copies; a
# repository has ignored build output; together the copy filled the disk. What
# these assertions hold is the handoff, not either side of it.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

F="node .claude/harness/foundation.mjs"
# Command logs live outside the project. Written inside it they are themselves
# untracked dirt, which is exactly the condition these scenarios measure — the
# first draft of this suite made `sandbox create` report its own redirect file
# as the dirty target, and blamed the code for it.
LOGS="$TMP/logs"
mkdir -p "$LOGS"

# One project per scenario: two changes holding sandboxes on one repository is a
# repository conflict, which is a real blocker and not the one under test.
setup_project() {
  mkdir -p "$TMP/$1/.claude/harness" "$TMP/$1/openspec" "$TMP/$1/src"
  cp -R "$ROOT/.claude/harness/." "$TMP/$1/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$TMP/$1/openspec/"
  cp "$ROOT/openspec/config.yaml" "$TMP/$1/openspec/"
  cd "$TMP/$1"
  printf 'export function add(a,b){return a+b;}\n' > src/calc.js
  printf '{"name":"seam","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n' \
    > package.json
  mkdir -p test
  printf 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/calc.js";\ntest("add", () => assert.equal(add(1,2), 3));\n' \
    > test/calc.test.js
  # How an installed project actually looks: the root ignore file says nothing
  # about `.foundation/`, and `.foundation/.gitignore` — itself tracked, because
  # the installer manages it — ignores the machine state beside it. A fixture
  # that ignored `.foundation/` wholesale could not carry the tracked file the
  # installer checks for, which is the condition these scenarios measure.
  printf 'build-output/\n' > .gitignore
  mkdir -p .foundation
  printf '*\n!.gitignore\n!README.md\n' > .foundation/.gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

providers_of() {
  node -e "
    const fs=require('fs');
    const p='$1';
    if(!fs.existsSync(p)){console.log('MISSING');process.exit(0)}
    console.log(Object.keys(JSON.parse(fs.readFileSync(p,'utf8')).providers||{}).sort().join(',')||'NONE')"
}

# --- Detected provider config survives a sync. ------------------------------
setup_project init-survives-sync
$F new "add subtract to calc" --rapid > /dev/null
C=add-subtract-to-calc
$F sandbox create "$C" > /dev/null
$F evidence-init "$C" --write > "$LOGS/init.log" 2>&1

assert_file_contains "evidence init reports the provider it wired" "$LOGS/init.log" '"test"'
assert_eq "the durable change directory carries the provider" \
  "test" "$(providers_of "openspec/changes/$C/execution.yaml")"
assert_eq "the active sandbox sees it without a sync" \
  "test" "$(providers_of ".foundation/sandboxes/$C/openspec/changes/$C/execution.yaml")"

$F sandbox sync "$C" > /dev/null
assert_eq "a sync does not destroy it in the durable directory" \
  "test" "$(providers_of "openspec/changes/$C/execution.yaml")"
assert_eq "a sync does not destroy it in the sandbox" \
  "test" "$(providers_of ".foundation/sandboxes/$C/openspec/changes/$C/execution.yaml")"

# --- Git-ignored output is neither copied nor hashed. -----------------------
setup_project ignores-build-output
mkdir -p build-output/nested
# Large enough that a copy is unmistakable, cheap enough to stay a unit test.
dd if=/dev/zero of=build-output/nested/artifact.bin bs=1024 count=4096 2>/dev/null
printf 'generated\n' > build-output/report.txt
$F new "copy skips ignored output" --rapid > /dev/null
C=copy-skips-ignored-output
# A dirty tracked file forces copy mode, which is the mode under test. Dirtied
# after the change exists, because dirt the tree already carried no longer costs
# a change its worktree — writing it first would now select the other mode.
printf 'export function add(a,b){return a+b;}\n// touched\n' > src/calc.js
$F sandbox create "$C" > "$LOGS/create.log" 2>&1

assert_file_contains "a dirty tracked file still selects copy mode" "$LOGS/create.log" "isolated-copy"
assert_file_absent "the copy omits the git-ignored directory" \
  ".foundation/sandboxes/$C/build-output/nested/artifact.bin"
assert_file_exists "the copy still carries tracked source" \
  ".foundation/sandboxes/$C/src/calc.js"
# The installer checks `.foundation/.gitignore` as a source precondition, so a
# sandbox that omits it cannot run `run-installer-tests.sh` at all — Build could
# not verify the installer it was changing. Tracked files under the root-only
# excluded directories are carried; untracked machine state still is not, which
# is what keeps the copy from recursing into itself.
assert_file_exists "a tracked file under .foundation reaches the sandbox" \
  ".foundation/sandboxes/$C/.foundation/.gitignore"
assert_file_absent "untracked machine state stays out of the sandbox" \
  ".foundation/sandboxes/$C/.foundation/runtime"
assert_file_absent "the sandbox does not contain itself" \
  ".foundation/sandboxes/$C/.foundation/sandboxes"

assert_eq "the recorded baseline holds no ignored entry" "0" \
  "$(node -e "
    const j=require('$TMP/ignores-build-output/.foundation/runtime/$C.json');
    const k=Object.keys(j.workspace.baseline||{});
    process.stdout.write(String(k.filter((p)=>p.startsWith('build-output/')).length))")"

# --- Another change's uncommitted draft keeps worktree isolation. -----------
setup_project concurrent-drafts
$F new "first change" --rapid > /dev/null
$F new "second change" --rapid > /dev/null
# Both drafts are uncommitted, which is how the loop keeps them until Land.
$F sandbox create second-change > "$LOGS/second.log" 2>&1

assert_file_not_contains "an unrelated draft does not force a copy" "$LOGS/second.log" "isolated-copy"
assert_file_not_contains "the draft is not reported as a dirty target" "$LOGS/second.log" "dirty-target"

# --- A rapid proposal validates against OpenSpec. ---------------------------
setup_project rapid-validates
$F new "rapid header probe" --rapid > /dev/null
assert_file_contains "the rapid template uses the required Why header" \
  "openspec/changes/rapid-header-probe/proposal.md" "## Why"
assert_file_contains "the rapid template uses the required What Changes header" \
  "openspec/changes/rapid-header-probe/proposal.md" "## What Changes"
assert_file_not_contains "the merged header is gone" \
  "openspec/changes/rapid-header-probe/proposal.md" "## Why and what"

# --- The orphan diagnostic names its supported exit. ------------------------
setup_project orphan-exit
$F new "orphan probe" --rapid > /dev/null
rm -rf openspec/changes/orphan-probe
orphan_doctor="$({ $F doctor --change orphan-probe; } 2>&1 || true)"
assert_contains "the orphan diagnostic names change abandon" \
  "$orphan_doctor" "change abandon"
assert_not_contains "the orphan diagnostic no longer prescribes a manual move" \
  "$orphan_doctor" "recovery/orphaned-runtime/"
assert_contains "changes still reports the orphan" \
  "$($F changes 2>&1 || true)" "orphan-runtime"
# The named command is the one that actually works.
assert_cmd_zero "the named command retires the orphan" \
  node .claude/harness/foundation.mjs abandon orphan-probe --reason cleanup --decision-ref test
assert_not_contains "the orphan is gone afterwards" \
  "$($F changes 2>&1 || true)" "orphan-runtime"

# --- What the tree already carried is not this change's surface. ------------
#
# The surface comes from `git status`, which cannot tell a file this change
# wrote from one that was simply lying around. A stray untracked stylesheet
# therefore pulled the `accessibility` policy trigger onto a rapid change that
# had touched nothing of the kind, and the author was asked for evidence they
# could not honestly produce.
setup_project preexisting-surface
printf 'body { color: red }\n' > theme.css
mkdir -p notes && printf 'todo\n' > notes/scratch.md
$F new "tiny tweak" --rapid > /dev/null
C=tiny-tweak

providers_for() {
  $F packet "$1" --phase prove 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; })
      .on("end", () => {
        process.stdout.write(JSON.parse(s).providers.map((p) => p.provider).sort().join(","));
      });'
}

assert_eq "a stray untracked file is not this change's surface" \
  "discovery,test" "$(providers_for "$C")"

# The same file, once the change actually edits it, is surface again — which is
# why this is compared by digest and not by remembering the path.
printf 'body { color: blue }\n' > theme.css
assert_eq "editing a pre-existing file returns it to the surface" \
  "accessibility,discovery,test" "$(providers_for "$C")"

# --- Pre-existing dirt does not cost a change its worktree. -----------------
#
# The surface already ignores what the tree carried in, but `sandbox create`
# chose its isolation mode by a separate test that did not. One stray untracked
# file therefore downgraded every sandbox to a whole-tree copy — the lower
# fidelity mode, and on a large repository the expensive one.
setup_project preexisting-isolation
printf 'stray\n' > stray.txt
$F new "probe one" --rapid > /dev/null
$F new "probe two" --rapid > /dev/null

$F sandbox create probe-one > "$LOGS/probe-one.log" 2>&1
assert_file_not_contains "an untouched stray file does not force a copy" \
  "$LOGS/probe-one.log" "isolated-copy"

# Edited after the change began, the same file is a dirty target again — which
# is why the comparison is by digest and not by remembering the path.
printf 'stray edited\n' > stray.txt
$F sandbox create probe-two > "$LOGS/probe-two.log" 2>&1
assert_file_contains "editing that file makes it a dirty target again" \
  "$LOGS/probe-two.log" "dirty-target"

# --- A rapid change is valid to OpenSpec. -----------------------------------
#
# The rapid schema declares no spec artifact, so a rapid change never has deltas
# to find, and OpenSpec reads that absence as an error rather than an omission.
# Every rapid change was invalid, and Land printed the validator's five-line
# remedy at the user each time.
setup_project rapid-validity
$F new "rapid validity probe" --rapid > /dev/null
assert_file_contains "a rapid change declares it modifies no specs" \
  "openspec/changes/rapid-validity-probe/.openspec.yaml" "skip_specs: true"
$F new "standard validity probe" > /dev/null
assert_file_not_contains "a standard change still owes its spec deltas" \
  "openspec/changes/standard-validity-probe/.openspec.yaml" "skip_specs"

# --- Upgrading a project retires the superseded guard command. --------------
#
# `run-installer-tests.sh` covers the installer, but it cannot run here: a copy
# sandbox never carries `.foundation/`, whose `.gitignore` the installer checks
# as a source precondition, so the suite fails before it starts. This scenario
# therefore builds its own complete source tree and exercises just the seam that
# matters — `upsert` matches on the command string, so a guard whose command
# changed lands beside the old one unless retirement removes it first.
if command -v jq > /dev/null 2>&1; then
  source_tree="$TMP/upgrade-source"
  mkdir -p "$source_tree"
  cp -R "$ROOT/.claude" "$ROOT/openspec" "$source_tree/"
  cp "$ROOT/install.sh" "$ROOT/foundation.json" "$ROOT/WORKFLOW.md" "$source_tree/"
  mkdir -p "$source_tree/.foundation"
  printf 'runtime/\n' > "$source_tree/.foundation/.gitignore"
  printf '# machine state\n' > "$source_tree/.foundation/README.md"

  target="$TMP/upgrade-target"
  mkdir -p "$target/.claude"
  printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Edit|Write|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR}\"/.claude/hooks/phase-mutation-guard.mjs","timeout":5}]}]}}' \
    > "$target/.claude/settings.json"

  sh "$source_tree/install.sh" "$target" --yes --source "$source_tree" \
    > "$LOGS/upgrade.log" 2>&1 || true

  assert_file_not_contains "upgrading retires the superseded guard command" \
    "$target/.claude/settings.json" "phase-mutation-guard.mjs"
  assert_eq "exactly one phase guard is wired after upgrading" "1" \
    "$(grep -c 'phase-mutation-guard\.sh' "$target/.claude/settings.json")"
else
  pass "upgrade retirement skipped: jq unavailable, installer merges manually"
  pass "upgrade retirement skipped: jq unavailable, installer merges manually"
fi

# --- Test evidence proves in more than one repository. ----------------------
#
# A `test-discovery` provider not literally named `test` must name a
# `discoveryProvider`, and that reference had no satisfiable target: the
# discovery half was refused this adapter, every other adapter passed validation
# and then failed at execution because none can produce a discovered count, and
# the scheduler only collapsed the pair when their configs hashed identically —
# impossible once `capability` differs. So a change with test claims in two
# repositories could not be proven at all.
setup_multirepo() {
  root="$TMP/$1"
  mkdir -p "$root"
  for repository in api app; do
    mkdir -p "$root/services/$repository/src" "$root/services/$repository/test"
    (
      cd "$root/services/$repository"
      printf "export const n = '%s';\n" "$repository" > src/index.js
      printf '{"name":"%s","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n' \
        "$repository" > package.json
      printf 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { n } from "../src/index.js";\ntest("n", () => assert.ok(n));\n' \
        > test/index.test.js
      git init -q . && git config user.email t@t && git config user.name t
      git add -A && git commit -qm init
    )
  done
  mkdir -p "$root/.claude/harness" "$root/openspec"
  cp -R "$ROOT/.claude/harness/." "$root/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$root/openspec/"
  cp "$ROOT/openspec/config.yaml" "$root/openspec/"
  cd "$root"
  printf 'services/\n' > .gitignore
  printf '# control plane\n' > README.md
  cat > openspec/repositories.yaml <<'JSON'
{ "version": 1, "repositories": [
  { "id": "api", "type": "git", "path": "services/api", "mode": "write", "dependsOn": [] },
  { "id": "app", "type": "git", "path": "services/app", "mode": "write", "dependsOn": [] } ] }
JSON
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

setup_multirepo two-repo-evidence
$F new "two repo evidence" --rapid > /dev/null
C=two-repo-evidence
cat > "openspec/changes/$C/repositories.yaml" <<'JSON'
{ "version": 1, "repositories": [
  { "id": "root", "mode": "write", "dependsOn": [] },
  { "id": "api", "mode": "write", "dependsOn": [] },
  { "id": "app", "mode": "write", "dependsOn": [] } ] }
JSON
cat > "openspec/changes/$C/evidence.yaml" <<'JSON'
{ "version": 2, "claims": [
  { "id": "api-c", "scenario": "api behaviour", "impact": "low", "capabilities": ["test"], "repositories": ["api"] },
  { "id": "app-c", "scenario": "app behaviour", "impact": "low", "capabilities": ["test"], "repositories": ["app"] } ] }
JSON
cat > "openspec/changes/$C/execution.yaml" <<'JSON'
{ "version": 1, "providers": {
  "test-api": { "capability": "test", "adapter": "test-discovery", "repository": "api",
    "discoveryProvider": "discovery-api",
    "command": ["npm","test","--","--test-reporter=tap"], "minimum": 1, "reportFormat": "tap" },
  "discovery-api": { "capability": "discovery", "adapter": "test-discovery", "repository": "api",
    "command": ["npm","test","--","--test-reporter=tap"], "minimum": 1, "reportFormat": "tap" },
  "test-app": { "capability": "test", "adapter": "test-discovery", "repository": "app",
    "discoveryProvider": "discovery-app",
    "command": ["npm","test","--","--test-reporter=tap"], "minimum": 1, "reportFormat": "tap" },
  "discovery-app": { "capability": "discovery", "adapter": "test-discovery", "repository": "app",
    "command": ["npm","test","--","--test-reporter=tap"], "minimum": 1, "reportFormat": "tap" } },
  "services": {} }
JSON
printf '# Tasks\n\n- [x] **T001** api — verify: `npm test` [claims:api-c] [repo:api] [paths:src/**]\n- [x] **T002** app — verify: `npm test` [claims:app-c] [repo:app] [paths:src/**]\n' \
  > "openspec/changes/$C/tasks.md"

assert_cmd_zero "a repository-scoped discovery provider validates" \
  node .claude/harness/foundation.mjs validate "$C"
$F sandbox create "$C" > /dev/null 2>&1
proof="$($F proof-run "$C" 2>&1 || true)"
assert_contains "each repository's test provider runs once" \
  "$proof" "EXECUTION"
assert_contains "the api discovery receipt is written by its test provider" \
  "$proof" "RECEIPT $C/discovery-api: pass"
assert_contains "the app discovery receipt is written by its test provider" \
  "$proof" "RECEIPT $C/discovery-app: pass"
assert_contains "test evidence proves in both repositories" "$proof" "PROVEN $C"
assert_not_contains "no discovery provider is scheduled on its own" \
  "$proof" "requires --discovered"

# --- A review response records through the authority bridge. ----------------
#
# `authority record` accepts only --request and --response, while the receipt it
# writes requires implementation provenance. The response file is the only place
# that provenance can come from, so the emitted template has to name it: without
# these fields the documented path dead-ends on a flag the command rejects.
setup_project authority-review
$F new "review response records" > /dev/null
C=review-response-records
$F resolve "$C" --impact high --coupling coupled --acceptance-not-required > /dev/null
$F sandbox create "$C" > /dev/null
sed -i.bak 's/- \[ \]/- [x]/g' "openspec/changes/$C/tasks.md" && rm -f "openspec/changes/$C/tasks.md.bak"
$F sandbox sync "$C" > /dev/null
$F authority-request "$C" --type review > "$LOGS/request.json" 2>&1
$F authority-status "$C" --template > "$LOGS/template.json" 2>&1

assert_file_contains "the review template names the reviewer type" \
  "$LOGS/template.json" '"reviewer-type"'
assert_file_contains "the review template names implementation provenance" \
  "$LOGS/template.json" '"subject-actor"'

# Fill the emitted template exactly as a responder would: a human reviewer, an
# AI implementer, and nothing invented that the template did not ask for.
node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  const template = JSON.parse(raw.slice(raw.indexOf("{")));
  template.status = "pass";
  template.evidence.observed = "Reviewed the change and its evidence.";
  template.evidence.reference = ["openspec/changes"];
  template.evidence.reviewer = "a-human-reviewer";
  template.evidence["reviewer-type"] = "human";
  template.evidence["subject-actor"] = "an-implementing-agent";
  template.evidence["subject-session"] = "session-under-test";
  template.evidence["subject-provider-family"] = "anthropic";
  template.evidence["subject-model-family"] = "claude";
  template.evidence["subject-model"] = "model-under-test";
  fs.writeFileSync(process.argv[2], JSON.stringify(template, null, 2));
' "$LOGS/template.json" "$LOGS/response.json"

request_id="$(node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.parse(raw.slice(raw.indexOf("{"))).requestId);
' "$LOGS/response.json")"

recorded="$($F authority-record "$C" --request "$request_id" --response "$LOGS/response.json" 2>&1 || true)"
assert_contains "a template-shaped review response records" "$recorded" "AUTHORITY $request_id: pass"
assert_not_contains "no unsupported provenance flag is demanded" "$recorded" "subject-actor for implementation provenance"
assert_file_exists "the review receipt is written" ".foundation/receipts/$C/review.json"

finish "changeloop seams"
