#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

assert_cmd_zero "benchmark targets are valid JSON" \
  jq -e '.workflow == "openspec-native" and .scenarios["todolist-r2"].target.task_mirror_operations_max == 0' \
  "$ROOT/.claude/tests/bench/config/openspec-native-targets.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

cd "$TMP/project"

providers="$(node .claude/harness/foundation.mjs providers)"
assert_contains "provider catalog includes static analysis" "$providers" "static-analysis"
assert_contains "provider catalog includes data migration" "$providers" "data-migration"
assert_contains "provider catalog includes accessibility" "$providers" "accessibility"
assert_contains "provider catalog includes resilience" "$providers" "resilience"
assert_contains "provider catalog includes observability" "$providers" "observability"
assert_contains "provider catalog includes deployment" "$providers" "deployment"
assert_contains "provider catalog includes supply chain" "$providers" "dependency-supply-chain"

output="$(node .claude/harness/foundation.mjs new 'Profile owner update')"
assert_contains "creates standard change" "$output" "CREATED profile-owner-update"
assert_file_exists "runtime state created" ".foundation/runtime/profile-owner-update.json"
assert_file_exists "delta spec created" "openspec/changes/profile-owner-update/specs/change/spec.md"

output="$(node .claude/harness/foundation.mjs resolve profile-owner-update --impact medium --coupling isolated)"
assert_contains "resolver records impact" "$output" "impact: medium"
assert_cmd_zero "standard change validates" node .claude/harness/foundation.mjs validate profile-owner-update
packet="$(node .claude/harness/foundation.mjs packet profile-owner-update)"
assert_contains "compact packet carries required providers" "$packet" '"provider": "test"'
assert_contains "compact packet carries task count" "$packet" '"pendingTaskCount":'

if node .claude/harness/foundation.mjs run-provider profile-owner-update unknown-provider -- \
  sh -c 'printf unsafe > should-not-exist.txt' >/dev/null 2>&1; then
  fail "unknown provider is rejected before command execution"
else
  pass "unknown provider is rejected before command execution"
fi
assert_file_absent "unknown provider command has no side effect" "should-not-exist.txt"

if node .claude/harness/foundation.mjs run-provider profile-owner-update test -- \
  sh -c 'printf unsafe > missing-claims.txt' >/dev/null 2>&1; then
  fail "run-provider requires an explicit claim scope"
else
  pass "run-provider requires an explicit claim scope"
fi
assert_file_absent "missing claim scope prevents command execution" "missing-claims.txt"

sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/profile-owner-update/tasks.md
rm openspec/changes/profile-owner-update/tasks.md.bak
assert_cmd_zero "test provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update test pass
assert_cmd_zero "discovery provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update discovery pass --discovered 3 --minimum 1
assert_cmd_zero "complete evidence proves" node .claude/harness/foundation.mjs prove profile-owner-update
assert_cmd_zero "fresh proof is land-ready" node .claude/harness/foundation.mjs land-check profile-owner-update

cp .foundation/receipts/profile-owner-update/test.json "$TMP/test-receipt.json"
jq '.providerFingerprint = "tampered"' .foundation/receipts/profile-owner-update/test.json \
  > "$TMP/tampered.json"
cp "$TMP/tampered.json" .foundation/receipts/profile-owner-update/test.json
if node .claude/harness/foundation.mjs land-check profile-owner-update >/dev/null 2>&1; then
  fail "tampered provider fingerprint invalidates receipt"
else
  pass "tampered provider fingerprint invalidates receipt"
fi
cp "$TMP/test-receipt.json" .foundation/receipts/profile-owner-update/test.json

printf '\nContract revision after proof.\n' >> openspec/changes/profile-owner-update/proposal.md
if node .claude/harness/foundation.mjs land-check profile-owner-update >/dev/null 2>&1; then
  fail "change packet edit invalidates proof"
else
  pass "change packet edit invalidates proof"
fi
node .claude/harness/foundation.mjs receipt profile-owner-update test pass >/dev/null
node .claude/harness/foundation.mjs receipt profile-owner-update discovery pass \
  --discovered 3 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove profile-owner-update >/dev/null

printf 'changed\n' > app.txt
if node .claude/harness/foundation.mjs land-check profile-owner-update >/dev/null 2>&1; then
  fail "relevant edit invalidates proof"
else
  pass "relevant edit invalidates proof"
fi

node .claude/harness/foundation.mjs new 'Production provider coverage' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve production-provider-coverage \
  --impact low --coupling isolated >/dev/null
sed -i.bak \
  's/"capabilities": \["test"\]/"capabilities": ["static-analysis", "data-migration", "accessibility", "resilience", "observability", "deployment", "dependency-supply-chain"]/' \
  openspec/changes/production-provider-coverage/evidence.yaml
rm openspec/changes/production-provider-coverage/evidence.yaml.bak
assert_cmd_zero "production provider capabilities validate" \
  node .claude/harness/foundation.mjs validate production-provider-coverage
plan="$(node .claude/harness/foundation.mjs proof-plan production-provider-coverage)"
assert_contains "proof plan selects deployment evidence" "$plan" "deployment: missing"
assert_contains "proof plan selects migration evidence" "$plan" "data-migration: missing"
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/production-provider-coverage/tasks.md
rm openspec/changes/production-provider-coverage/tasks.md.bak
for provider in static-analysis data-migration accessibility resilience observability deployment dependency-supply-chain; do
  node .claude/harness/foundation.mjs receipt production-provider-coverage "$provider" pass >/dev/null
done
assert_cmd_zero "new provider receipts produce a complete proof" \
  node .claude/harness/foundation.mjs prove production-provider-coverage

output="$(node .claude/harness/foundation.mjs new 'Tiny copy edit' --rapid)"
assert_contains "creates rapid change" "$output" "foundation-rapid"
node .claude/harness/foundation.mjs resolve tiny-copy-edit --impact low --coupling isolated --security auth >/dev/null
schema="$(jq -r '.schema' .foundation/runtime/tiny-copy-edit.json 2>/dev/null || true)"
assert_eq "semantic security upgrades rapid lane" "foundation-standard" "$schema"
sed -i.bak \
  's/"capabilities": \["test"\]/"capabilities": ["browser", "mutation"]/' \
  openspec/changes/tiny-copy-edit/evidence.yaml
rm openspec/changes/tiny-copy-edit/evidence.yaml.bak

if node .claude/harness/foundation.mjs receipt tiny-copy-edit browser pass \
  --foreground-required yes --foreground-available no --input-mode os-input >/dev/null 2>&1; then
  fail "browser foreground mismatch cannot pass"
else
  pass "browser foreground mismatch cannot pass"
fi

if node .claude/harness/foundation.mjs receipt tiny-copy-edit mutation pass \
  --classification crash >/dev/null 2>&1; then
  fail "mutation crash cannot pass"
else
  pass "mutation crash cannot pass"
fi

event="$(node .claude/harness/foundation.mjs event tiny-copy-edit --request req-1 --operation build)"
assert_contains "watchdog records request" "$event" "BUDGET tiny-copy-edit"
assert_file_exists "event ledger created" ".foundation/logs/tiny-copy-edit/events.jsonl"
if node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-1 --operation build >/dev/null 2>&1; then
  fail "watchdog rejects duplicate request identity"
else
  pass "watchdog rejects duplicate request identity"
fi

# Non-Git repositories use a manifest-guarded isolated copy.
node .claude/harness/foundation.mjs new 'Copy sandbox' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve copy-sandbox --impact low --coupling isolated >/dev/null
copy_output="$(node .claude/harness/foundation.mjs sandbox create copy-sandbox)"
assert_contains "non-git sandbox uses isolated copy" "$copy_output" "mode: isolated-copy"
copy_path="$(jq -r '.workspace.path' .foundation/runtime/copy-sandbox.json)"
printf 'copy-applied\n' > "$copy_path/app.txt"
sed -i.bak 's/- \[ \]/- [x]/g' "$copy_path/openspec/changes/copy-sandbox/tasks.md"
rm "$copy_path/openspec/changes/copy-sandbox/tasks.md.bak"
node .claude/harness/foundation.mjs receipt copy-sandbox test pass >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox discovery pass --discovered 1 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove copy-sandbox >/dev/null
assert_cmd_zero "isolated copy applies transactionally" \
  node .claude/harness/foundation.mjs sandbox apply copy-sandbox
copy_applied="$(tr -d '\n' < app.txt)"
assert_eq "non-git target matches isolated copy" "copy-applied" "$copy_applied"

mkdir -p "$TMP/bin"
cp /dev/null "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "${1:-}" = "--version" ]; then echo "1.7.0"; exit 0; fi' \
  'if [ "${1:-}" = "archive" ]; then' \
  '  mkdir -p "openspec/changes/archive"' \
  '  mv "openspec/changes/$2" "openspec/changes/archive/$2"' \
  '  echo "archived $2"' \
  '  exit 0' \
  'fi' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"
archive_output="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive delegates once to pinned OpenSpec" "$archive_output" "ARCHIVED copy-sandbox"
archive_again="$(node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive is idempotent after spec sync" "$archive_again" "ALREADY ARCHIVED copy-sandbox"

# A separate clean Git fixture exercises the complete worktree proof/apply path.
mkdir -p "$TMP/git-project/.claude/harness" "$TMP/git-project/openspec" "$TMP/git-project/.foundation"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/git-project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/git-project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/git-project/openspec/"
cp "$ROOT/.foundation/.gitignore" "$TMP/git-project/.foundation/"
printf 'before\n' > "$TMP/git-project/app.txt"
cd "$TMP/git-project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git add .
git commit -qm "fixture"
node .claude/harness/foundation.mjs new 'Sandbox copy' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve sandbox-copy --impact low --coupling isolated >/dev/null
node .claude/harness/foundation.mjs sandbox create sandbox-copy >/dev/null
printf 'after\n' > .foundation/sandboxes/sandbox-copy/app.txt
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
node .claude/harness/foundation.mjs receipt sandbox-copy test pass >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass --discovered 2 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
printf '\nSecond revision after proof.\n' >> openspec/changes/sandbox-copy/proposal.md
node .claude/harness/foundation.mjs sandbox sync sandbox-copy >/dev/null
if node .claude/harness/foundation.mjs land-check sandbox-copy >/dev/null 2>&1; then
  fail "sandbox revision invalidates prior proof"
else
  pass "sandbox revision invalidates prior proof"
fi
node .claude/harness/foundation.mjs receipt sandbox-copy test pass >/dev/null
node .claude/harness/foundation.mjs receipt sandbox-copy discovery pass --discovered 2 --minimum 1 >/dev/null
node .claude/harness/foundation.mjs prove sandbox-copy >/dev/null
assert_cmd_zero "proven sandbox applies transactionally" \
  node .claude/harness/foundation.mjs sandbox apply sandbox-copy
applied="$(tr -d '\n' < app.txt)"
assert_eq "target matches sandbox content" "after" "$applied"
assert_file_contains "land returns completed task ledger" \
  openspec/changes/sandbox-copy/tasks.md "- [x]"

finish "harness contracts"
