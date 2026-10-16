import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  QUALITY_FIELDS, groundingFromQuality, renderCapacity, renderNfr, renderObservability,
  renderThreatModel, renderTrackingPlan, validateCapacity, validateNfr,
  validateObservability, validateThreatModel, validateTrackingPlan,
} from "../runtime/workflow/validation/quality-fields.mjs";
import {
  NFR_CATEGORY_CAPABILITIES, createChangeValidationRuntime,
} from "../runtime/workflow/change-validation.mjs";

const threatModel = {
  assets: ["session token (secret)", "member PII (personal)"],
  trustBoundaries: ["browser → API", "API → payment provider"],
  threats: [
    { key: "THR-1", stride: "spoofing", threat: "stolen token replay", likelihood: "medium",
      impact: "high", control: "short-lived tokens", scenario: "rejects expired token", residual: "low" },
    { key: "THR-2", stride: "I", threat: "PII in logs", likelihood: "low", impact: "high",
      control: "log redaction", residual: "low" },
    { key: "THR-3", stride: "denial of service", threat: "unbounded export", likelihood: "medium",
      impact: "medium", control: "rate limit", residual: "medium" },
  ],
};

const nfr = [{
  key: "NFR-1", characteristic: "Performance efficiency", source: "member",
  stimulus: "100 rps search", environment: "normal load", response: "results returned",
  measure: "p95 <= 250 ms", claim: "claim-a",
}];

const observability = {
  correlation: "request_id",
  rows: [{ failure: "provider timeout", signal: "payment.timeout log", sli: "success rate",
    slo: "99.5% / 30d", alert: "burn rate 2x", runbook: "switch provider", owner: "payments" }],
  usage: ["searches per tenant per day"],
  piiCheck: "no PII in telemetry fields",
};

test("threat model renders assets, trust boundaries, and three STRIDE rows", () => {
  assert.deepEqual(validateThreatModel(threatModel), []);
  const body = renderThreatModel(threatModel, { language: "en" });
  assert.match(body, /\*\*Assets and data classes:\*\* session token \(secret\); member PII/);
  assert.match(body, /\*\*Trust boundaries:\*\* browser → API; API → payment provider/);
  const rows = body.split("\n").filter((line) => /^\| THR-/.test(line));
  assert.equal(rows.length, 3);
  assert.match(rows[1], /information-disclosure/);
  assert.match(rows[0], /medium × high/);
  assert.doesNotMatch(body, /\[object Object\]/);
});

test("threat model issues carry exact paths", () => {
  const issues = validateThreatModel({ assets: [], trustBoundaries: ["x"],
    threats: [{ key: "T", stride: "bogus", threat: "t", likelihood: "huge", impact: "low", control: "c" }] });
  assert.ok(issues.includes("threatModel.assets must not be empty"));
  assert.ok(issues.includes("threatModel.threats[0].residual is required"));
  assert.ok(issues.some((issue) => issue.startsWith("threatModel.threats[0].stride must be one of")));
  assert.ok(issues.includes("threatModel.threats[0].likelihood must be low|medium|high"));
});

test("nfr without measure is an issue at its exact path", () => {
  const issues = validateNfr([{ ...nfr[0], measure: undefined }]);
  assert.deepEqual(issues, ["nfr[0].measure is required"]);
  assert.deepEqual(validateNfr(nfr), []);
  assert.ok(validateNfr([{ ...nfr[0], characteristic: "speediness" }])[0]
    .startsWith("nfr[0].characteristic 'speediness' must be an ISO 25010"));
  assert.match(renderNfr(nfr), /\| NFR-1 \| Performance efficiency \| 100 rps search \| results returned \| p95 <= 250 ms \| member \| normal load \| claim-a \|/);
});

test("observability, tracking plan, and capacity validate and render", () => {
  assert.deepEqual(validateObservability(observability), []);
  assert.deepEqual(validateObservability({ rows: [{ failure: "f" }] }).slice(0, 2),
    ["observability.rows[0].signal is required", "observability.rows[0].sli is required"]);
  const obs = renderObservability(observability);
  assert.match(obs, /\*\*Correlation:\*\* request_id/);
  assert.match(obs, /\| provider timeout \| payment.timeout log \| success rate \| 99.5% \/ 30d \|/);
  assert.match(obs, /- searches per tenant per day/);
  assert.match(obs, /PII-in-telemetry check/);

  const plan = [{ measure: "search adoption", event: "search_submitted",
    properties: ["tenant_id", "result_count"], owner: "growth" }];
  assert.deepEqual(validateTrackingPlan(plan), []);
  assert.deepEqual(validateTrackingPlan([{ measure: "m", event: "e", owner: "o" }]),
    ["trackingPlan[0].properties is required"]);
  assert.match(renderTrackingPlan(plan), /\| search adoption \| search_submitted \| tenant_id, result_count \| — \| growth \| — \|/);

  assert.deepEqual(validateCapacity({ load: "100 rps" }),
    ["capacity.exhaustsAt is required", "capacity.cost is required"]);
  const cap = renderCapacity({ load: "100 rps", exhaustsAt: "pool of 50 connections", cost: "$40/mo" });
  assert.match(cap, /\| Expected load \| 100 rps \|/);
  assert.match(cap, /\| Exhausts at \| pool of 50 connections \|/);
});

test("Thai labels when language is th", () => {
  assert.match(renderThreatModel(threatModel, { language: "th" }), /\*\*ทรัพย์สินและประเภทข้อมูล:\*\*/);
  assert.match(renderThreatModel(threatModel, { language: "th" }), /ความเสี่ยงคงเหลือ/);
  assert.match(renderNfr(nfr, { language: "th" }), /\| ID \| คุณลักษณะ \| เหตุกระตุ้น \|/);
  assert.match(renderObservability(observability, { language: "th" }), /รูปแบบความล้มเหลว/);
  assert.match(renderCapacity({ load: "x", exhaustsAt: "y", cost: "z" }, { language: "th" }), /ต้นทุน/);
});

test("empty values render as empty strings and raise no issues", () => {
  for (const [key, field] of Object.entries(QUALITY_FIELDS)) {
    for (const empty of [undefined, null, key === "nfr" || key === "trackingPlan" ? [] : {}]) {
      assert.equal(field.render(empty, { language: "en" }), "", `${key} renders ""`);
    }
    assert.deepEqual(field.validate(undefined), [], `${key} absent is valid`);
  }
  assert.deepEqual(Object.keys(QUALITY_FIELDS),
    ["nfr", "threatModel", "observability", "trackingPlan", "capacity"]);
});

test("groundingFromQuality passes the existing grounding v2 validator", () => {
  const derived = groundingFromQuality({ nfr, observability });
  assert.deepEqual(Object.keys(derived.nfrAssessment), Object.keys(NFR_CATEGORY_CAPABILITIES));
  assert.equal(derived.nfrAssessment.performance.status, "applicable");
  assert.deepEqual(derived.nfrAssessment.performance.claimIds, ["claim-a"]);
  assert.match(derived.nfrAssessment.performance.target, /p95 <= 250 ms/);
  assert.equal(derived.nfrAssessment.availability.status, "not-applicable");
  assert.equal(derived.observability.status, "applicable");
  assert.equal(derived.observability.rows[0].correlation, "request_id");

  const empty = groundingFromQuality({});
  assert.equal(empty.observability.status, "not-applicable");
  assert.ok(Object.values(empty.nfrAssessment).every((row) => row.status === "not-applicable"));

  const fixture = mkdtempSync(join(tmpdir(), "foundation-quality-fields-"));
  try {
    const packet = join(fixture, "change");
    mkdirSync(packet, { recursive: true });
    mkdirSync(join(fixture, "specs"), { recursive: true });
    writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
    writeFileSync(join(fixture, "production.mjs"), "export const behavior = true;\n");
    writeFileSync(join(fixture, "production.test.mjs"), "// test topology\n");
    writeFileSync(join(fixture, "specs", "behavior.md"), "#### Scenario: Fast search\n");
    const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const state = { id: "change-a", groundingRequired: true, status: "change", groundingVersion: 2,
      intent: "Keep p95 search latency within the performance budget", impact: "medium",
      coupling: "isolated", nfrAssessmentRequired: true };
    const contract = { claims: [{ id: "claim-a", scenario: "p95 latency stays below 250 ms",
      impact: "medium", capabilities: ["test", "review", "performance"] }] };
    const providers = { test: { capability: "test", criticalCases: ["CASE-ENTRY"] }, performance: { capability: "performance" } };
    const runtime = createChangeValidationRuntime({
      root: fixture, activeChangePath: () => packet, changePath: () => packet,
      walk: (_dir, visit) => visit(join(fixture, "specs", "behavior.md")),
      loadRuntime: () => state, saveRuntime: () => {},
      evidence: () => ({ ...contract, providers }),
      selectedRepositories: () => [{ id: "root", workspacePath: fixture }],
      providerCapability: (provider, config) => config?.capability || provider,
      providerConfig: () => null,
      resolvedAcceptance: () => ({ required: false, claimIds: [] }),
      reviewPolicy: () => ({ required: false, tier: "medium" }),
      policyCapabilities: () => [], policyCapabilityTrigger: () => null,
      changedSurfaceResolvable: () => false, forecastCapabilities: () => ({ capabilities: [] }),
      rawExecution: () => ({ providers }), commandExists: () => true,
      stableHash, fileDigest: digest,
      pathInside: (base, path) => path === base || path.startsWith(`${base}/`),
      knownProviders: new Set(), writeJson: () => {},
      now: () => "2026-10-15T00:00:00Z",
      fail: (message) => { throw new Error(message); },
    });
    const notApplicable = (sourceReason, list, extra = {}) =>
      ({ status: "not-applicable", sourceReason, [list]: [], ...extra });
    const grounding = {
      version: 2,
      decisionBatch: { status: "locked", source: "user-batch", reference: "decision:1",
        mode: "single-batch", lockedAt: "2026-10-15T00:00:00Z",
        decisions: [{ id: "d1", question: "budget?", answer: "250 ms", source: "user-batch" }] },
      risk: { tier: "medium", classes: ["performance"], rationale: "latency budget" },
      productionEntry: { status: "applicable", sourceReason: "runtime entry",
        paths: [{ repository: "root", path: "production.mjs" }] },
      realWire: notApplicable("local function", "contracts"),
      activationSemantics: notApplicable("no dormant path", "activatedPaths",
        { failureSemanticChanges: [] }),
      serviceInteractions: notApplicable("single process", "rows"),
      ...derived,
      semanticInvariants: [],
      readSet: [
        { repository: "root", path: "requirement.md", role: "requirement", mode: "full",
          sha256: digest(join(fixture, "requirement.md")) },
        { repository: "root", path: "production.mjs", role: "production-path", mode: "full",
          sha256: digest(join(fixture, "production.mjs")) },
        { repository: "root", path: "production.test.mjs", role: "test-topology", mode: "full",
          sha256: digest(join(fixture, "production.test.mjs")) },
      ],
      claims: [{ id: "claim-a", productionPath: [{ repository: "root", path: "production.mjs" }],
        failurePaths: [{ repository: "root", path: "production.mjs", failure: "slow branch" }],
        evidenceClass: ["test", "review"], testDoubleGap: "none" }],
      criticalCases: [{ id: "CASE-ENTRY", claimIds: ["claim-a"], oracle: "production-entry" }], mutants: [], derivedFacts: [],
    };
    writeFileSync(join(packet, "grounding.yaml"), `${JSON.stringify(grounding, null, 2)}\n`);
    const tasks = [{ id: "T001", done: false,
      text: "Implement the latency budget [claims:claim-a] [paths:production.mjs]" }];
    const value = runtime.groundingValue("change-a", state, packet, tasks).value;
    assert.equal(value.nfrAssessment.performance.status, "applicable");
    assert.equal(value.observability.rows[0].interactionId, "local");

    // The same validator rejects a derived row whose claim is missing.
    const unclaimed = groundingFromQuality({ nfr: [{ ...nfr[0], claim: undefined }], observability });
    writeFileSync(join(packet, "grounding.yaml"),
      `${JSON.stringify({ ...grounding, ...unclaimed }, null, 2)}\n`);
    assert.throws(() => runtime.groundingValue("change-a", state, packet, tasks),
      /performance.claimIds must be non-empty/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
