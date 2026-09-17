#!/usr/bin/env sh
# Installed multi-repository consumer: interruption between dependency waves.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
for repo in api app reference; do
  mkdir -p "$TMP/$repo"
  git -C "$TMP/$repo" init -q
  git -C "$TMP/$repo" config user.email fixture@example.invalid
  git -C "$TMP/$repo" config user.name Fixture
  printf '%s-before\n' "$repo" > "$TMP/$repo/app.txt"
  git -C "$TMP/$repo" add .
  git -C "$TMP/$repo" commit -qm baseline
done
bash "$ROOT/install.sh" "$TMP/control" --source "$ROOT" --yes >/dev/null
cd "$TMP/control"
printf '.foundation/\n' > .gitignore
printf '%s\n' '{"workflow":{"grounding":"optional","reviewPolicy":"legacy","reviewCircuit":"legacy"},"land":{"riskBasedCi":false},"telemetry":{"requireUsage":false}}' > foundation.json
printf '%s\n' '{"version":1,"repositories":[{"id":"api","path":"../api","allowOutsideRoot":true},{"id":"app","path":"../app","allowOutsideRoot":true},{"id":"reference","path":"../reference","mode":"read","allowOutsideRoot":true}]}' > openspec/repositories.yaml
# Fault injection changes only the installed fixture's existing checkpoint.
# The upstream runtime and its proof/state records are never patched.
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const path = ".claude/harness/runtime/workflow/repository-delivery-saga.mjs";
  const source = readFileSync(path, "utf8");
  const anchor = "      checkpoint(\"after-repository\", {";
  if (source.split(anchor).length !== 2) throw new Error("checkpoint anchor changed");
  writeFileSync(path, source.replace(anchor,
    "      if (process.env.FIXTURE_INTERRUPT_REPOSITORY === repository.id) throw new Error(\"fixture interrupted dependency wave\");\n" + anchor));'
git init -q
git config user.email fixture@example.invalid
git config user.name Fixture
git add .
git commit -qm 'installed consumer baseline'
node .claude/harness/foundation.mjs new 'Installed repository recovery' >/dev/null
node .claude/harness/foundation.mjs resolve installed-repository-recovery --impact low --coupling isolated --acceptance-not-required >/dev/null
packet=openspec/changes/installed-repository-recovery
mkdir -p "$packet/specs/change"
printf '%s\n' '## ADDED Requirements' '' '### Requirement: Updated repository values' 'The API and app SHALL expose their updated values.' '' '#### Scenario: Both repositories are delivered' '- **WHEN** the change is delivered' '- **THEN** API exposes api-after and app exposes app-after' > "$packet/specs/change/spec.md"
printf '%s\n' '{"version":1,"repositories":[{"id":"api","mode":"write","dependsOn":[]},{"id":"app","mode":"write","dependsOn":["api"]},{"id":"reference","mode":"read","dependsOn":[]}]}' > "$packet/repositories.yaml"
printf '%s\n' '# Tasks' '' '- [ ] **T001** Update API [repo:api] [kind:implementation] [paths:app.txt]' '- [ ] **T002** Update app [repo:app] [kind:implementation] [depends:T001] [paths:app.txt]' > "$packet/tasks.md"
printf '%s\n' '{"version":2,"claims":[{"id":"api-updated","scenario":"API returns the updated value","impact":"low","capabilities":["test"],"repositories":["api"]},{"id":"app-updated","scenario":"App returns the updated value","impact":"low","capabilities":["test"],"repositories":["app"]}]}' > "$packet/evidence.yaml"
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  writeFileSync("openspec/changes/installed-repository-recovery/execution.yaml", JSON.stringify({
    version: 1, providers: {
      test: { adapter: "test-discovery", capability: "test", repository: "api",
        repositories: ["api", "app"], claims: ["api-updated", "app-updated"],
        report: "test-results/results.json", minimum: 2,
        command: ["node", "-e", `const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.env.FOUNDATION_REPOSITORIES_FILE)); for(const id of ["api","app"]) if(fs.readFileSync(m.repositories[id].path+"/app.txt","utf8").trim()!==id+"-after") process.exit(1); fs.mkdirSync("test-results",{recursive:true}); fs.writeFileSync("test-results/results.json",JSON.stringify({numTotalTests:2,numPassedTests:2,success:true}));`] },
      review: { adapter: "external" }
    }, services: {}
  }));'
node .claude/harness/foundation.mjs sandbox create installed-repository-recovery --all >/dev/null
for repo in api app; do
  printf '%s-after\n' "$repo" > ".foundation/repository-sandboxes/installed-repository-recovery/$repo/app.txt"
done
workspace="$(node -p 'require("./.foundation/runtime/installed-repository-recovery.json").workspace.path')"
sed -i.bak 's/- \[ \]/- [x]/g' "$workspace/$packet/tasks.md"
rm "$workspace/$packet/tasks.md.bak"
node .claude/harness/foundation.mjs proof-collect installed-repository-recovery >/dev/null
node .claude/harness/foundation.mjs receipt installed-repository-recovery review pass --observed 'Deterministic fixture reviewer approves both changes' --reviewer harness-test --subject-actor implementation-agent --unresolved-blockers 0 --reference fixture://review >/dev/null
node .claude/harness/foundation.mjs prove installed-repository-recovery >/dev/null
for repo in control api app reference; do
  git -C "$TMP/$repo" rev-parse HEAD > "$TMP/$repo.head"
  git -C "$TMP/$repo" ls-files --stage > "$TMP/$repo.index"
done
mkdir -p "$TMP/bin"
printf '%s\n' '#!/bin/sh' 'if [ "$1" = "--version" ]; then echo 1.7.0; exit 0; fi' 'if [ "$1" = "archive" ]; then mkdir -p openspec/changes/archive; mv "openspec/changes/$2" "openspec/changes/archive/$2"; fi' 'exit 0' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
interrupted="$(PATH="$TMP/bin:$PATH" FIXTURE_INTERRUPT_REPOSITORY=api node .claude/harness/foundation.mjs advance installed-repository-recovery --through archived)"
case "$interrupted" in *'fixture interrupted dependency wave'*) ;; *) printf '%s\n' "$interrupted" >&2 ;; esac
assert_not_contains "interrupted wave does not claim completion" "$interrupted" '"action":"DONE"'
assert_contains "interrupted wave retains its cause" "$interrupted" 'fixture interrupted dependency wave'
assert_file_contains "first dependency wave is applied" "$TMP/api/app.txt" api-after
assert_file_contains "dependent wave has not been applied" "$TMP/app/app.txt" app-before
merge_failed="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance installed-repository-recovery --through archived)"
assert_not_contains "archive checkpoint with an incomplete spec merge is not complete" "$merge_failed" '"action":"DONE"'
assert_contains "incomplete spec merge identifies the real cause" "$merge_failed" 'archived specs do not match'
# The OpenSpec fixture deliberately moved without merging. Restore the actual
# semantic output, without changing a runtime record, and resume its audit.
mkdir -p openspec/specs/change
sed 's/## ADDED Requirements/## Requirements/' openspec/changes/archive/installed-repository-recovery/specs/change/spec.md > openspec/specs/change/spec.md
resumed="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance installed-repository-recovery --through archived)"
case "$resumed" in *'"reached":"archived"'*) ;; *) printf '%s\n' "$resumed" >&2 ;; esac
assert_contains "fresh installed consumer resumes all waves through archive" "$resumed" '"reached":"archived"'
assert_eq "recovered spec merge retains mode-bound delivery evidence" 2 \
  "$(node -p 'require("./.foundation/runtime/installed-repository-recovery.json").deliveryIntegrity.version')"
assert_file_contains "dependent wave receives the proven bytes" "$TMP/app/app.txt" app-after
assert_file_contains "read-only repository remains unchanged" "$TMP/reference/app.txt" reference-before
for repo in control api app reference; do
  assert_eq "$repo HEAD is unchanged" "$(cat "$TMP/$repo.head")" "$(git -C "$TMP/$repo" rev-parse HEAD)"
  assert_eq "$repo index is unchanged" "$(shasum < "$TMP/$repo.index")" "$(git -C "$TMP/$repo" ls-files --stage | shasum)"
done
again="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs advance installed-repository-recovery --through archived)"
assert_contains "repeated multi-repository resume remains complete" "$again" '"reached":"archived"'
finish 'installed repository recovery'
