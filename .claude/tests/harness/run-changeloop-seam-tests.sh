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

# --- The budget stop survives a renamed run. --------------------------------
#
# A new run id resets the window's usage, which is what a genuine host session
# rollover means. It must not also hand back the allowance: the id is
# caller-supplied. `activateBudgetWindow` carries `operator-required` across for
# exactly that reason — but nothing ever raised it, so an exhausted run read
# `completion-only`, and `--run anything-new` reset it to `normal` with a full
# fresh allowance. The gate re-armed indefinitely, with no decision recorded.
setup_project budget-stop
$F new "budget stop" --rapid > /dev/null
C=budget-stop

mode_of() {
  node -e "
    const w = require('$TMP/budget-stop/.foundation/runtime/$C.json').budget.window;
    process.stdout.write(w.mode + ':' + w.extensionNumber)"
}

$F event "$C" --request b1 --input 800000 --output 0 > /dev/null 2>&1
assert_eq "an exhausted first window is completion-only" "completion-only:0" "$(mode_of)"

# No extension spent yet, so a genuine rollover still earns a fresh window.
$F event "$C" --request b2 --run rollover --input 10 --output 0 > /dev/null 2>&1
assert_eq "a rollover before any extension still resets" "normal:0" "$(mode_of)"

$F event "$C" --request b3 --input 800000 --output 0 > /dev/null 2>&1
$F budget-continue "$C" --reason "operator window" --decision-ref ops-1 > /dev/null 2>&1
$F event "$C" --request b4 --input 800000 --output 0 > /dev/null 2>&1
assert_eq "exhausting the one extension raises the operator stop" "operator-required:1" "$(mode_of)"

$F event "$C" --request b5 --run escape-hatch --input 10 --output 0 > /dev/null 2>&1
assert_eq "a renamed run cannot clear that stop" "operator-required:1" "$(mode_of)"

stopped="$($F packet "$C" --phase change 2>/dev/null)"
assert_contains "the agent is told an operator decision is required" \
  "$stopped" '"action":"OPERATOR_REQUIRED"'
# The stop withholds new work, not the loop's own completion path.
assert_contains "required proof stays permitted under the stop" "$stopped" '"provider-run"'
assert_contains "Land recovery stays permitted under the stop" "$stopped" '"land-recovery"'
assert_contains "scope expansion does not" "$stopped" '"scope-expansion"'

# --- Prototype output cannot become evidence. -------------------------------
#
# `/investigate --compare` writes throwaway alternatives under
# `.foundation/prototypes/`, and the loop calls them non-authoritative. The
# runtime enforces that when a receipt is recorded — a guard that resolves
# `file:` URLs, percent-encoding, traversal, and symlinks before deciding, and
# which had no test of its own. Everything below is the same file reached a
# different way.
setup_project prototype-evidence
$F new "prototype probe" --rapid > /dev/null
C=prototype-probe
jq '.claims[0].capabilities = ["deployment"]' "openspec/changes/$C/evidence.yaml" > "$LOGS/e.json"
cp "$LOGS/e.json" "openspec/changes/$C/evidence.yaml"
jq '.providers.deployment = {"adapter":"external"}' "openspec/changes/$C/execution.yaml" > "$LOGS/x.json"
cp "$LOGS/x.json" "openspec/changes/$C/execution.yaml"
sed 's/- \[ \]/- [x]/g' "openspec/changes/$C/tasks.md" > "$LOGS/t.md"
cp "$LOGS/t.md" "openspec/changes/$C/tasks.md"

project="$(pwd)"
mkdir -p .foundation/prototypes/p1
printf '{"ok":true}\n' > .foundation/prototypes/p1/out.json
mkdir -p "$LOGS/real"
printf '{"ok":true}\n' > "$LOGS/real/report.json"
ln -s "$project/.foundation/prototypes/p1/out.json" "$LOGS/real/sneaky.json"

refuses() {
  $F receipt "$C" deployment pass --claims declared --observed probe --source fixture "$@" 2>&1 \
    | grep -q "non-authoritative"
}

assert_cmd_zero "a relative prototype path cannot satisfy evidence" \
  refuses --reference ".foundation/prototypes/p1/out.json"
assert_cmd_zero "an absolute prototype path cannot either" \
  refuses --reference "$project/.foundation/prototypes/p1/out.json"
assert_cmd_zero "nor a file: URL naming it" \
  refuses --reference "file://$project/.foundation/prototypes/p1/out.json"
assert_cmd_zero "nor a path that traverses into it" \
  refuses --reference "openspec/../.foundation/prototypes/p1/out.json"
assert_cmd_zero "nor a percent-encoded spelling of it" \
  refuses --reference ".foundation/prototypes%2Fp1%2Fout.json"
assert_cmd_zero "nor a symlink from outside pointing in" \
  refuses --reference "$LOGS/real/sneaky.json"
assert_cmd_zero "and not as an artifact either" \
  refuses --artifact ".foundation/prototypes/p1/out.json"

# The control: the guard must be specific, or the seven above prove nothing.
assert_cmd_zero "a reference outside the prototype tree still records" \
  node .claude/harness/foundation.mjs receipt "$C" deployment pass \
    --claims declared --observed probe --source fixture \
    --reference "$LOGS/real/report.json"

# --- Legacy migration writes only what was asked for. -----------------------
#
# `migrate` is an authority command that had no test at all. Its own comment
# records why the flag parsing is strict: a greedy parser read the legacy id as
# the value of `--apply`, so `migrate --apply <id>` migrated *every* legacy run
# and reported success — and `--apply=false` wrote too, because the string
# "false" is truthy. Both are one careless parser change away from returning.
setup_project legacy-migration

assert_contains "a project with no legacy runs says so" \
  "$($F migrate 2>&1 || true)" "No matching legacy runs."

mkdir -p .workflow/0001-alpha .workflow/0002-beta .workflow/_templates
printf '{"id":"0001"}\n' > .workflow/0001-alpha/state.json
printf '{"id":"0002"}\n' > .workflow/0002-beta/state.json
printf 'template\n' > .workflow/_templates/x.md

candidates() { ls openspec/migration-candidates 2>/dev/null | tr '\n' ' '; }

dry="$($F migrate 2>&1 || true)"
assert_contains "the default run is a dry run" "$dry" "MIGRATION DRY RUN"
assert_not_contains "underscore directories are not legacy runs" "$dry" "_templates"
assert_eq "a dry run writes nothing" "" "$(candidates)"

$F migrate --apply 0001-alpha > /dev/null 2>&1
assert_eq "an id after --apply selects only that run" "0001-alpha.md " "$(candidates)"

rm -rf openspec/migration-candidates
assert_contains "--apply refuses a value rather than reading it as truthy" \
  "$($F migrate --apply=false 2>&1 || true)" "does not accept a value"
assert_eq "and writes nothing when it refuses" "" "$(candidates)"

assert_contains "two legacy ids are refused" \
  "$($F migrate 0001-alpha 0002-beta 2>&1 || true)" "at most one legacy id"

$F migrate --apply > /dev/null 2>&1
first="$(candidates)"
$F migrate --apply > /dev/null 2>&1
assert_eq "re-applying is idempotent" "$first" "$(candidates)"
assert_file_exists "the legacy source is left where it was" ".workflow/0001-alpha/state.json"

# --- Unattended work is refused without a trusted attestation. --------------
#
# The flag parsing is covered elsewhere; the refusals are not. `--unattended`
# asks the runtime to drop a human from the loop, so what matters is that it
# says no when the host has not vouched for the boundary — and that it never
# activates by implication. Assertions name only reasons that hold on any
# machine; the hazard list itself is environment-specific.
setup_project unattended-guard
$F new "unattended probe" --rapid > /dev/null
C=unattended-probe

refused="$($F sandbox create "$C" --unattended 2>&1 || true)"
assert_contains "unattended sandbox creation needs a host attestation" \
  "$refused" "trusted host attestation was not supplied"
assert_contains "and says virtualization alone is not enough" \
  "$refused" "detected virtualization alone is insufficient"
assert_file_absent "the refused run creates no sandbox" ".foundation/sandboxes/$C"

# An envelope the project made for itself is not a host vouching for anything.
printf '{"version":1,"issuer":"attacker","boundary":"container","signature":"ZmFrZQ==","payload":{"ok":true}}\n' \
  > "$LOGS/forged-attestation.json"
forged="$($F sandbox create "$C" --unattended --attestation "$LOGS/forged-attestation.json" 2>&1 || true)"
assert_contains "an untrusted issuer is refused" "$forged" "is not trusted"

# The challenge is what a host signs. Handing it back unsigned is not a response.
$F sandbox challenge "$C" > "$LOGS/challenge.json" 2>&1
assert_file_contains "the challenge states the permissions being requested" \
  "$LOGS/challenge.json" '"filesystem": "sandbox-only"'
assert_file_contains "the challenge carries a nonce" "$LOGS/challenge.json" '"nonce"'
replayed="$($F sandbox create "$C" --unattended --attestation "$LOGS/challenge.json" 2>&1 || true)"
assert_contains "replaying the challenge as its own answer is refused" \
  "$replayed" "attestation envelope is malformed"

# The guard reports, and only when it was asked for.
$F doctor --stage change --change "$C" --unattended > "$LOGS/doctor-unattended.txt" 2>&1 || true
assert_file_contains "doctor reports the boundary when unattended is requested" \
  "$LOGS/doctor-unattended.txt" "unattended-security-boundary"
$F doctor --stage change --change "$C" > "$LOGS/doctor-plain.txt" 2>&1 || true
assert_file_not_contains "and stays silent when it was not" \
  "$LOGS/doctor-plain.txt" "unattended-security-boundary"

# --- Telemetry import survives someone else's file. -------------------------
#
# A telemetry export is written by the host, not by us, so a truncated or
# half-written one is an ordinary input. The JSONL fallback parsed it with a
# bare `map`, so one bad line threw out of the command and printed a Node stack
# trace with absolute runtime paths. The accounting rules below had no test
# either, and they are the ones that decide what a budget means.
setup_project telemetry-import
$F new "telemetry probe" --rapid > /dev/null
C=telemetry-probe

lifetime() {
  node -e "
    const b = require('$TMP/telemetry-import/.foundation/runtime/$C.json').budget;
    process.stdout.write(String(b.lifetime.usedTokens))"
}

printf 'not json at all\n' > "$LOGS/bad.jsonl"
assert_contains "a file with nothing readable fails in a sentence" \
  "$($F telemetry-import "$C" "$LOGS/bad.jsonl" 2>&1 || true)" \
  "neither JSON nor JSONL"
assert_not_contains "and not with a stack trace" \
  "$($F telemetry-import "$C" "$LOGS/bad.jsonl" 2>&1 || true)" "SyntaxError"

printf '{"requestId":"t1","inputTokens":100,"outputTokens":50}\n' > "$LOGS/good.jsonl"
$F telemetry-import "$C" "$LOGS/good.jsonl" > /dev/null 2>&1
assert_eq "input and output are what spend means" "150" "$(lifetime)"

$F telemetry-import "$C" "$LOGS/good.jsonl" > /dev/null 2>&1
assert_eq "re-importing the same request counts once" "150" "$(lifetime)"

# Cache reads are excluded on purpose: counting them makes spend grow with
# session length rather than with the work done.
printf '{"requestId":"t2","inputTokens":0,"outputTokens":0,"cacheReadTokens":999999,"cacheTokens":999999}\n' \
  > "$LOGS/cache.jsonl"
$F telemetry-import "$C" "$LOGS/cache.jsonl" > /dev/null 2>&1
assert_eq "cache reads are not spend" "150" "$(lifetime)"

# Unknown is never zero — a null must not silently derive a measured 0.
printf '{"requestId":"t3","inputTokens":null,"outputTokens":null}\n' > "$LOGS/unknown.jsonl"
$F telemetry-import "$C" "$LOGS/unknown.jsonl" > /dev/null 2>&1
assert_eq "unknown usage does not read as zero spend" "150" "$(lifetime)"

printf '{"requestId":"t4","inputTokens":10,"outputTokens":5}\nnot json\n' > "$LOGS/mixed.jsonl"
mixed="$($F telemetry-import "$C" "$LOGS/mixed.jsonl" 2>&1 || true)"
assert_contains "a partly readable file reports what it skipped" \
  "$mixed" "skipped 1 unparseable telemetry line"
assert_eq "and still imports the rows it could read" "165" "$(lifetime)"

assert_contains "an unknown format is refused" \
  "$($F telemetry-import "$C" "$LOGS/good.jsonl" --format nonsense 2>&1 || true)" \
  "generic|codex|cursor|otel|claude"

# --- Submodule pointers are staged at the commit that was bound. ------------
#
# `land pointers` is an authority command that writes a gitlink into the control
# repository's index, and it had no test at all. What makes it safe is that it
# stages the commit `land record` bound and refuses when the control repository
# has moved since the sandbox was taken — otherwise it would bind a pointer to a
# base nobody proved.
setup_multirepo_submodule() {
  root="$TMP/$1"
  mkdir -p "$root/origin/src" "$root/origin/test"
  (
    cd "$root/origin"
    printf "export const n = 'api';\n" > src/index.js
    printf '{"name":"api","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n' > package.json
    printf 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { n } from "../src/index.js";\ntest("n", () => assert.ok(n));\n' > test/index.test.js
    git init -q . && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
  )
  mkdir -p "$root/project/.claude/harness" "$root/project/openspec"
  cp -R "$ROOT/.claude/harness/." "$root/project/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$root/project/openspec/"
  cp "$ROOT/openspec/config.yaml" "$root/project/openspec/"
  cd "$root/project"
  printf '# control\n' > README.md
  mkdir -p .foundation
  printf '*\n!.gitignore\n!README.md\n' > .foundation/.gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
  git -c protocol.file.allow=always submodule add -q "$root/origin" services/api
  cat > openspec/repositories.yaml <<'JSON'
{ "version": 1, "repositories": [
  { "id": "api", "type": "submodule", "path": "services/api", "mode": "write", "dependsOn": [] } ] }
JSON
  git add -A && git commit -qm "submodule and harness"
}

if command -v git > /dev/null 2>&1; then
  setup_multirepo_submodule submodule-pointers
  C=pointer-probe
  $F new "pointer probe" --rapid > /dev/null
  cat > "openspec/changes/$C/repositories.yaml" <<'JSON'
{ "version": 1, "repositories": [
  { "id": "root", "mode": "write", "dependsOn": [] },
  { "id": "api", "mode": "write", "dependsOn": [] } ] }
JSON
  cat > "openspec/changes/$C/evidence.yaml" <<'JSON'
{ "version": 2, "claims": [
  { "id": "api-c", "scenario": "api behaviour", "impact": "low", "capabilities": ["test"], "repositories": ["api"] } ] }
JSON
  cat > "openspec/changes/$C/execution.yaml" <<'JSON'
{ "version": 1, "providers": { "test": { "adapter": "test-discovery", "repository": "api",
  "command": ["npm","test","--","--test-reporter=tap"], "minimum": 1, "reportFormat": "tap" } },
  "services": {} }
JSON
  printf '# Tasks\n\n- [x] **T001** api — verify: `npm test` [claims:api-c] [repo:api] [paths:src/**,test/**]\n' \
    > "openspec/changes/$C/tasks.md"
  $F sandbox create "$C" > /dev/null 2>&1
  child=".foundation/repository-sandboxes/$C/api"
  printf "export const n = 'api';\nexport const stamp = 's1';\n" > "$child/src/index.js"
  printf 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { stamp } from "../src/index.js";\ntest("s", () => assert.equal(stamp, "s1"));\n' \
    > "$child/test/index.test.js"
  $F proof-run "$C" > /dev/null 2>&1
  ( cd "$child" && git add -A && git commit -qm "api: stamp" > /dev/null )
  bound="$(cd "$child" && git rev-parse HEAD)"
  # Committing in the child moved the composite identity, which is the saga's
  # own re-prove step rather than a failure.
  $F proof-run "$C" > /dev/null 2>&1
  $F land-record "$C" --repo api --commit "$bound" --decision-ref pointer-test > /dev/null 2>&1

  # The saga requires the child commit to reach its own branch before a pointer
  # can be staged at it; the sandbox is a detached worktree.
  ( cd services/api && git -c protocol.file.allow=always fetch -q "$TMP/submodule-pointers/project/$child" HEAD && git merge -q --ff-only FETCH_HEAD )
  $F land-record "$C" --repo api --commit "$bound" --decision-ref pointer-test > /dev/null 2>&1
  staged="$($F land-pointers "$C" 2>&1 || true)"
  assert_contains "staging reports what it wrote" "$staged" "ROOT POINTERS STAGED"
  assert_eq "the staged gitlink is the commit that was bound" "$bound" \
    "$(git ls-files -s services/api | awk '{print $2}')"
  assert_contains "and says the composite must be proven again" "$staged" "proof is stale"

  # The `control-head-moved` refusal is deliberately not asserted here. It was
  # verified by hand — a control commit taken after the sandbox makes
  # `land pointers` refuse with that decision and the reason that staging now
  # "could bind them to a base nobody proved" — but reaching it reliably means
  # racing the stale-proof check, which moving the control head also trips.
  # A test that sometimes asserts the other refusal would pin nothing.
else
  pass "submodule pointer staging skipped: git unavailable"
  pass "submodule pointer staging skipped: git unavailable"
  pass "submodule pointer staging skipped: git unavailable"
fi

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

# --- Required acceptance is refused where the flags are. --------------------
#
# `resolve --acceptance-required` with nothing in scope used to succeed, print
# `acceptance: required`, and recommend `change validate` — which then blocked,
# as did readiness, sync and Land. The message named flags of the command
# already run, so the change was stuck with no stated way out.
setup_project acceptance-scope
$F new "restyle the copy" --rapid > /dev/null
C=restyle-the-copy

$F resolve "$C" --impact low --coupling isolated \
  --acceptance-required --acceptance-reason "tone is a judgement call" > /dev/null
# Declaring the claim afterwards is legitimate, so resolve accepts this. What
# must not happen is the refusal that follows saying nothing about the way out.
blocked="$($F validate "$C" 2>&1 || true)"
assert_contains "the refusal names the command that sets the scope" \
  "$blocked" "--acceptance-claims <ids>"
assert_contains "the refusal names the other way to declare it" \
  "$blocked" "capability 'acceptance' on a claim"
assert_contains "the refusal names how to withdraw the requirement" \
  "$blocked" "--acceptance-not-required"

assert_cmd_zero "the same declaration succeeds once a claim is in scope" \
  node .claude/harness/foundation.mjs resolve "$C" --impact low --coupling isolated \
    --acceptance-required --acceptance-reason "tone is a judgement call" \
    --acceptance-claims "$C-outcome"
assert_cmd_zero "and the change still validates afterwards" \
  node .claude/harness/foundation.mjs validate "$C"

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

# `describe` prints the public two-word usage because that is what the
# `claude-foundation` CLI accepts, but this entrypoint dispatches on the
# internal single token. Rejecting the documented form while naming only its
# first word left the reader with a true statement and no way forward.
two_word="$($F proof run 2>&1 || true)"
assert_contains "a public two-word form names its internal command" "$two_word" "internal name: proof-run"
assert_contains "a public two-word form names the CLI that accepts it" "$two_word" "claude-foundation proof run"
bare_second="$($F change new x 2>&1 || true)"
assert_contains "a public form whose internal name is the second word resolves too" \
  "$bare_second" "internal name: new"
unknown="$($F frobnicate xyz 2>&1 || true)"
assert_contains "a genuinely unknown command still fails plainly" "$unknown" "'frobnicate' is not registered"
assert_not_contains "an unknown command invents no internal name" "$unknown" "internal name:"

# --- A target that moves under an isolated copy fast-forwards at sync. -------
# Another change landing mid-build used to surface only at Land, as an
# isolated-copy conflict with no command that could resolve it.
setup_project sync-fast-forwards
$F new "fast forward target moves" --rapid > /dev/null
C=fast-forward-target-moves
printf 'export function add(a,b){return a+b;}\n// dirty\n' > src/calc.js
$F sandbox create "$C" > /dev/null
printf 'landed by another change\n' > src/other.js
printf 'revised by another change\n' > test/calc.test.js
sync_out="$($F sandbox sync "$C")"
assert_contains "sync reports the fast-forward" "$sync_out" "fast-forwarded: 2 file(s)"
assert_file_contains "a file the target grew arrives in the sandbox" \
  ".foundation/sandboxes/$C/src/other.js" "landed by another change"
assert_file_contains "a file the target revised arrives in the sandbox" \
  ".foundation/sandboxes/$C/test/calc.test.js" "revised by another change"
second_sync="$($F sandbox sync "$C")"
assert_not_contains "the fast-forward advanced the baseline" "$second_sync" "fast-forwarded"

# --- A double-edited file is named at sync and resolved explicitly. ----------
setup_project sync-names-conflicts
$F new "conflict is named at sync" --rapid > /dev/null
C=conflict-is-named-at-sync
printf 'export function add(a,b){return a+b;}\n// dirty\n' > src/calc.js
$F sandbox create "$C" > /dev/null
printf 'target version\n' > src/calc.js
printf 'sandbox version\n' > ".foundation/sandboxes/$C/src/calc.js"
conflict_out="$($F sandbox sync "$C")"
assert_contains "a double edit is named at sync, not at Land" \
  "$conflict_out" "CONFLICT src/calc.js"
bad_resolve="$($F sandbox sync "$C" --resolve src/nope.js 2>&1 || true)"
assert_contains "--resolve refuses a path not in conflict" "$bad_resolve" "not in conflict"
printf 'target version\nsandbox version\n' > ".foundation/sandboxes/$C/src/calc.js"
resolved="$($F sandbox sync "$C" --resolve src/calc.js)"
assert_not_contains "a resolved conflict stops being named" "$resolved" "CONFLICT"
settled="$($F sandbox sync "$C")"
assert_not_contains "the resolution advanced the baseline" "$settled" "CONFLICT"

# --- A packet edited only in the sandbox refuses to be clobbered. ------------
# The packet's source of truth is the target copy; sync overwrites the sandbox
# copy wholesale, and only tasks.md ticks merge back.
setup_project sync-preserves-packet-edits
$F new "packet edits stay visible" --rapid > /dev/null
C=packet-edits-stay-visible
$F sandbox create "$C" > /dev/null
printf 'sandbox-side edit\n' >> ".foundation/sandboxes/$C/openspec/changes/$C/proposal.md"
clobber="$($F sandbox sync "$C" 2>&1 || true)"
assert_contains "a sandbox packet edit refuses to be clobbered" \
  "$clobber" "sandbox packet edits would be lost at 'openspec/changes/$C/proposal.md'"
cp "openspec/changes/$C/proposal.md" ".foundation/sandboxes/$C/openspec/changes/$C/proposal.md"
unblocked="$($F sandbox sync "$C" 2>&1)"
assert_contains "reverting or porting the edit unblocks the sync" "$unblocked" "SYNCED"

finish "changeloop seams"
