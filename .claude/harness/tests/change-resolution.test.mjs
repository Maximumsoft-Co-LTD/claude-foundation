import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicStartPreflight, createChangeLifecycle, reviewRouteLabel
} from "../runtime/workflow/change-lifecycle.mjs";
import { SECURITY_TERMS } from "../runtime/workflow/security-policy.mjs";
import { semanticRapidCandidate } from "../runtime/workflow/semantic-draft.mjs";
import { repositoryIntelligenceRequired } from "../runtime/workflow/validation/repository-intelligence.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-change-resolution-"));
const changeDir = join(root, "openspec", "changes", "change-1");
const templateDir = join(root, "openspec", "schemas", "foundation-standard", "templates");
mkdirSync(changeDir, { recursive: true });
mkdirSync(templateDir, { recursive: true });
for (const name of ["design.md", "grounding.yaml", "spec.md"])
  writeFileSync(join(templateDir, name), "<title> replace-with-stable-claim-id\n");

let state;
let saved;
let grounding = "optional";
let riskBasedCi = false;
let reviewPolicy = "legacy";
let output = "";
const priorLog = console.log;
console.log = (message) => { output += `${message}\n`; };
const fail = (message) => { throw new Error(message); };
const baseState = () => ({
  id: "change-1",
  intent: "Improve accessibility guidance",
  schema: "foundation-standard",
  status: "change",
  impact: "low",
  coupling: "isolated",
  securityTriggers: ["none"],
  reviewRequired: false,
  acceptance: { decision: "undecided", required: false },
  contractRevision: 0
});
const lifecycle = createChangeLifecycle({
  root,
  policy: () => ({ workflow: { grounding, reviewPolicy }, land: { riskBasedCi } }),
  securityTerms: ["access", "auth token", "a+b"], fail,
  pathInside: () => true, readJson: () => ({}), writeJson: () => {},
  slugify: (value) => String(value).toLowerCase().replaceAll(" ", "-"),
  changePath: () => changeDir,
  loadRuntime: () => state,
  saveRuntime: (value) => { saved = value; },
  setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
  preexistingDirty: () => [], now: () => "2026-08-26T00:00:00.000Z",
  bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {}, showPacket: () => {}
});
const run = (flags = {}, overrides = {}) => {
  state = { ...baseState(), ...overrides };
  saved = null;
  output = "";
  lifecycle.resolveChange("change-1", flags);
  assert.equal(saved, state);
  return state;
};
const rejected = (flags, pattern, overrides = {}) => {
  state = { ...baseState(), ...overrides };
  assert.throws(() => lifecycle.resolveChange("change-1", flags), pattern);
};

try {
  rejected({ "reopen-grounding": true }, /requires --decision-ref and --reopen-reason/);
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /already has an open revision/, { groundingReopenPending: { version: 1 }, groundingDigest: "old" });
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /currently locked grounding ledger/);
  rejected({ "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" },
    /decision-ref was already used/, { groundingDigest: "old", groundingReopens: [{ decisionRef: "D2" }] });
  rejected({ "decision-ref": "D2" }, /require --reopen-grounding/);
  rejected({ "reopen-reason": "revise" }, /require --reopen-grounding/);
  const reopened = run({
    "reopen-grounding": true, "decision-ref": " D2 ", "reopen-reason": " revise "
  }, { groundingDigest: "old", groundingLockedAt: "then" });
  assert.deepEqual(reopened.groundingReopenPending, {
    version: 1, decisionRef: "D2", reason: "revise", priorDigest: "old",
    priorLockedAt: "then", openedAt: "2026-08-26T00:00:00.000Z"
  });
  assert.equal(reopened.groundingDigest, undefined);
  assert.equal(reopened.groundingLockedAt, undefined);
  assert.equal(reopened.contractRevision, 1);

  rejected({ ambiguity: "maybe" }, /ambiguity must be clear\|unclear/);
  rejected({ size: "huge" }, /size must be xs\|s\|m\|l/);
  rejected({ surface: " , " }, /surface requires at least one path or glob/);
  const attributes = run({
    ambiguity: "unclear", impact: "medium", coupling: "coupled", size: "M",
    surface: " src/b.js,src/a.js, src/b.js "
  });
  assert.equal(attributes.ambiguity, "unclear");
  assert.equal(attributes.resolvedAt, "2026-08-26T00:00:00.000Z");
  assert.equal(attributes.size, "m");
  assert.deepEqual(attributes.declaredSurface, ["src/a.js", "src/b.js"]);
  assert.match(output, /surface: src\/a.js, src\/b.js/);
  run({});

  const boundary = run({}, { intent: "Improve accessibility guidance", securityTriggers: [] });
  assert.deepEqual(boundary.securityTriggers, []);
  assert.equal(boundary.reviewRequired, false);
  const inferred = run({ security: "none, manual" }, {
    intent: "Rotate an AUTH-TOKEN and an a+b marker", securityTriggers: ["none", "manual"]
  });
  assert.deepEqual(inferred.securityTriggers, ["manual"]);
  assert.deepEqual(inferred.keywordSecurityTriggers, ["auth token", "a+b"]);
  assert.equal(inferred.reviewRequired, true);
  assert.equal(inferred.reviewKeywordOnly, undefined, "a declared trigger is not keyword-only");
  // A re-resolve keeps keyword triggers keyword-only instead of promoting them.
  state = inferred; lifecycle.resolveChange("change-1", {});
  assert.deepEqual(state.securityTriggers, ["manual"]);
  assert.deepEqual(state.keywordSecurityTriggers, ["auth token", "a+b"]);
  const businessValidation = run({
    security: "untrusted-input,type-confusion-validation-bypass,schema-validation"
  }, { intent: "Reject boolean seat counts in workspace API validation", securityTriggers: [] });
  assert.deepEqual(businessValidation.securityTriggers, []);
  assert.equal(businessValidation.reviewRequired, false);
  const trustBoundaryValidation = run({
    security: "untrusted-input,type-confusion-validation-bypass"
  }, { intent: "Reject an auth token bypass in workspace API validation", securityTriggers: [] });
  assert.deepEqual(trustBoundaryValidation.securityTriggers,
    ["untrusted-input", "type-confusion-validation-bypass"]);
  assert.deepEqual(trustBoundaryValidation.keywordSecurityTriggers, ["auth token"]);
  assert.equal(trustBoundaryValidation.reviewRequired, true);
  assert.equal(run({}, { impact: "high", securityTriggers: [] }).reviewRequired, true);
  assert.equal(run({}, { impact: "medium", coupling: "coupled", securityTriggers: [] }).reviewRequired, true);
  assert.equal(run({}, { impact: "low", coupling: "coupled", securityTriggers: [] }).reviewRequired, false);
  assert.equal(run({ review: true }, { securityTriggers: [] }).reviewRequired, true);
  const declaredWithKeyword = run({ review: true, impact: "low", coupling: "isolated" }, {
    intent: "Rename the auth token label", securityTriggers: []
  });
  assert.deepEqual(declaredWithKeyword.keywordSecurityTriggers, ["auth token"]);
  assert.equal(declaredWithKeyword.reviewKeywordOnly, undefined,
    "an explicit --review stays declared even when a keyword also matches");

  rejected({ "acceptance-required": true, "acceptance-not-required": true }, /cannot combine/);
  rejected({ "acceptance-reason": "needed" }, /require --acceptance-required/);
  rejected({ "acceptance-claims": "claim-1" }, /require --acceptance-required/);
  rejected({ "acceptance-required": true }, /requires --acceptance-reason/);
  const accepted = run({
    "acceptance-required": true,
    "acceptance-reason": " User-visible behavior ",
    "acceptance-claims": " claim-2, ,claim-1 "
  });
  assert.deepEqual(accepted.acceptance.claimIds, ["claim-2", "claim-1"]);
  assert.equal(accepted.acceptance.scopeOrigin, "explicit");
  assert.equal(run({ "acceptance-not-required": true }).acceptance.decision, "not-required");
  run({}, { acceptance: { required: true } });
  assert.match(output, /acceptance: required/);
  run({}, { acceptance: undefined });
  assert.match(output, /acceptance: legacy-not-required/);

  const rapid = run({}, { schema: "foundation-rapid", securityTriggers: [] });
  assert.equal(rapid.schema, "foundation-rapid");
  // User decision: an intent keyword alone only makes review required; the
  // change keeps the rapid lane and gains no design.md or specs/.
  const keywordOnly = run({ impact: "low", coupling: "isolated", security: "" }, {
    intent: "Rename the auth token label on the billing page",
    schema: "foundation-rapid", securityTriggers: []
  });
  assert.equal(keywordOnly.schema, "foundation-rapid");
  assert.equal(keywordOnly.upgradedFrom, undefined);
  assert.equal(keywordOnly.reviewRequired, true);
  assert.deepEqual(keywordOnly.securityTriggers, []);
  assert.deepEqual(keywordOnly.keywordSecurityTriggers, ["auth token"]);
  assert.equal(keywordOnly.reviewKeywordOnly, true,
    "keyword-only review is marked so verification risk follows its tier");
  assert.match(output, /security: auth token \(intent keyword: review only\)/);
  assert.match(output, /review: required/);
  assert.match(output, /schema: foundation-rapid\n/);
  assert.equal(existsSync(join(changeDir, "design.md")), false);
  // A declared trigger keeps upgrading the lane exactly as before.
  const declaredRapid = run({ security: "auth token" }, {
    intent: "Rename the auth token label", schema: "foundation-rapid", securityTriggers: []
  });
  assert.deepEqual(declaredRapid.securityTriggers, ["auth token"]);
  assert.equal(declaredRapid.keywordSecurityTriggers, undefined);
  assert.equal(declaredRapid.reviewKeywordOnly, undefined);
  assert.equal(declaredRapid.schema, "foundation-standard");
  assert.equal(declaredRapid.upgradedFrom, "foundation-rapid");
  rmSync(join(changeDir, "design.md"), { force: true });
  rmSync(join(changeDir, "grounding.yaml"), { force: true });
  rmSync(join(changeDir, "specs"), { recursive: true, force: true });

  // The shipped term list: a /dev intent naming "Billing" with no declared
  // trigger stays rapid end to end — draft lane, evidence defaults, repository
  // intelligence, and resolve — and only requires review.
  const billingDraft = {
    version: 4, intent: "Show the Billing page total in bold",
    acceptance: { required: false }, execution: { version: 1, providers: { test: {} } }
  };
  assert.equal(atomicStartPreflight(billingDraft).rapid, true);
  assert.equal(semanticRapidCandidate(billingDraft), true);
  assert.equal(repositoryIntelligenceRequired(billingDraft), false);
  const shipped = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding }, land: { riskBasedCi } }),
    securityTerms: SECURITY_TERMS, fail, pathInside: () => true, readJson: () => ({}),
    writeJson: () => {}, slugify: (value) => String(value), changePath: () => changeDir,
    loadRuntime: () => state, saveRuntime: (value) => { saved = value; },
    setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
    preexistingDirty: () => [], now: () => "2026-08-26T00:00:00.000Z",
    bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {}, showPacket: () => {}
  });
  state = { ...baseState(), intent: billingDraft.intent, schema: "foundation-rapid", securityTriggers: [] };
  output = "";
  shipped.resolveChange("change-1", { impact: "low", coupling: "isolated", security: "" });
  assert.equal(state.schema, "foundation-rapid");
  assert.equal(state.reviewRequired, true);
  assert.deepEqual(state.securityTriggers, []);
  assert.deepEqual(state.keywordSecurityTriggers, ["billing"]);
  assert.match(output, /security: billing \(intent keyword: review only\)/);
  assert.equal(existsSync(join(changeDir, "design.md")), false);
  // A Thai intent (no word spaces) names the same boundary and routes the same.
  state = { ...baseState(), intent: "เพิ่มหน้าเข้าสู่ระบบด้วยรหัสผ่านใหม่",
    schema: "foundation-rapid", securityTriggers: [] };
  shipped.resolveChange("change-1", { impact: "low", coupling: "isolated", security: "" });
  assert.equal(state.schema, "foundation-rapid");
  assert.equal(state.reviewRequired, true);
  assert.deepEqual(state.keywordSecurityTriggers, ["เข้าสู่ระบบ", "รหัสผ่าน"]);
  assert.equal(existsSync(join(changeDir, "design.md")), false);
  state = { ...baseState(), intent: billingDraft.intent, schema: "foundation-rapid", securityTriggers: [] };
  shipped.resolveChange("change-1", { impact: "low", coupling: "isolated", security: "billing" });
  assert.equal(state.schema, "foundation-standard");
  assert.deepEqual(state.securityTriggers, ["billing"]);
  assert.equal(atomicStartPreflight({ ...billingDraft, securityTriggers: ["billing"] }).rapid, false);
  assert.equal(semanticRapidCandidate({ ...billingDraft, securityTriggers: ["billing"] }), false);
  assert.equal(repositoryIntelligenceRequired({ ...billingDraft, securityTriggers: ["billing"] }), true);
  rmSync(join(changeDir, "design.md"), { force: true });
  rmSync(join(changeDir, "grounding.yaml"), { force: true });
  rmSync(join(changeDir, "specs"), { recursive: true, force: true });
  grounding = "required";
  riskBasedCi = true;
  const upgraded = run({ impact: "medium" }, {
    schema: "foundation-rapid", securityTriggers: [], groundingRequired: false
  });
  assert.equal(upgraded.schema, "foundation-standard");
  assert.equal(upgraded.upgradedFrom, "foundation-rapid");
  assert.equal(upgraded.groundingRequired, true);
  assert.equal(upgraded.riskBasedCiRequired, true);
  assert.equal(existsSync(join(changeDir, "design.md")), true);
  assert.equal(existsSync(join(changeDir, "grounding.yaml")), true);
  assert.equal(existsSync(join(changeDir, "specs", "change", "spec.md")), true);
  assert.match(output, /upgraded from foundation-rapid/);

  // Signed CI follows the current policy on every resolve, and a user's
  // waiver outlives later policy reads. A consumer sat in Build with the
  // requirement pinned from a historical `riskBasedCi: true` default and no
  // route but a hand edit of foundation.json, which the guard refuses there.
  riskBasedCi = false;
  assert.equal(run({}, { riskBasedCiRequired: true }).riskBasedCiRequired, false);
  riskBasedCi = true;
  assert.equal(run({}, { riskBasedCiRequired: false }).riskBasedCiRequired, true);
  rejected({ "ci-not-required": true }, /--ci-not-required requires --decision-ref/);
  const waived = run({ "ci-not-required": true, "decision-ref": "CI-WAIVER-1" },
    { riskBasedCiRequired: true });
  assert.equal(waived.riskBasedCiRequired, false);
  assert.deepEqual(waived.ciWaiver,
    { version: 1, decisionRef: "CI-WAIVER-1", declaredAt: "2026-08-26T00:00:00.000Z" });
  assert.match(output, /signed CI: waived \(CI-WAIVER-1\)/);
  assert.equal(run({}, { riskBasedCiRequired: false, ciWaiver: waived.ciWaiver }).riskBasedCiRequired,
    false, "a recorded waiver is not undone by a later policy read");
  const waivedUpgrade = run({ impact: "medium" }, {
    schema: "foundation-rapid", securityTriggers: [], groundingRequired: false,
    riskBasedCiRequired: false, ciWaiver: waived.ciWaiver
  });
  assert.equal(waivedUpgrade.schema, "foundation-standard");
  assert.equal(waivedUpgrade.riskBasedCiRequired, false, "a schema upgrade keeps the waiver");
  assert.doesNotMatch(run({}, { riskBasedCiRequired: true }) && output, /signed CI: waived/);

  // Upgrading a compiled rapid packet keeps its delta specs and adds no
  // placeholder spec beside them.
  rmSync(join(changeDir, "specs"), { recursive: true, force: true });
  mkdirSync(join(changeDir, "specs", "board"), { recursive: true });
  writeFileSync(join(changeDir, "specs", "board", "spec.md"), "# board\n");
  const upgradedRapidSpecs = run({ impact: "medium" }, {
    schema: "foundation-rapid", securityTriggers: [], groundingRequired: false
  });
  assert.equal(upgradedRapidSpecs.schema, "foundation-standard");
  assert.equal(existsSync(join(changeDir, "specs", "change", "spec.md")), false);
  rmSync(join(changeDir, "specs"), { recursive: true, force: true });

  // Under risk-tiered policy every change gets an AI review: "not required"
  // was false (benchmark v3.5.29), so the route is named instead.
  reviewPolicy = "risk-tiered";
  run({}, { intent: "Create kanban board", schema: "foundation-rapid", securityTriggers: [] });
  assert.match(output, /review: risk-tiered AI review \(low tier, fast model\)\n/);
  assert.doesNotMatch(output, /not required/);
  run({ impact: "high" }, { intent: "Create kanban board", securityTriggers: [] });
  assert.match(output, /review: risk-tiered AI review \(high tier, configured model\)\n/);
  reviewPolicy = "legacy";
  run({}, { intent: "Create kanban board", schema: "foundation-rapid", securityTriggers: [] });
  assert.match(output, /review: not required \(legacy review policy: no AI review runs\)\n/);
  // The label follows the same signals validation uses.
  assert.equal(reviewRouteLabel({ reviewPolicy: "legacy", state: { reviewRequired: true } }), "required");
  assert.equal(reviewRouteLabel({
    reviewPolicy: "legacy", state: { reviewRequired: false },
    claims: [{ id: "c", impact: "low", capabilities: ["test", "review"] }]
  }), "required");
  assert.equal(reviewRouteLabel({
    reviewPolicy: "risk-tiered", state: { impact: "medium", securityTriggers: [] },
    claims: [{ id: "c", impact: "low", capabilities: ["test"] }]
  }), "risk-tiered AI review (medium tier, configured model)");
  assert.equal(reviewRouteLabel({ reviewPolicy: "risk-tiered", lowRiskModel: "configured",
    state: { impact: "low", securityTriggers: [] } }), "risk-tiered AI review (low tier, configured model)");

  // Open questions are read from the packet the approval covers: the
  // workspace copy once Build isolated one, not the target checkout.
  {
    const workspace = join(root, "workspace");
    const packet = join(workspace, "openspec", "changes", "change-1");
    mkdirSync(packet, { recursive: true });
    writeFileSync(join(packet, "design.md"),
      "## Context\n\n### Open questions\n\n- Keep deleted cards? (owner: user)\n");
    state = { ...baseState(), workspace: { path: workspace } };
    const decision = lifecycle.openQuestionsDecision("change-1");
    assert.ok(decision, "open questions in the workspace packet are asked");
    assert.match(decision.message, /Keep deleted cards\?/);
    state = baseState();
    assert.equal(lifecycle.openQuestionsDecision("change-1"), null);
    rmSync(workspace, { recursive: true, force: true });
  }

  console.log = priorLog;
  priorLog("change resolution tests: PASS");
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
