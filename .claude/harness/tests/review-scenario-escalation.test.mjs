import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  configuredReviewPrompt, createConfiguredReviewerRuntime, scenarioCoverageFindings
} from "../runtime/evidence/configured-reviewer.mjs";
import { createReviewAttemptStore } from "../runtime/evidence/review-attempt-store.mjs";
import { parseScenarioCoverage } from "../runtime/evidence/review-diff.mjs";
import { createAuthorityStore } from "../runtime/workflow/authority.mjs";
import { createAuthorityRuntime } from "../runtime/workflow/authority-runtime.mjs";

// N8 part B: the scenario checklist is bound into the review packet, the
// prompt asks for per-scenario coverage, and a fast-tier round with a gap is
// re-run once on the configured model inside the same dispatch and wave.

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const now = () => "2026-10-01T00:00:00.000Z";
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return fallback; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const quiet = (operation) => {
  const log = console.log;
  console.log = () => {};
  try { return operation(); } finally { console.log = log; }
};
const quietAsync = async (operation) => {
  const log = console.log;
  console.log = () => {};
  try { return await operation(); } finally { console.log = log; }
};

const SPEC = `# Export

## ADDED Requirements

### Requirement: CSV export

#### Scenario: Export all rows

- **WHEN** the user clicks export
- **THEN** a CSV downloads

#### Scenario: Empty table

- **WHEN** the table is empty
- **THEN** export is disabled
`;

function harness(t, { tier = "low" } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-scenario-escalation-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const contract = join(fixture, "contract");
  mkdirSync(join(contract, "specs", "export"), { recursive: true });
  writeFileSync(join(contract, "specs", "export", "spec.md"), SPEC);
  writeFileSync(join(contract, "evidence.yaml"), JSON.stringify({ version: 2, claims: [
    { id: "claim-export", requirementKey: "csv-export", scenario: "Export all rows" }] }));
  writeFileSync(join(fixture, "app.txt"), "one\ntwo\n");
  let state = { version: 2, changeId: "change-a", reviewHistory: null };
  const calls = [];
  const results = [];
  const attemptStore = createReviewAttemptStore({
    receiptsRoot: join(fixture, "receipts"), evidenceVault: join(fixture, "evidence"),
    readJson, writeJson, loadRuntime: () => state, saveRuntime: (next) => { state = next; },
    stableHash, reviewReceiptBinding: stableHash, now,
    blockWithDecision: (_id, kind) => { throw new Error(kind); }, fail
  });
  const authorityStore = createAuthorityStore({
    root: join(fixture, "authority"), protocolVersion: "1", readJson, writeJson, now
  });
  const reviewerConfig = (name, modelTier = null) => ({
    identity: name || "claude-opus", providerFamily: "anthropic", modelFamily: "Claude",
    modelId: modelTier === "fast" ? "haiku" : "opus",
    ...(modelTier === "fast" ? { modelTier } : {})
  });
  const runConfiguredReview = (args) => {
    calls.push(args);
    const config = reviewerConfig(args.reviewer, args.modelTier);
    const next = results.shift() || { status: "pass", findings: [], scenarioCoverage: null };
    const report = {
      changeId: args.changeId,
      status: next.status, summary: `${config.modelId} review`, findings: next.findings,
      verifiedFindingIds: [],
      reportReference: `.foundation/reviews/${args.changeId}/report-${calls.length}.json`,
      ...(next.scenarioCoverage !== undefined ? { scenarioCoverage: next.scenarioCoverage } : {}),
      ...(args.escalatedFrom ? { escalatedFrom: args.escalatedFrom } : {}),
      reviewer: { identity: config.identity, providerFamily: config.providerFamily,
        modelFamily: config.modelFamily, modelId: config.modelId,
        sessionId: `session-${calls.length}` }
    };
    report.reportPath = join(fixture, report.reportReference);
    writeJson(report.reportPath, report);
    return report;
  };
  let packetSequence = 0;
  const authority = createAuthorityRuntime({
    root: fixture, protocolVersion: "1", ciEvidenceProtocolVersion: "1", authorityStore,
    requiredProviders: () => ["review"], providerCapability: () => "review",
    providerConfig: () => ({ capability: "review", adapter: "external" }),
    reviewPacketValue: () => {
      packetSequence += 1;
      return {
        version: 6, contractWorkspacePath: contract,
        claims: [{ id: "claim-export", scenario: "Export all rows" }],
        changedSurface: {
          manifest: [
            { repositoryId: "root", path: "app.txt", relativePath: "app.txt",
              workspacePath: fixture, kind: "code", identity: "app-v1" },
            { repositoryId: "contract", path: "specs/export/spec.md",
              relativePath: "specs/export/spec.md", workspacePath: contract,
              kind: "contract-artifact", identity: "spec-v1" }
          ],
          inspection: [
            { repositoryId: "root", workspacePath: fixture, baseHead: "head", paths: ["app.txt"] },
            { repositoryId: "contract", workspacePath: contract, baseHead: null,
              paths: ["specs/export/spec.md"] }
          ]
        },
        sequence: packetSequence
      };
    },
    loadRuntime: () => state, saveRuntime: (next) => { state = next; },
    evidence: () => ({ claims: [{ id: "claim-export" }] }),
    resolvedAcceptance: () => ({ required: false }), relevantHash: () => "workspace-a",
    validate: () => {}, pendingTasks: () => [], claimsForProvider: () => [{ id: "claim-export" }],
    stableHash, now,
    reviewPolicy: () => ({ independence: "required", diversity: "single-model", tier,
      maxAiAttempts: tier === "low" ? 1 : 2 }),
    readJson, expandList: (value) => value, listCount: (value) => value.length,
    dispatchReviewAttempt: attemptStore.dispatchReviewAttempt,
    completeReviewAttempt: attemptStore.completeReviewAttempt,
    reviewHistoryState: attemptStore.reviewHistoryState,
    reviewAttempts: attemptStore.reviewAttempts,
    deliveredAiAttempts: attemptStore.deliveredAiAttempts,
    reviewAttemptByDigest: attemptStore.reviewAttemptByDigest,
    assertReviewDispatchAllowed: attemptStore.assertReviewDispatchAllowed,
    foundationPolicy: () => ({ workflow: { reviewCircuit: "full-delta" },
      review: { defaultReviewer: "claude-opus", diversity: "single-model",
        independence: "required" } }),
    reviewerConfig, runConfiguredReview,
    runConfiguredReviewAsync: async (args) => runConfiguredReview(args),
    reviewerStatus: () => ({ ok: true }), writeJson,
    receiptPath: (id) => join(fixture, `${id}-receipt.json`),
    recordReceipt: (id, _provider, status, flags) => writeJson(
      join(fixture, `${id}-receipt.json`), { status, review: { attemptDigest: flags["review-attempt"] } }),
    receiptValidity: () => ({ validity: "valid" }), fileDigest: () => "digest",
    providerWorkspaceHash: () => "workspace-a", providerRepository: () => null,
    providerWorkspace: () => fixture, gitHead: () => "head",
    validateSignedCiEnvelope: () => ({ valid: false }), providerClaims: () => ["claim-export"],
    fail,
    reviewDiffContext: {
      git: () => { throw new Error("no git in fixture"); },
      pathExists: () => true, readFile: readFileSync, readDirectory: readdirSync,
      isDirectory: (path) => lstatSync(path).isDirectory()
    }
  });
  const request = () => quiet(() => authority.requestAuthority("change-a", { type: "review" }));
  const entry = (requestId) => authorityStore.list("change-a")
    .find((row) => row.value.requestId === requestId).value;
  return {
    authority, attemptStore, calls, results, request, entry,
    history: () => state.reviewHistory,
    delivered: () => attemptStore.deliveredAiAttempts("change-a"),
    flags: (requestId) => ({ request: requestId, "subject-actor": "human-implementer" })
  };
}

const covered = (status = "covered-by-test") => ({
  items: [], missing: [], unsure: [], ...(status === "missing"
    ? { missing: ["claim-export"] } : status === "unsure" ? { unsure: ["csv-export-s2"] } : {})
});

test("checklist is bound into the dispatched packet digest and the prompt", (t) => {
  const h = harness(t);
  const { requestId } = h.request();
  h.results.push({ status: "pass", findings: [], scenarioCoverage: covered() });
  quiet(() => h.authority.runAuthorityReviewer("change-a", h.flags(requestId)));
  const packet = h.calls[0].packet;
  assert.deepEqual(packet.scenarioChecklist.items.map((item) => item.id),
    ["claim-export", "csv-export-s2"], "claim id when bound, requirement slug otherwise");
  assert.equal(packet.scenarioChecklist.source, "specs");
  const { packetDigest, ...unsigned } = packet;
  assert.equal(packetDigest, stableHash(unsigned), "checklist is inside the packet digest");
  assert.equal(h.entry(requestId).packetDigest, packetDigest);
  const prompt = configuredReviewPrompt(packet);
  assert.match(prompt, /SCENARIO COVERAGE CHECKLIST/);
  assert.match(prompt, /- claim-export: \[CSV export\] Export all rows/);
  assert.match(prompt, /- csv-export-s2: \[CSV export\] Empty table/);
  assert.match(configuredReviewPrompt({ ...packet, reviewDepth: "diff-first" }),
    /SCENARIO COVERAGE CHECKLIST/);
  assert.doesNotMatch(configuredReviewPrompt({ ...packet, scenarioChecklist: undefined }),
    /SCENARIO COVERAGE CHECKLIST/);
});

test("fast round fully covered does not escalate", (t) => {
  const h = harness(t);
  const { requestId } = h.request();
  h.results.push({ status: "pass", findings: [], scenarioCoverage: covered() });
  const report = quiet(() => h.authority.runAuthorityReviewer("change-a", h.flags(requestId)));
  assert.equal(report.status, "pass");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].modelTier, "fast");
  assert.equal(h.entry(requestId).dispatch.reviewer.modelId, "haiku");
  assert.equal(h.entry(requestId).dispatch.modelEscalation, undefined);
});

test("fast round with a missing scenario escalates once without consuming a wave", (t) => {
  const h = harness(t);
  const { requestId } = h.request();
  h.results.push({ status: "fail", findings: [], scenarioCoverage: covered("missing") },
    { status: "pass", findings: [], scenarioCoverage: covered() });
  const report = quiet(() => h.authority.runAuthorityReviewer("change-a", h.flags(requestId)));
  assert.equal(h.calls.length, 2, "exactly one escalation");
  assert.equal(h.calls[0].modelTier, "fast");
  assert.equal(h.calls[1].modelTier, "configured");
  assert.equal(h.calls[1].escalatedFrom, "fast");
  assert.equal(h.calls[1].packet, h.calls[0].packet, "same dispatched packet");
  assert.equal(report.status, "pass", "the configured result is final");
  assert.equal(h.history().aiAttempts, 1, "no second AI dispatch");
  assert.equal(h.history().totalAttempts, 1);
  assert.equal(h.delivered().length, 1, "one delivered AI wave");
  const attempt = h.delivered()[0];
  assert.equal(attempt.reviewerModelId, "opus", "attempt binds the model actually final");
  assert.equal(attempt.modelEscalation.escalatedFrom, "fast");
  assert.equal(attempt.modelEscalation.fastModelId, "haiku");
  assert.equal(attempt.modelEscalation.reason, "scenario-coverage-gap");
  const dispatch = h.entry(requestId).dispatch;
  assert.equal(dispatch.reviewer.modelId, "opus");
  assert.equal(dispatch.reviewer.modelFamily, "claude");
  assert.equal(dispatch.modelEscalation.escalatedFrom, "fast");
  const checkpoint = h.entry(requestId).configuredResult;
  assert.equal(checkpoint.reportReference, ".foundation/reviews/change-a/report-2.json",
    "only the final configured report is checkpointed");
  assert.equal(checkpoint.modelEscalation.modelId, "opus",
    "recovery can rebind the escalated model");
});

test("unparseable coverage escalates; configured unsure alone does not escalate again", (t) => {
  const h = harness(t);
  const { requestId } = h.request();
  h.results.push({ status: "pass", findings: [], scenarioCoverage: null },
    { status: "pass", findings: [], scenarioCoverage: covered("unsure") });
  const report = quiet(() => h.authority.runAuthorityReviewer("change-a", h.flags(requestId)));
  assert.equal(h.calls.length, 2);
  assert.equal(report.status, "pass");
  assert.equal(h.delivered()[0].modelEscalation.reason, "scenario-coverage-unparseable");
});

test("configured-tier (medium) rounds never escalate", (t) => {
  const h = harness(t, { tier: "medium" });
  const { requestId } = h.request();
  h.results.push({ status: "pass", findings: [], scenarioCoverage: covered("unsure") });
  quiet(() => h.authority.runAuthorityReviewer("change-a", h.flags(requestId)));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].modelTier, null);
});

test("async concurrent review path escalates too", async (t) => {
  const h = harness(t);
  const { requestId } = h.request();
  h.results.push({ status: "pass", findings: [], scenarioCoverage: covered("unsure") },
    { status: "pass", findings: [], scenarioCoverage: covered() });
  const report = await quietAsync(() =>
    h.authority.runAuthorityReviewerAsync("change-a", h.flags(requestId)));
  assert.equal(report.status, "pass");
  assert.deepEqual(h.calls.map((call) => call.modelTier), ["fast", "configured"]);
  assert.equal(h.history().aiAttempts, 1);
  assert.equal(h.delivered()[0].reviewerModelId, "opus");
});

test("configured runtime: a missing scenario becomes a finding bound to its id", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-scenario-finding-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contract = join(root, "contract");
  mkdirSync(join(contract, "specs", "export"), { recursive: true });
  writeFileSync(join(contract, "specs", "export", "spec.md"), SPEC);
  writeFileSync(join(root, "app.txt"), "one\n");
  const packet = {
    reviewDepth: "diff-first",
    claims: [{ id: "claim-export" }],
    scenarioChecklist: { source: "specs", truncated: false, items: [
      { id: "claim-export", requirement: "CSV export", scenario: "Export all rows" },
      { id: "csv-export-s2", requirement: "CSV export", scenario: "Empty table" }] },
    reviewScope: { mode: "full", paths: ["root/app.txt", "contract/specs/export/spec.md"] },
    changedSurface: {
      inspection: [{ repositoryId: "root", workspacePath: root },
        { repositoryId: "contract", workspacePath: contract }],
      manifest: []
    }
  };
  const review = {
    status: "pass", summary: "looks fine", findings: [], verifiedFindingIds: [],
    scenarioCoverage: [
      { id: "claim-export", status: "missing", evidence: null },
      { id: "csv-export-s2", status: "covered-by-test", evidence: "app.txt:1" }]
  };
  const envelope = JSON.stringify({ type: "result", subtype: "success", session_id: "fresh",
    structured_output: review });
  const runtime = createConfiguredReviewerRuntime({
    root, now,
    foundationPolicy: () => ({ review: { defaultReviewer: "claude-opus", reviewers: {
      "claude-opus": { adapter: "claude-cli", executable: "claude", modelId: "opus",
        providerFamily: "anthropic", modelFamily: "claude", reasoningEffort: "high",
        sandbox: "read-only", ephemeral: true } } } }),
    commandExists: () => true, fail,
    spawn: (_command, args) => args.includes("auth")
      ? { status: 0, stdout: JSON.stringify({ loggedIn: true }) }
      : args.includes("--help")
        ? { status: 0, stdout: "--print --output-format --json-schema --model --effort " +
          "--permission-mode --tools --safe-mode --session-id --no-session-persistence" }
        : { status: 0, stdout: envelope }
  });
  const report = runtime.runReview({ changeId: "change-a", workspace: root, packet,
    modelTier: "configured", escalatedFrom: "fast" });
  assert.equal(report.status, "fail", "a missing scenario blocks");
  assert.deepEqual(report.findings.map((finding) => [finding.id, finding.severity,
    finding.path, finding.claimIds]),
  [["scenario-missing-claim-export", "major", "contract/specs/export/spec.md", ["claim-export"]]]);
  assert.deepEqual(report.scenarioCoverage.missing, ["claim-export"]);
  assert.equal(report.escalatedFrom, "fast", "the durable report records the escalation");
  const durable = JSON.parse(readFileSync(report.reportPath, "utf8"));
  assert.equal(durable.reviewer.modelId, "opus");

  const bound = { ...review, findings: [{ id: "F1", severity: "major", path: "app.txt",
    line: 1, message: "export missing", claimIds: ["claim-export"], verificationCaseIds: [] }] };
  assert.deepEqual(scenarioCoverageFindings(bound, packet,
    parseScenarioCoverage(bound, { expectedIds: ["claim-export", "csv-export-s2"] })), [],
    "a reviewer finding already bound to the id is not duplicated");
});
