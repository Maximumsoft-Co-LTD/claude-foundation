# Evidence, receipt, proof, telemetry, and execution contracts.
# A CI system can return a signed, workspace-bound evidence envelope. The
# harness verifies trust, identity, run provenance, and artifact digests before
# creating the ordinary durable receipt used by proof.
evidence_proof_shard="${FOUNDATION_EVIDENCE_PROOF_SHARD:-all}"

shard_selected() {
  for candidate in "$@"; do
    [ "$evidence_proof_shard" = "$candidate" ] && return 0
  done
  return 1
}

if shard_selected all a a1 a1-ci; then
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
# The hash the *provider* binds, not the change's. A deployment provider runs a
# command and binds the code half, so signing the whole-workspace hash produced
# an envelope that could never match.
ci_workspace_hash="$(node .claude/harness/foundation.mjs hash verify-signed-ci-evidence deployment)"
assert_cmd_zero "a provider-scoped hash omits the change packet" \
  test "$ci_workspace_hash" != "$(node .claude/harness/foundation.mjs hash verify-signed-ci-evidence)"
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

# The rest of what makes this evidence trustworthy, none of which a tampered
# payload exercises: a well-formed envelope signed by the wrong key, a valid
# envelope replayed onto another change, and the payload rules that stop a
# "pass" from carrying nothing anyone can check.
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" generate \
  "$TMP/ci-attacker-private.pem" "$TMP/ci-attacker-public.pem"
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" sign \
  "$TMP/ci-payload.json" "$TMP/ci-attacker-private.pem" "$TMP/ci-attacker-envelope.json"
assert_cmd_fails_with "an envelope signed by another key is rejected" "signature is invalid" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-attacker-envelope.json"

jq '.issuer = "other-ci"' "$TMP/ci-payload.json" > "$TMP/ci-issuer-payload.json"
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" sign \
  "$TMP/ci-issuer-payload.json" "$TMP/ci-private.pem" "$TMP/ci-issuer-envelope.json"
assert_cmd_fails_with "a correctly signed envelope from another issuer is rejected" \
  "issuer does not match" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-issuer-envelope.json"

jq '.artifacts = []' "$TMP/ci-payload.json" > "$TMP/ci-bare-payload.json"
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" sign \
  "$TMP/ci-bare-payload.json" "$TMP/ci-private.pem" "$TMP/ci-bare-envelope.json"
assert_cmd_fails_with "a passing envelope must carry an artifact digest" \
  "requires at least one signed artifact digest" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-bare-envelope.json"

jq '.runUrl = "file:///etc/passwd"' "$TMP/ci-payload.json" > "$TMP/ci-url-payload.json"
node "$ROOT/.claude/tests/harness/sign-envelope.mjs" sign \
  "$TMP/ci-url-payload.json" "$TMP/ci-private.pem" "$TMP/ci-url-envelope.json"
assert_cmd_fails_with "a run reference that is not http(s) is rejected" "http(s) runUrl" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-url-envelope.json"

# Content-binding: the same signed envelope stops being evidence once the
# workspace it attests to has moved on.
printf 'ci drift\n' >> app.txt
assert_cmd_fails_with "a valid envelope stops matching once the workspace changes" \
  "does not match the provider workspace" \
  node .claude/harness/foundation.mjs evidence-verify-ci \
    verify-signed-ci-evidence deployment "$TMP/ci-envelope.json"
git checkout -- app.txt 2>/dev/null || true

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

fi

if shard_selected all a a1 a1-core; then

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

jq '.budget.window.usedTokens = 1600001' \
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

# A receipt binds the hash its own provider binds. A run records one hash for
# the whole run, and an activeProofRun left behind by an abnormal exit used to
# be taken ahead of the provider's — writing a receipt that was stale the moment
# it existed, for a reason no operator could see.
expected_binding="$(node .claude/harness/foundation.mjs hash \
  production-provider-coverage accessibility)"
jq --arg stale "$(printf '0%.0s' $(seq 64))" \
  '.activeProofRun = {"id":"collect-abandoned","snapshotId":"snapshot-abandoned","workspaceHash":$stale}' \
  .foundation/runtime/production-provider-coverage.json > "$TMP/leftover-run.json"
cp "$TMP/leftover-run.json" .foundation/runtime/production-provider-coverage.json
node .claude/harness/foundation.mjs receipt production-provider-coverage accessibility pass \
  --observed 'fixture evidence for accessibility' --source harness-test \
  --artifact app.txt >/dev/null
assert_eq "a receipt binds its provider's hash, not a leftover run's" \
  "$expected_binding" \
  "$(jq -r '.workspaceHash' .foundation/receipts/production-provider-coverage/accessibility.json)"
jq 'del(.activeProofRun)' .foundation/runtime/production-provider-coverage.json \
  > "$TMP/cleared-run.json"
cp "$TMP/cleared-run.json" .foundation/runtime/production-provider-coverage.json
assert_cmd_zero "the change still proves after the leftover run is cleared" \
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
fi

# Project-owned evidence must be collectible before an external review receipt
# exists. Final proof remains blocked until review, then reuses the collected
# receipt instead of executing the provider again.
# The latter half also checks cache reuse and artifact auditing against this
# change. A standalone a2 shard creates only the prerequisite state; the full
# unsplit contract already created it immediately above.
if shard_selected a2 a2-cache; then
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
  node .claude/harness/foundation.mjs proof-execute executable-evidence >/dev/null
fi

if shard_selected all a a2 a2-review; then
node .claude/harness/foundation.mjs new 'Collect before review' >/dev/null
node .claude/harness/foundation.mjs resolve collect-before-review \
  --impact medium --coupling coupled --acceptance-not-required >/dev/null
# Make this change's review subject explicit. The former gitless fixture
# accidentally treated an edit left by an earlier scenario as this change's
# code; an indexed fixture correctly records that edit as pre-existing.
printf 'collect-before-review implementation\n' > app.txt
sed -i.bak \
  -e '/T001/s/\[paths:<glob>\]/[paths:app.txt]/' \
  -e '/T002/s/\[paths:<glob>\]/[paths:collect-fixture.sh]/' \
  openspec/changes/collect-before-review/tasks.md
rm openspec/changes/collect-before-review/tasks.md.bak
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
# A project driven from one session has no second session to open, so the
# reviewer gate had no reachable end state and the loop stopped here for good.
# The waiver already existed in `reviewPolicy`; it was never named at the point
# where somebody is stuck behind it.
assert_contains "review recovery names the independence waiver" \
  "$review_decision" 'independence'
# Review cannot be wired around, so the last cheap moment to find a reviewer is
# before Build. Announcing it only at Prove spent the whole build first.
assert_contains "validate announces a required reviewer before Build" \
  "$({ node .claude/harness/foundation.mjs validate collect-before-review; } 2>&1 || true)" \
  "an independent reviewer must exist by Prove"
# `proofReadinessValue` always computed a recovery under `next`, and preflight
# threw it away and printed the blocker list alone — which is what made a
# blocked Prove read as a dead end. The route has to survive the stop.
review_preflight="$(node .claude/harness/foundation.mjs proof-preflight \
  collect-before-review 2>&1 || true)"
assert_contains "blocked preflight states the blocker" \
  "$review_preflight" "proof preflight failed"
assert_contains "blocked preflight states how to clear it" \
  "$review_preflight" "how to clear this"
assert_contains "blocked preflight names the command that clears it" \
  "$review_preflight" "authority request collect-before-review --type review"
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
jq '.budget.window.usedTokens = 1600001' \
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
# A reference stands in for evidence, so it has to point somewhere.
assert_cmd_fails_with "free text cannot pass as a reference" \
  "a reference must be a URI or a path that exists" \
  node .claude/harness/foundation.mjs receipt collect-before-review \
    review pass --observed "fixture review found no blockers" \
    --reviewer harness-test --subject-actor implementation-agent \
    --unresolved-blockers 0 \
    --reference "trust me bro"
node .claude/harness/foundation.mjs receipt collect-before-review \
  review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --unresolved-blockers 0 \
  --reference "fixture://collect-review" >/dev/null
assert_cmd_zero "final proof reuses evidence collected before review" \
  node .claude/harness/foundation.mjs proof-run collect-before-review
assert_eq "final proof does not rerun collected provider" "1" \
  "$(tr -d '\n' < .foundation/collect-count.txt)"

fi

# An executable provider that is configured but unavailable must expose safe,
# structured recovery choices instead of leaving the operator at a dead end.
if shard_selected all a a2 a2-recovery; then
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

# Security triggers are semantic, so they match words rather than substrings:
# "accessibility" is not "access", and a passkey is a trust boundary.
node .claude/harness/foundation.mjs new 'Improve keyboard accessibility of the nav bar' --rapid >/dev/null
accessibility_resolved="$(node .claude/harness/foundation.mjs resolve \
  improve-keyboard-accessibility-of-the-nav-bar --impact low --coupling isolated)"
assert_contains "an accessibility change triggers no security review" \
  "$accessibility_resolved" "security: none"
assert_contains "resolve names the schema it settled on" \
  "$accessibility_resolved" "schema: foundation-rapid"
node .claude/harness/foundation.mjs new 'Let users sign in with a passkey' --rapid >/dev/null
passkey_resolved="$(node .claude/harness/foundation.mjs resolve \
  let-users-sign-in-with-a-passkey --impact low --coupling isolated)"
assert_contains "a passkey sign-in change is a security trigger" \
  "$passkey_resolved" "passkey"
# The trigger upgrades the schema, and the upgrade must leave a change that can
# actually be validated rather than one missing the artifacts it now requires.
assert_contains "a schema upgrade is announced" \
  "$passkey_resolved" "upgraded from foundation-rapid"
assert_file_exists "a schema upgrade instantiates design.md" \
  openspec/changes/let-users-sign-in-with-a-passkey/design.md
assert_file_exists "a schema upgrade instantiates the spec delta" \
  openspec/changes/let-users-sign-in-with-a-passkey/specs/change/spec.md

# `changes` is how a stuck project is diagnosed, so one unreadable state file
# must not hide every other change, and abandon must still be able to exit.
printf 'not json at all' > .foundation/runtime/let-users-sign-in-with-a-passkey.json
corrupt_listing="$(node .claude/harness/foundation.mjs changes)"
assert_contains "a corrupt state file is reported as its own row" \
  "$corrupt_listing" "invalid-runtime-json"
assert_contains "a corrupt state file does not hide other changes" \
  "$corrupt_listing" "improve-keyboard-accessibility-of-the-nav-bar"
assert_cmd_zero "abandon exits a change whose state file is corrupt" \
  node .claude/harness/foundation.mjs abandon let-users-sign-in-with-a-passkey \
    --reason "corrupt state" --decision-ref fixture://user/corrupt
node .claude/harness/foundation.mjs abandon improve-keyboard-accessibility-of-the-nav-bar \
  --reason "fixture cleanup" --decision-ref fixture://user/cleanup >/dev/null

# A receipt asserts that evidence ran. The caller may not select the adapter
# that decides whether that assertion is checked, and may not hand-record a
# pass for a provider the harness is supposed to execute.
assert_cmd_fails_with "a hand-recorded receipt cannot claim an executing adapter" \
  "names an adapter the harness executes" \
  node .claude/harness/foundation.mjs receipt unavailable-provider-recovery \
    static-analysis pass --adapter command
assert_cmd_fails_with "a configured executable provider refuses a hand-recorded pass" \
  "must come from an execution" \
  node .claude/harness/foundation.mjs receipt unavailable-provider-recovery \
    static-analysis pass --observed "it passed" --source me \
    --reference "fixture://forged"
assert_cmd_fails_with "an adapter override does not lift the evidence floor" \
  "must come from an execution" \
  node .claude/harness/foundation.mjs receipt unavailable-provider-recovery \
    static-analysis pass --adapter external
assert_file_absent "a refused forgery writes no receipt" \
  .foundation/receipts/unavailable-provider-recovery/static-analysis.json
jq '.budget.window.usedTokens = 1600001' \
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
printf '%s' "$unavailable_metrics" > "$TMP/unavailable-metrics.json"
assert_cmd_zero "typed readiness stop is counted separately" \
  jq -e '.rework.expectedStops >= 1' "$TMP/unavailable-metrics.json"
assert_contains "typed readiness stop is not failed rework" \
  "$unavailable_metrics" '"failedOperations": 0'
# The same contract, one level down. `rework` had it right while the per-phase
# rollup counted every non-completed row as a failure, so one change reported
# six failures it never had. The suite only ever looked at `rework`, which is
# how that survived.
assert_cmd_zero "a typed stop lands in the phase's blocked count" \
  jq -e '[.phases[].blocked] | add >= 1' "$TMP/unavailable-metrics.json"
assert_cmd_zero "a typed stop is not counted as a phase failure" \
  jq -e '[.phases[].failed] | add == 0' "$TMP/unavailable-metrics.json"
# Buckets are keyed by lifecycle phase whether or not the call came through
# cli.sh — this one did not, and used to bucket under the command name.
assert_cmd_zero "a direct runtime call still buckets under its phase" \
  jq -e '.phases | has("prove")' "$TMP/unavailable-metrics.json"
assert_cmd_zero "per-phase spend is reported in the budget's own measure" \
  jq -e '.phases | has("prove") and (.prove | has("spendTokens"))' \
  "$TMP/unavailable-metrics.json"
# `--phase` is advertised as an enum; it used to accept anything and write the
# typo straight into metrics.phases as if it were a phase.
assert_cmd_fails_with "exec refuses a phase outside the enum" \
  "exec --phase must be change|build|prove|land" \
  node .claude/harness/foundation.mjs exec unavailable-provider-recovery \
  --phase buidl -- true
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

fi

if shard_selected all a a2 a2-cache; then
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
# A validity code names what is wrong and nothing about what to do, so every
# stop on one used to end the loop with a diagnosis and no instruction. The
# route is derivable from the code; both Prove and Land now print it.
stale_prove="$(node .claude/harness/foundation.mjs prove executable-evidence 2>&1 || true)"
assert_contains "a stale receipt blocks prove" \
  "$stale_prove" "provider-fingerprint-stale"
assert_contains "a blocked prove names the route out of each stale receipt" \
  "$stale_prove" "claude-foundation proof run executable-evidence"
sed -i.bak 's/"minimum":5/"minimum":4/' \
  openspec/changes/executable-evidence/evidence.yaml
rm openspec/changes/executable-evidence/evidence.yaml.bak
assert_cmd_zero "execution upgrade separates adapter wiring from claims" \
  node .claude/harness/foundation.mjs evidence-upgrade executable-evidence
assert_eq "behavioral contract no longer carries provider commands" "false" \
  "$(jq 'has("providers")' openspec/changes/executable-evidence/evidence.yaml)"
assert_eq "execution file receives migrated provider commands" "test-discovery" \
  "$(jq -r '.providers.test.adapter' openspec/changes/executable-evidence/execution.yaml)"
fi

# A provider that declares no inputs binds the whole workspace *minus* the
# change packet. Editing the packet after proving used to expire every receipt
# in the change and charge a full provider re-run for a note in design.md.
if shard_selected all b b-binding; then
node .claude/harness/foundation.mjs new 'Packet edit reuse' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve packet-edit-reuse \
  --impact low --coupling isolated >/dev/null
printf 'code under test\n' > packet-edit-code.txt
printf '%s\n' '#!/usr/bin/env sh' \
  'count=0' \
  '[ ! -f .foundation/packet-edit-count.txt ] || count="$(cat .foundation/packet-edit-count.txt)"' \
  'count=$((count + 1))' \
  'printf "%s\\n" "$count" > .foundation/packet-edit-count.txt' \
  'printf "%s\\n" "{\"numTotalTests\":2}"' > packet-edit-fixture.sh
chmod +x packet-edit-fixture.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "test": {"adapter":"test-discovery","command":["sh","packet-edit-fixture.sh"],"minimum":2}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"packet-edit-outcome","scenario":"Evidence survives packet edits","impact":"low","capabilities":["test"]}' \
  '  ]' \
  '}' > openspec/changes/packet-edit-reuse/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/packet-edit-reuse/tasks.md
rm openspec/changes/packet-edit-reuse/tasks.md.bak
assert_cmd_zero "an undeclared-inputs provider proves once" \
  node .claude/harness/foundation.mjs proof-run packet-edit-reuse
assert_eq "the provider ran once" "1" "$(tr -d '\n' < .foundation/packet-edit-count.txt)"
assert_cmd_zero "a provider-scoped hash differs from the change hash" \
  test "$(node .claude/harness/foundation.mjs hash packet-edit-reuse test)" != \
    "$(node .claude/harness/foundation.mjs hash packet-edit-reuse)"
printf '\nA note added after proving.\n' >> openspec/changes/packet-edit-reuse/design.md
packet_plan="$(node .claude/harness/foundation.mjs proof-plan packet-edit-reuse)"
assert_contains "a packet edit leaves an executable receipt valid" \
  "$packet_plan" "test: valid"
assert_cmd_zero "re-proving after a packet edit succeeds" \
  node .claude/harness/foundation.mjs proof-run packet-edit-reuse
assert_eq "a packet edit executes no provider" "1" \
  "$(tr -d '\n' < .foundation/packet-edit-count.txt)"
printf 'changed\n' > packet-edit-code.txt
code_plan="$(node .claude/harness/foundation.mjs proof-plan packet-edit-reuse)"
assert_contains "a code edit still expires the receipt" "$code_plan" "test: stale"
assert_contains "the stale row names the route to a narrower binding" \
  "$code_plan" "declare inputs to narrow it"

# What every existing project meets on the upgrade that changed what a receipt
# binds. A receipt from the previous provider protocol must be refused for that
# reason specifically — not silently accepted, and not reported as some other
# staleness whose route happens to coincide.
cp .foundation/receipts/packet-edit-reuse/test.json "$TMP/current-protocol-receipt.json"
jq '.providerProtocolVersion = "7"' "$TMP/current-protocol-receipt.json" \
  > .foundation/receipts/packet-edit-reuse/test.json
legacy_protocol_plan="$(node .claude/harness/foundation.mjs proof-plan packet-edit-reuse)"
assert_contains "a receipt from the previous provider protocol is refused" \
  "$legacy_protocol_plan" "test: provider-version-stale"
legacy_protocol_prove="$(node .claude/harness/foundation.mjs prove packet-edit-reuse 2>&1 || true)"
assert_contains "the refusal names the protocol as the cause" \
  "$legacy_protocol_prove" "predates the current protocol"
assert_contains "the refusal names the route out" \
  "$legacy_protocol_prove" "claude-foundation proof run packet-edit-reuse"
cp "$TMP/current-protocol-receipt.json" .foundation/receipts/packet-edit-reuse/test.json

fi

# Discovery accepts only an actual non-negative integer. JavaScript-coercible
# values are unknown evidence, while a numeric zero is a real empty suite.
if shard_selected all b b-execution; then
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

fi

# A harness-owned service requires application identity and is shared with the
# provider without leaving a process behind.
if shard_selected all b b-service; then
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
fi

# The Playwright adapter requires structured claim annotations. A deterministic
# fake reporter pins parsing without downloading browser binaries in unit CI.
if shard_selected all c c-browser; then
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

fi

if shard_selected all c c-telemetry; then
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
assert_contains "metrics combine host telemetry with observed operations" \
  "$metrics" '"measurement": "operations-and-host-events"'
assert_contains "host telemetry contributes input tokens" \
  "$metrics" '"inputTokens": 130'
assert_contains "metrics attribute usage by model" \
  "$metrics" '"sonnet":'
assert_contains "metrics attribute usage by repository" \
  "$metrics" '"root":'
# 10+2 local, 120+30 host. The host row's 20 cache-read tokens are context
# re-read, not new work, so they are deliberately absent from this total.
assert_eq "watchdog accumulates known request tokens" "162" \
  "$(jq -r '.budget.usedTokens' .foundation/runtime/tiny-copy-edit.json)"
assert_eq "watchdog excludes cache reads from spend" "3" \
  "$(jq -r '.budget.version' .foundation/runtime/tiny-copy-edit.json)"
# Targets derive from policy on every read, so over-budget is forced the honest
# way: a tiny policy budget plus real ingested usage that crosses it.
tiny_copy_policy_backup=""
if [ -f foundation.json ]; then
  cp foundation.json "$TMP/tiny-copy-policy-backup.json"
  tiny_copy_policy_backup=1
fi
printf '{"version":1,"execution":{"tokenBudgets":{"rapid":10000,"standard":10000}}}\n' \
  > foundation.json
budget_event="$(node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-token-limit --operation build --input 9838)"
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
node .claude/harness/foundation.mjs event tiny-copy-edit \
  --request req-second-limit --operation build --input 10001 >/dev/null
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
  '{"type":"user","sessionId":"claude-native","timestamp":"2026-07-30T00:00:10.000Z","message":{"role":"user","content":"DO-NOT-COPY-PRIVATE-PROMPT"}}' \
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
assert_file_not_contains "transition timing never copies prompt content" \
  ".foundation/logs/tiny-copy-edit/user-transitions.jsonl" "DO-NOT-COPY-PRIVATE-PROMPT"
assert_file_contains "Claude cache creation tokens remain distinct" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"cacheCreationTokens":40'
assert_file_contains "Claude cache read tokens remain distinct" \
  ".foundation/logs/tiny-copy-edit/events.jsonl" '"cacheReadTokens":60'
claude_sync="$(node .claude/harness/foundation.mjs telemetry-sync tiny-copy-edit \
  "$CLAUDE_TRANSCRIPT")"
assert_contains "incremental Claude sync does not recount requests" \
  "$claude_sync" "imported 0"
claude_wait_metrics="$(node .claude/harness/foundation.mjs metrics tiny-copy-edit)"
assert_contains "user transcript timestamps measure human wait" \
  "$claude_wait_metrics" '"humanWaitMs": 10000'

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
printf '%s\n' \
  '{"type":"assistant","requestId":"over-budget-before-prove","message":{"id":"over-budget","role":"assistant","model":"claude-test","usage":{"input_tokens":10011,"output_tokens":7}}}' \
  >> "$BOUND_TRANSCRIPT"
resume_packet="$(FOUNDATION_CLAUDE_SESSION_ID=bound-session \
  FOUNDATION_CLAUDE_TRANSCRIPT_PATH="$BOUND_TRANSCRIPT" \
  node .claude/harness/foundation.mjs packet tiny-copy-edit --phase prove \
  2>"$TMP/over-budget-resume.err")"
assert_contains "over-budget telemetry does not block lifecycle resume" \
  "$resume_packet" '"packetType":"global"'
# This run already spent its one extra window above, so exhausting it again is
# the operator stop rather than another completion boundary — otherwise renaming
# the run would hand back a full allowance with no decision recorded.
assert_contains "over-budget packet after a spent extension requires an operator" \
  "$resume_packet" '"mode":"operator-required"'
assert_contains "the stopped packet forbids scope expansion" \
  "$resume_packet" '"scope-expansion"'
# The stop withholds new work, not the loop's own completion path.
assert_contains "required proof still runs under the operator stop" \
  "$resume_packet" '"provider-run"'
assert_contains "Land can still be resumed under the operator stop" \
  "$resume_packet" '"land-recovery"'
assert_file_contains "over-budget lifecycle resume still emits stop warning" \
  "$TMP/over-budget-resume.err" "CONTINUE_OR_RESCOPE"
if [ -n "$tiny_copy_policy_backup" ]; then
  cp "$TMP/tiny-copy-policy-backup.json" foundation.json
else
  rm -f foundation.json
fi

fi

# A gate that executed and failed has a recorded exit: `change waive` withdraws
# the capability on an explicit host-recorded user decision, the receipts
# already earned stay valid, and the proof record carries the waiver. It is
# never a force-land — proof still has to end "pass", just over the reduced
# required set — and review/acceptance keep their own documented routes.
if shard_selected all c c-waive; then
node .claude/harness/foundation.mjs new 'Waivable gate' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve waivable-gate \
  --impact low --coupling isolated >/dev/null
printf '%s\n' '#!/usr/bin/env sh' \
  'count=0' \
  '[ ! -f .foundation/waive-pass-count.txt ] || count="$(cat .foundation/waive-pass-count.txt)"' \
  'count=$((count + 1))' \
  'printf "%s\\n" "$count" > .foundation/waive-pass-count.txt' \
  'printf "%s\\n" "{\"numTotalTests\":1}"' > waive-pass.sh
printf '%s\n' '#!/usr/bin/env sh' 'exit 1' > waive-fail.sh
chmod +x waive-pass.sh waive-fail.sh
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "test": {"adapter":"test-discovery","command":["sh","waive-pass.sh"],"minimum":1,"inputs":["waive-pass.sh"]},' \
  '    "static-analysis": {"adapter":"command","command":["sh","waive-fail.sh"],"inputs":["waive-fail.sh"]}' \
  '  },' \
  '  "claims": [' \
  '    {"id":"waive-outcome","scenario":"A failing gate can be withdrawn on record","impact":"low","capabilities":["test","static-analysis"]}' \
  '  ]' \
  '}' > openspec/changes/waivable-gate/evidence.yaml
sed -i.bak 's/- \[ \]/- [x]/g' openspec/changes/waivable-gate/tasks.md
rm openspec/changes/waivable-gate/tasks.md.bak
# The aggregate c/all lane ran the browser block above, which deliberately
# leaves activeProofRun behind. A standalone c-waive shard has no such state.
if [ -f .foundation/runtime/browser-adapter.json ]; then
  jq 'del(.activeProofRun)' .foundation/runtime/browser-adapter.json > "$TMP/waive-clear-run.json"
  cp "$TMP/waive-clear-run.json" .foundation/runtime/browser-adapter.json
fi
node .claude/harness/foundation.mjs proof-execute waivable-gate >/dev/null 2>&1 || true
assert_eq "the failing provider recorded a fail receipt" "fail" \
  "$(jq -r '.status' .foundation/receipts/waivable-gate/static-analysis.json)"
if prove_fail_output="$(node .claude/harness/foundation.mjs prove waivable-gate 2>&1)"; then
  fail "a failing gate must block finalize"
else
  assert_contains "a failed gate names the waive route beside the blocker" \
    "$prove_fail_output" "change waive waivable-gate"
fi
assert_cmd_fails_with "waive requires a host-recorded decision reference" \
  "requires --decision-ref" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability static-analysis --reason "vendor linter broken"
assert_cmd_fails_with "waive requires a reason" "requires --reason" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability static-analysis --decision-ref fixture://user/waive-static
assert_cmd_fails_with "review keeps its own waiver route" \
  "review cannot be waived here" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability review --reason "no reviewer" --decision-ref fixture://user/waive-review
assert_cmd_fails_with "acceptance keeps its withdrawal route" \
  "acceptance cannot be waived here" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability acceptance --reason "no acceptor" --decision-ref fixture://user/waive-acceptance
assert_cmd_fails_with "a capability that is not required cannot be waived" \
  "not required" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability deployment --reason "unused" --decision-ref fixture://user/waive-deployment
assert_cmd_zero "a failing gate is waived on user authority" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability static-analysis --reason "vendor linter broken upstream" \
    --decision-ref fixture://user/waive-static
waive_pass_runs="$(tr -d '\n' < .foundation/waive-pass-count.txt)"
assert_cmd_zero "proof run passes over the reduced required set" \
  node .claude/harness/foundation.mjs proof-run waivable-gate
assert_eq "the waive re-prove executed no providers" "$waive_pass_runs" \
  "$(tr -d '\n' < .foundation/waive-pass-count.txt)"
assert_cmd_zero "the proof record carries the waiver as an advisory" \
  jq -e '.advisories[] | select(.capability == "static-analysis" and .reason == "user-waived" and .authority.reference == "fixture://user/waive-static")' \
  .foundation/receipts/waivable-gate/proof.json
assert_cmd_zero "the waived provider left the proof provider set" \
  jq -e '.providers | index("static-analysis") | not' \
  .foundation/receipts/waivable-gate/proof.json
assert_cmd_zero "the waiver revokes on the same authority" \
  node .claude/harness/foundation.mjs waive waivable-gate \
    --capability static-analysis --revoke --decision-ref fixture://user/restore-static
assert_cmd_fails_with "a revoked waiver blocks finalize again" "static-analysis" \
  node .claude/harness/foundation.mjs prove waivable-gate
fi
