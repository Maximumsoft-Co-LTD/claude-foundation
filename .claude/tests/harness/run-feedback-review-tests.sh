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

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp "$ROOT/.claude/harness/protocol.json" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

cd "$TMP/project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git add .
git commit -qm "fixture"

# Rapid work does not acquire subjective acceptance or review by default.
node .claude/harness/foundation.mjs new 'Tiny copy edit' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve tiny-copy-edit \
  --impact low --coupling isolated >/dev/null
rapid_plan="$(node .claude/harness/foundation.mjs proof-plan tiny-copy-edit)"
if printf '%s' "$rapid_plan" | grep -qF 'acceptance:'; then
  fail "untriggered rapid change excludes acceptance"
else
  pass "untriggered rapid change excludes acceptance"
fi
assert_eq "rapid acceptance state defaults false" "false" \
  "$(jq -r '.acceptance.required' .foundation/runtime/tiny-copy-edit.json)"
prototype_hash_before="$(node .claude/harness/foundation.mjs hash tiny-copy-edit)"
mkdir -p .foundation/prototypes/tiny-copy-edit
printf 'selected: option-a\n' > .foundation/prototypes/tiny-copy-edit/selection.md
prototype_hash_after="$(node .claude/harness/foundation.mjs hash tiny-copy-edit)"
assert_eq "disposable prototype is excluded from proof identity" \
  "$prototype_hash_before" "$prototype_hash_after"
assert_cmd_fails_with "undeclared acceptance cannot add workflow overhead" \
  "acceptance evidence is not declared" \
  node .claude/harness/foundation.mjs receipt tiny-copy-edit acceptance pass \
    --acceptor product-owner --decision accept --criterion 'Looks good' \
    --observed 'Inspected' --reference fixture://not-declared

# Explicit acceptance is required evidence, but remains independent from review.
node .claude/harness/foundation.mjs new 'Choose final interaction' >/dev/null
node .claude/harness/foundation.mjs resolve choose-final-interaction \
  --impact low --coupling isolated --acceptance-required \
  --acceptance-reason 'Product owner chooses the final interaction' \
  --acceptance-claims choose-final-interaction-outcome >/dev/null
acceptance_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "explicit acceptance adds a required provider" \
  "$acceptance_plan" "acceptance: missing"
sed 's/- \[ \]/- [x]/g' openspec/changes/choose-final-interaction/tasks.md \
  > "$TMP/accepted-tasks.md"
cp "$TMP/accepted-tasks.md" openspec/changes/choose-final-interaction/tasks.md
acceptance_readiness="$(node .claude/harness/foundation.mjs proof-readiness choose-final-interaction || true)"
assert_contains "readiness emits human acceptance grammar" \
  "$acceptance_readiness" "--acceptor <human> --decision accept"
prototype_selection="$PWD/.foundation/prototypes/tiny-copy-edit/selection.md"
ln -s "$prototype_selection" prototype-selection-link
for rejected in \
  ".foundation/prototypes/tiny-copy-edit/selection.md" \
  ".foundation/logs/../prototypes/tiny-copy-edit/selection.md" \
  "$prototype_selection" \
  "prototype-selection-link"; do
  assert_cmd_fails_with "prototype-origin artifact is rejected: $rejected" \
    "prototype artifacts and references are non-authoritative" \
    node .claude/harness/foundation.mjs receipt choose-final-interaction acceptance pass \
      --acceptor product-owner --decision accept --criterion 'Interaction is understandable' \
      --observed 'Inspected' --artifact app.txt --artifact "$rejected"
done
assert_cmd_fails_with "file URL prototype reference is rejected" \
  "prototype artifacts and references are non-authoritative" \
  node .claude/harness/foundation.mjs receipt choose-final-interaction acceptance pass \
    --acceptor product-owner --decision accept --criterion 'Interaction is understandable' \
    --observed 'Inspected' --reference "file://$prototype_selection"
assert_cmd_fails_with "encoded prototype reference is rejected" \
  "prototype artifacts and references are non-authoritative" \
  node .claude/harness/foundation.mjs receipt choose-final-interaction acceptance pass \
    --acceptor product-owner --decision accept --criterion 'Interaction is understandable' \
    --observed 'Inspected' \
    --reference '.foundation%2Fprototypes%2Ftiny-copy-edit%2Fselection.md'
assert_file_absent "prototype evidence rejection writes no receipt" \
  .foundation/receipts/choose-final-interaction/acceptance.json
assert_file_absent "prototype evidence rejection copies no partial proof artifact" \
  .foundation/evidence/choose-final-interaction
mkdir -p .foundation/logs/choose-final-interaction
printf 'Product owner accepted the interaction.\n' \
  > .foundation/logs/choose-final-interaction/acceptance.txt
assert_cmd_zero "named human acceptance records" \
  node .claude/harness/foundation.mjs receipt choose-final-interaction acceptance pass \
    --acceptor product-owner --decision accept --criterion 'Interaction is understandable' \
    --observed 'Product owner inspected the final interaction' \
    --artifact .foundation/logs/choose-final-interaction/acceptance.txt \
    --reference https://example.invalid/accepted-interaction
if grep -R -qF 'selected: option-a' \
    .foundation/evidence/choose-final-interaction \
    .foundation/receipts/choose-final-interaction 2>/dev/null; then
  fail "proof artifacts contain no prototype selection content"
else
  pass "proof artifacts contain no prototype selection content"
fi
acceptance_receipt=.foundation/receipts/choose-final-interaction/acceptance.json
cp "$acceptance_receipt" "$TMP/clean-acceptance.json"
jq '.references += [".foundation/prototypes/tiny-copy-edit/selection.md"]' \
  "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "tampered prototype reference invalidates a stored receipt" \
  "$tampered_plan" "acceptance: prototype-evidence"
cp "$TMP/clean-acceptance.json" "$acceptance_receipt"
jq '.artifacts[0].sourcePath = ".foundation/prototypes/tiny-copy-edit/selection.md"' \
  "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "tampered prototype artifact origin invalidates a stored receipt" \
  "$tampered_plan" "acceptance: prototype-evidence"
cp "$TMP/clean-acceptance.json" "$acceptance_receipt"
jq '.provenance.source = ".foundation/prototypes/tiny-copy-edit/selection.md"' \
  "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "tampered prototype provenance invalidates a stored receipt" \
  "$tampered_plan" "acceptance: prototype-evidence"
cp "$TMP/clean-acceptance.json" "$acceptance_receipt"
jq '.acceptance.actor.identity = null | .acceptance.criteria = []' \
  "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance validity rechecks identity and criteria" \
  "$tampered_plan" "acceptance: acceptance-invalid"
jq '.acceptance.criteria = [" "]' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "blank acceptance criterion is invalid" "$tampered_plan" "acceptance: acceptance-invalid"
jq '.claims = []' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "missing acceptance claim is invalid" "$tampered_plan" "acceptance: acceptance-invalid"
jq '.claims += ["undeclared-extra"]' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "extra acceptance claim is invalid" "$tampered_plan" "acceptance: acceptance-invalid"
jq '.acceptance.reason = "tampered"' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance reason is revalidated" "$tampered_plan" "acceptance: acceptance-invalid"
jq '.acceptance.subjectWorkspaceHash = "tampered"' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance subject hash is revalidated" "$tampered_plan" "acceptance: acceptance-invalid"
jq '.observed = ""' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance observation remains mandatory" "$tampered_plan" "acceptance: external-observation-missing"
jq '.provenance.source = ""' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance provenance remains mandatory" "$tampered_plan" "acceptance: external-provenance-missing"
jq '.artifacts = [] | .references = []' "$TMP/clean-acceptance.json" > "$acceptance_receipt"
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "acceptance durable evidence remains mandatory" "$tampered_plan" "acceptance: external-evidence-missing"
cp "$TMP/clean-acceptance.json" "$acceptance_receipt"
acceptance_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "valid human acceptance satisfies the provider" \
  "$acceptance_plan" "acceptance: valid"
assert_eq "acceptance receipt binds a human actor" "human" \
  "$(jq -r '.acceptance.actor.type' .foundation/receipts/choose-final-interaction/acceptance.json)"
printf 'post-acceptance edit\n' >> app.txt
acceptance_plan="$(node .claude/harness/foundation.mjs proof-plan choose-final-interaction)"
assert_contains "workspace edit makes acceptance stale" "$acceptance_plan" "acceptance: stale"

node .claude/harness/foundation.mjs new 'Reject automated acceptance' >/dev/null
node .claude/harness/foundation.mjs resolve reject-automated-acceptance \
  --impact low --coupling isolated --acceptance-required \
  --acceptance-reason 'A person must choose' >/dev/null
jq '.providers.acceptance = {"adapter":"command","command":["true"]}' \
  openspec/changes/reject-automated-acceptance/execution.yaml \
  > "$TMP/automated-acceptance.json"
cp "$TMP/automated-acceptance.json" \
  openspec/changes/reject-automated-acceptance/execution.yaml
assert_cmd_fails_with "acceptance cannot use an automated adapter" \
  "acceptance capability requires an external human provider" \
  node .claude/harness/foundation.mjs proof-plan reject-automated-acceptance

node .claude/harness/foundation.mjs new 'Public compatibility contract' >/dev/null
node .claude/harness/foundation.mjs resolve public-compatibility-contract \
  --impact medium --coupling isolated >/dev/null
jq '.claims[0].impact = "medium" | .claims[0].capabilities = ["compatibility"]' \
  openspec/changes/public-compatibility-contract/evidence.yaml \
  > "$TMP/public-compatibility.json"
cp "$TMP/public-compatibility.json" \
  openspec/changes/public-compatibility-contract/evidence.yaml
compatibility_plan="$(node .claude/harness/foundation.mjs proof-plan public-compatibility-contract)"
assert_contains "medium compatibility claims require review" \
  "$compatibility_plan" "review: missing"
jq '.providers.review = {"adapter":"command","command":["true"]}' \
  openspec/changes/public-compatibility-contract/execution.yaml \
  > "$TMP/automated-review.json"
cp "$TMP/automated-review.json" \
  openspec/changes/public-compatibility-contract/execution.yaml
assert_cmd_fails_with "review cannot use an automated adapter" \
  "review capability requires an external provider" \
  node .claude/harness/foundation.mjs proof-plan public-compatibility-contract

# Critical semantics require independent and diverse review provenance.
node .claude/harness/foundation.mjs new 'Irreversible payment migration' >/dev/null
node .claude/harness/foundation.mjs resolve irreversible-payment-migration \
  --impact high --coupling coupled --security migration >/dev/null
jq '.claims = [range(0; 80) as $n | {
      id: ("review-claim-" + ($n|tostring)),
      scenario: ("Reviewer verifies a long seeded critical behavior, compatibility boundary, rollback constraint, and observable result for claim " + ($n|tostring)),
      impact: "high",
      capabilities: ["test", "review", "compatibility"]
    }]' openspec/changes/irreversible-payment-migration/evidence.yaml \
  > "$TMP/many-review-claims.json"
cp "$TMP/many-review-claims.json" \
  openspec/changes/irreversible-payment-migration/evidence.yaml
printf '\n- [ ] **T999** SECRET-TASK-TEXT-MUST-NOT-ENTER-REVIEW-PACKET\n' \
  >> openspec/changes/irreversible-payment-migration/tasks.md
mkdir -p .foundation/logs/irreversible-payment-migration
printf 'SECRET-TRANSCRIPT-MUST-NOT-ENTER-REVIEW-PACKET\n' \
  > .foundation/logs/irreversible-payment-migration/transcript.txt
sed 's/- \[ \]/- [x]/g' openspec/changes/irreversible-payment-migration/tasks.md \
  > "$TMP/reviewed-tasks.md"
cp "$TMP/reviewed-tasks.md" openspec/changes/irreversible-payment-migration/tasks.md
node .claude/harness/foundation.mjs receipt irreversible-payment-migration test fail \
  --observed 'Seeded behavioral test failed' --source fixture-suite \
  --reference fixture://failed-test >/dev/null

review_packet="$(node .claude/harness/foundation.mjs packet \
  irreversible-payment-migration --phase review)"
review_readiness="$(node .claude/harness/foundation.mjs proof-readiness irreversible-payment-migration || true)"
assert_contains "readiness routes review through bounded packet" \
  "$review_readiness" "packet irreversible-payment-migration --phase review"
review_bytes="$(printf '%s' "$review_packet" | wc -c | tr -d ' ')"
if [ "$review_bytes" -le 8192 ]; then
  pass "review packet stays within 8 KiB ($review_bytes bytes)"
else
  fail "review packet exceeds 8 KiB ($review_bytes bytes)"
fi
assert_contains "review packet declares required diversity" \
  "$review_packet" '"diversity":"required"'
assert_contains "review packet retains failed evidence diagnostics" \
  "$review_packet" 'Seeded behavioral test failed'
if printf '%s' "$review_packet" | grep -qF 'SECRET-TASK-TEXT-MUST-NOT-ENTER-REVIEW-PACKET'; then
  fail "review packet excludes task text"
else
  pass "review packet excludes task text"
fi
if printf '%s' "$review_packet" | grep -qF 'SECRET-TRANSCRIPT-MUST-NOT-ENTER-REVIEW-PACKET'; then
  fail "review packet excludes transcripts"
else
  pass "review packet excludes transcripts"
fi

assert_cmd_fails_with "same-session AI review is rejected" \
  "reviewer must use an identity and session independent" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family openai --reviewer-model-family gpt-5 \
    --reviewer-model gpt-5.4 --reviewer-session implementation-session \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.4 --unresolved-blockers 0 \
    --observed 'No blockers' --reference fixture://same-session

assert_cmd_fails_with "same-family critical AI review is rejected" \
  "requires a different provider/model family or a human reviewer" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family openai --reviewer-model-family gpt-5 \
    --reviewer-model gpt-5.4 --reviewer-session review-session \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --unresolved-blockers 0 \
    --observed 'No blockers' --reference fixture://same-family

assert_cmd_fails_with "human review without implementation provenance is rejected" \
  "requires at least one --subject-actor" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type human --reviewer-identity security-owner \
    --unresolved-blockers 0 --observed 'No blockers' \
    --reference fixture://human-missing-subject

assert_cmd_fails_with "human implementer cannot review their own work" \
  "reviewer must use an identity and session independent" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type human --reviewer-identity implementer-ai \
    --subject-actor implementer-ai --unresolved-blockers 0 \
    --observed 'No blockers' --reference fixture://human-self-review

assert_cmd_fails_with "structured provenance rejects one correlated subject" \
  "reviewer must use an identity and session independent" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family anthropic --reviewer-model-family claude \
    --reviewer-model claude-opus --reviewer-session review-session \
    --subject-provenance '{"type":"ai","identity":"implementer-ai","sessionId":"implementation-session","providerFamily":"openai","modelFamily":"gpt-5","modelId":"gpt-5.3"}' \
    --subject-provenance '{"type":"ai","identity":"reviewer-ai","sessionId":"paired-session","providerFamily":"google","modelFamily":"gemini","modelId":"gemini-pro"}' \
    --unresolved-blockers 0 --observed 'No blockers' \
    --reference fixture://structured-correlated

assert_cmd_zero "diverse AI review passes critical policy" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family anthropic --reviewer-model-family claude \
    --reviewer-model claude-opus --reviewer-session review-session \
    --subject-provenance '{"type":"ai","identity":"implementer-ai","sessionId":"implementation-session","providerFamily":"openai","modelFamily":"gpt-5","modelId":"gpt-5.3"}' \
    --subject-provenance '{"type":"ai","identity":"pair-agent","sessionId":"pair-session","providerFamily":"google","modelFamily":"gemini","modelId":"gemini-pro"}' \
    --unresolved-blockers 0 \
    --observed 'No blockers' --reference fixture://diverse-review
critical_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "diverse AI receipt is valid" "$critical_plan" "review: valid"
cp .foundation/receipts/irreversible-payment-migration/review.json \
  "$TMP/bound-review.json"
jq '.review.reviewer.modelId = "tampered-model"' "$TMP/bound-review.json" \
  > .foundation/receipts/irreversible-payment-migration/review.json
critical_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "review history binds reviewer and model" \
  "$critical_plan" "review: review-attempt-history-invalid"
jq '.review.findings.verified = 99' "$TMP/bound-review.json" \
  > .foundation/receipts/irreversible-payment-migration/review.json
critical_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "review history binds findings" \
  "$critical_plan" "review: review-attempt-history-invalid"
jq '.review.scope.digest = "tampered"' "$TMP/bound-review.json" \
  > .foundation/receipts/irreversible-payment-migration/review.json
critical_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "review validity recomputes scope digest" \
  "$critical_plan" "review: review-attempt-history-invalid"
cp "$TMP/bound-review.json" \
  .foundation/receipts/irreversible-payment-migration/review.json

printf 'reviewed fix one\n' >> app.txt
assert_cmd_zero "scoped second AI review is allowed" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family anthropic --reviewer-model-family claude \
    --reviewer-model claude-opus --reviewer-session review-session-two \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --scope-path app.txt --unresolved-blockers 0 \
    --observed 'Scoped fix has no blockers' --reference fixture://diverse-review-two
assert_eq "second AI review records round two" "2" \
  "$(jq -r '.review.round' .foundation/receipts/irreversible-payment-migration/review.json)"

cp openspec/changes/irreversible-payment-migration/execution.yaml \
  "$TMP/original-review-execution.json"
jq '.providers["peer-review"] = {"capability":"review","adapter":"external","claims":"declared"}' \
  openspec/changes/irreversible-payment-migration/execution.yaml \
  > "$TMP/renamed-review-provider.json"
cp "$TMP/renamed-review-provider.json" \
  openspec/changes/irreversible-payment-migration/execution.yaml
assert_cmd_fails_with "provider rename cannot reset the AI review cap" \
  "AI review is limited to two rounds" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration peer-review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family anthropic --reviewer-model-family claude \
    --reviewer-model claude-opus --reviewer-session renamed-provider-session \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --scope-path app.txt --unresolved-blockers 0 \
    --observed 'Renamed provider pass' --reference fixture://renamed-review
cp "$TMP/original-review-execution.json" \
  openspec/changes/irreversible-payment-migration/execution.yaml

attempt_dir=.foundation/evidence/irreversible-payment-migration/review-attempts
attempt_file="$(ls "$attempt_dir" | sort | tail -1)"
mv "$attempt_dir/$attempt_file" "$TMP/$attempt_file"
assert_cmd_fails_with "missing monotonic history fails closed" \
  "review attempt history is missing or corrupt" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type human --reviewer-identity security-owner \
    --subject-actor implementer-ai --unresolved-blockers 0 \
    --observed 'History must be intact' --reference fixture://history-missing
mv "$TMP/$attempt_file" "$attempt_dir/$attempt_file"

cp "$attempt_dir/$attempt_file" "$TMP/intact-$attempt_file"
jq '.status = "tampered"' "$TMP/intact-$attempt_file" \
  > "$attempt_dir/$attempt_file"
assert_cmd_fails_with "tampered monotonic history fails closed" \
  "review attempt history is missing or corrupt" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type human --reviewer-identity security-owner \
    --subject-actor implementer-ai --unresolved-blockers 0 \
    --observed 'History must be authentic' --reference fixture://history-tampered
cp "$TMP/intact-$attempt_file" "$attempt_dir/$attempt_file"

cp .foundation/receipts/irreversible-payment-migration/review.json "$TMP/round-two-review.json"
rm .foundation/receipts/irreversible-payment-migration/review.json
assert_cmd_fails_with "receipt deletion cannot reset the AI review cap" \
  "AI review is limited to two rounds" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type ai --reviewer-identity reviewer-ai \
    --reviewer-provider-family anthropic --reviewer-model-family claude \
    --reviewer-model claude-opus --reviewer-session review-session-three \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --scope-path app.txt --unresolved-blockers 0 \
    --observed 'Third AI pass' --reference fixture://diverse-review-three
cp "$TMP/round-two-review.json" \
  .foundation/receipts/irreversible-payment-migration/review.json

assert_cmd_zero "round-three human can record a blocker" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review fail \
    --reviewer-type human --reviewer-identity security-owner \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --unresolved-blockers 1 --verified-findings 1 \
    --observed 'Human found a blocker' --reference fixture://human-review-blocker
printf 'human-requested fix\n' >> app.txt
assert_cmd_zero "human re-review can pass after escalation fix" \
  node .claude/harness/foundation.mjs receipt irreversible-payment-migration review pass \
    --reviewer-type human --reviewer-identity security-owner \
    --subject-actor implementer-ai --subject-session implementation-session \
    --subject-provider-family openai --subject-model-family gpt-5 \
    --subject-model gpt-5.3 --unresolved-blockers 0 --scope-path app.txt \
    --observed 'Human verified the blocker fix' --reference fixture://human-review-fixed
assert_eq "human re-review records round four" "4" \
  "$(jq -r '.review.round' .foundation/receipts/irreversible-payment-migration/review.json)"
assert_eq "human reviewer is recorded" "human" \
  "$(jq -r '.review.reviewer.type' .foundation/receipts/irreversible-payment-migration/review.json)"

cp .foundation/receipts/irreversible-payment-migration/review.json "$TMP/valid-review.json"
jq '.review.subjects[0].identity = "security-owner" | .review.policy.independent = true' \
  "$TMP/valid-review.json" > .foundation/receipts/irreversible-payment-migration/review.json
tampered_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "validity recomputes tampered independence" \
  "$tampered_plan" "review: review-not-independent"
cp "$TMP/valid-review.json" .foundation/receipts/irreversible-payment-migration/review.json

# Legacy review receipts stay readable but cannot satisfy the new review policy.
jq 'del(.reviewProtocolVersion)' \
  .foundation/receipts/irreversible-payment-migration/review.json \
  > "$TMP/legacy-review.json"
cp "$TMP/legacy-review.json" \
  .foundation/receipts/irreversible-payment-migration/review.json
legacy_plan="$(node .claude/harness/foundation.mjs proof-plan irreversible-payment-migration)"
assert_contains "legacy review receipt is specifically stale" \
  "$legacy_plan" "review: review-version-stale"
assert_eq "provider protocol remains backward-compatible" "6" \
  "$(jq -r '.providerProtocolVersion' .foundation/receipts/irreversible-payment-migration/review.json)"
assert_cmd_zero "protocol bundle advertises feedback protocols" \
  jq -e '.reviewProtocol == "2" and .acceptanceProtocol == "2" and .reviewPacketSchema == "2"' \
    .claude/harness/protocol.json

node .claude/harness/foundation.mjs new 'Missing recorded base' >/dev/null
node .claude/harness/foundation.mjs resolve missing-recorded-base \
  --impact high --coupling isolated >/dev/null
printf 'committed after recorded base\n' >> app.txt
git add app.txt
git commit -qm 'committed after recorded base'
recorded_base_packet="$(node .claude/harness/foundation.mjs packet \
  missing-recorded-base --phase review)"
printf '%s' "$recorded_base_packet" > "$TMP/recorded-base-packet.json"
assert_cmd_zero "review surface includes committed root change from recorded base" \
  jq -e '.changedSurface.rows[] |
    select(.repositoryId == "root" and .path == "app.txt") |
    .sources | index("committed") != null' "$TMP/recorded-base-packet.json"
jq 'del(.workspace.baseHead) | del(.repositories.root.baseHead)' \
  .foundation/runtime/missing-recorded-base.json > "$TMP/missing-recorded-base.json"
cp "$TMP/missing-recorded-base.json" \
  .foundation/runtime/missing-recorded-base.json
assert_cmd_fails_with "review surface requires the recorded base" \
  "missing baseHead" \
  node .claude/harness/foundation.mjs packet missing-recorded-base --phase review

finish "feedback review contracts"
