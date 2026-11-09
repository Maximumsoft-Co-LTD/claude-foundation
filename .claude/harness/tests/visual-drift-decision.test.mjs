import assert from "node:assert/strict";
import test from "node:test";

import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import {
  recordVisualDriftWaiver, requiredProvidersOperation
} from "../runtime/workflow/change-validation.mjs";
import { gateDigest } from "../runtime/core/convergent-gate.mjs";
import { proofPreflightAdvisory } from "../runtime/evidence/proof-readiness.mjs";
import { providerCapability } from "../runtime/evidence/provider-catalog.mjs";
import {
  visualDriftDecision, visualProviderConfig, visualWaiverSummary
} from "../runtime/evidence/visual-review.mjs";

const difference = { id: "V1", screen: "settings", difference: "Save sits in the header",
  severity: "major", claimIds: ["C-a"] };
const drift = { provider: "visual", findings: [difference], rounds: 2, workspaceHash: "h3",
  recordedAt: "t" };

// advance over a proof that reports pending visual drift until answered.
function fixture() {
  let stored = { id: "demo", status: "building", contractRevision: 1,
    visualRepair: { rounds: 2, lastBatchWorkspaceHash: "h2", drift } };
  const results = [];
  const options = {
    loadRuntime: () => structuredClone(stored),
    saveRuntime: (state) => { stored = structuredClone(state); },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "ui-1",
    stableHash: gateDigest,
    deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "unused",
    output: () => {},
    runProof: async () => {
      const result = results.shift();
      if (result) return result(stored);
      return stored.visualRepair?.drift ? {
        status: "NEEDS_USER_DECISION", route: "VISUAL_DRIFT_DECISION", stage: "visual-drift",
        decision: visualDriftDecision("demo", stored.visualRepair.drift),
        next: [{ kind: "visual-drift", reason: "visual drift" }]
      } : { status: "ACTION_REQUIRED", next: [{ reason: "repair the visual batch" }] };
    }
  };
  return {
    runtime: () => createAdvanceRuntime(options),
    state: () => structuredClone(stored),
    queue: (result) => results.push(result)
  };
}

const answer = (asked, decision, extra = {}) => ({
  decision, "decision-fingerprint": asked.decision.fingerprint,
  "decision-ref": `user:${decision}`, reason: "The header placement is intended", ...extra
});

test("pending visual drift is one user question with repair, accept, and amend", async () => {
  const f = fixture();
  const asked = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.decision.kind, "visual-drift");
  assert.deepEqual(asked.decision.options.map((row) => row.id),
    ["repair-more", "accept", "amend-agreement", "pause"]);
  assert.equal(asked.decision.recommended, "repair-more");
  assert.match(asked.decision.summary, /settings: Save sits in the header \[major\]/);
  assert.equal((await f.runtime().advanceThrough("demo", "proven")).decision.fingerprint,
    asked.decision.fingerprint, "the same question stays pending until answered");
});

test("the user accepts the differences: a visual waiver keeps them and reads as an accepted mismatch", async () => {
  const f = fixture();
  const asked = await f.runtime().advanceThrough("demo", "proven");
  f.queue((state) => {
    assert.equal(state.visualRepair.drift, null);
    return { status: "ACTION_REQUIRED", next: [{ reason: "continue" }] };
  });
  await f.runtime().showAdvance("demo", answer(asked, "accept"));
  const [waiver] = f.state().waivers;
  assert.equal(waiver.capability, "visual");
  assert.equal(waiver.reason, "The header placement is intended");
  assert.deepEqual(waiver.authority, { kind: "host-user-decision", reference: "user:accept" });
  assert.deepEqual(waiver.acceptedFindings, [difference]);
  assert.deepEqual(waiver.binding, { workspaceHash: "ui-1", contractRevision: 1 });

  const land = visualWaiverSummary(waiver);
  assert.equal(land, "visual: mismatch accepted by user (user:accept): 1 difference(s)");
  const advisory = proofPreflightAdvisory({ capability: "visual", reason: "user-waived",
    detail: waiver.reason, authority: waiver.authority, acceptedFindings: waiver.acceptedFindings });
  assert.match(advisory, /WAIVED visual: mismatch accepted by user \(user:accept\): 1 difference/);
  assert.match(advisory, /not a pass/);
  assert.doesNotMatch(advisory, /visual pass/);
});

test("the user asks for more repair: two more rounds are granted and repair resumes", async () => {
  const f = fixture();
  const asked = await f.runtime().advanceThrough("demo", "proven");
  const resumed = await f.runtime().showAdvance("demo", answer(asked, "repair-more"));
  const state = f.state();
  assert.equal(state.visualRepair.drift, null);
  assert.deepEqual(state.visualRepair.grants.map((row) => [row.rounds, row.decisionRef]),
    [[2, "user:repair-more"]]);
  assert.equal(resumed.action, "REPAIR");
  assert.equal(state.waivers, undefined);
});

test("the user amends the agreement: advance routes to change amend and visual is bound to the new agreement", async () => {
  const f = fixture();
  const asked = await f.runtime().advanceThrough("demo", "proven");
  const routed = await f.runtime().showAdvance("demo", answer(asked, "amend-agreement"));
  assert.equal(routed.action, "EDIT");
  assert.equal(routed.legacyAction, "AMEND_AGREEMENT");
  assert.match(routed.command, /^claude-foundation change amend demo /);
  // The visual provider carries the bound prototype digest, so an amended
  // prototype changes its fingerprint and the old receipt no longer counts.
  const config = (sha256) => visualProviderConfig({ changeId: "demo", packetPath: "/p",
    packetRelative: "openspec/changes/demo", scriptPath: "/s",
    binding: { file: "prototype/a.html", sha256, claims: ["C-a"] } });
  assert.notDeepEqual(config("before").command, config("after").command);
});

test("accepting without a reason or decision reference is refused and records nothing", () => {
  let saved = 0;
  const context = {
    loadRuntime: () => ({ visualRepair: { drift } }),
    saveRuntime: () => { saved += 1; },
    relevantHash: () => "ui-1", now: () => "t",
    fail: (message) => { throw new Error(message); }
  };
  assert.throws(() => recordVisualDriftWaiver(context, "demo", { decisionRef: "user:1", reason: "" }),
    /requires a reason/);
  assert.throws(() => recordVisualDriftWaiver(context, "demo", { reason: "fine" }),
    /requires --decision-ref/);
  assert.equal(saved, 0);
});

test("a visual waiver goes stale when the UI changes, and visual is required again", () => {
  let hash = "ui-1";
  const state = { contractRevision: 1, waivers: [{ capability: "visual", reason: "ok",
    authority: { kind: "host-user-decision", reference: "user:accept" }, acceptedFindings: [difference],
    binding: { workspaceHash: "ui-1", contractRevision: 1 } }] };
  const required = () => requiredProvidersOperation({
    loadRuntime: () => state,
    evidence: () => ({ claims: [{ id: "C-a", capabilities: ["test", "visual"] }], providers: {} }),
    providerCapability,
    relevantHash: () => hash,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] })
  }, "demo");
  assert.ok(!required().includes("visual"));
  hash = "ui-2";
  assert.ok(required().includes("visual"));
});
