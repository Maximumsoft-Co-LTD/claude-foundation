import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";
import {
  agreementIdentity, assertSpecApproval, carryApprovalAcrossBookkeeping, currentWaivers,
  laneApproved
} from "../runtime/core/user-decisions.mjs";
import { leaseAuthorityIsStale, leaseContractChanged, sameLeaseRenewalAuthority }
  from "../runtime/workflow/lease-runtime.mjs";
import { approvedDecisionRevision } from "../runtime/evidence/receipt-runtime.mjs";
import { workspaceCapabilityValue } from "../runtime/core/execution-contract.mjs";

function packet(root, id, files) {
  const dir = join(root, "openspec", "changes", id);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function approvedState(root, id, extra = {}) {
  return {
    id, status: "building", contractRevision: 1,
    specApproval: { required: true, identity: agreementIdentity(root, id), revision: 1,
      decisionRef: "D-approve", approvedAt: "2026-10-27T00:00:00.000Z",
      lanes: { qa: { identity: agreementIdentity(root, id), revision: 1, decisionRef: "qa-ok" } } },
    waivers: [{ capability: "review", decisionRef: "W1",
      binding: { workspaceHash: "ws", contractRevision: 1 } }],
    draftSource: { draft: { version: 5 }, contractRevision: 1 },
    ...extra
  };
}

// Scenario: reopen grounding moves the revision; the same packet bytes keep
// consent, lanes, waivers, and the compiled draft, with an audit row.
test("bookkeeping carries consent, lanes, waivers, and the draft to the new revision", (t) => {
  const root = mkdtempSync(join(tmpdir(), "authority-carry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  packet(root, "demo", { "proposal.md": "## Why\n\nSame bytes.\n" });
  const state = approvedState(root, "demo");
  state.contractRevision = 2;
  assert.equal(carryApprovalAcrossBookkeeping(root, "demo", state, "grounding-reopen: D2",
    () => "2026-10-28T00:00:00.000Z"), true);
  assert.equal(state.specApproval.revision, 2);
  assert.equal(state.specApproval.lanes.qa.revision, 2);
  assert.deepEqual(state.specApproval.carriedFrom,
    { revision: 1, reason: "grounding-reopen: D2", carriedAt: "2026-10-28T00:00:00.000Z" });
  assert.deepEqual(state.approvalCarries.map((row) => [row.fromRevision, row.toRevision]), [[1, 2]]);
  assert.equal(state.waivers[0].binding.contractRevision, 2);
  assert.equal(currentWaivers(state, "ws").length, 1);
  assert.equal(state.draftSource.contractRevision, 2);
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  assert.equal(laneApproved(root, "demo", state, "qa"), true);
  assert.equal(workspaceCapabilityValue("demo", state).mode, "isolated-workspace");
  assert.ok(approvedDecisionRevision(state, "fp"), "a carried approval is a decision revision");
  // Idempotent: nothing to carry once revisions agree.
  assert.equal(carryApprovalAcrossBookkeeping(root, "demo", state, "again"), false);
});

// Scenario: the packet content changed (grounding answers rewrote it); the
// old consent does not follow, and the waiver bound to the old contract expires.
test("changed packet content is not carried and asks again", (t) => {
  const root = mkdtempSync(join(tmpdir(), "authority-changed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = packet(root, "demo", { "proposal.md": "## Why\n\nFirst.\n" });
  const state = approvedState(root, "demo");
  writeFileSync(join(dir, "proposal.md"), "## Why\n\nRewritten by the reopened ledger.\n");
  state.contractRevision = 2;
  assert.equal(carryApprovalAcrossBookkeeping(root, "demo", state, "grounding-reopen"), false);
  assert.equal(state.specApproval.revision, 1);
  assert.equal(currentWaivers(state, "ws").length, 0);
  assert.throws(() => assertSpecApproval(root, "demo", state),
    (error) => error.code === "SPEC_APPROVAL_REQUIRED");
  assert.equal(laneApproved(root, "demo", state, "qa"), false);
});

// Scenario: consent and lanes are judged by identity even when the revision
// counter already differs (a state written before carry existed).
test("approval and lanes follow the packet bytes, not the revision counter", (t) => {
  const root = mkdtempSync(join(tmpdir(), "authority-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  packet(root, "demo", { "proposal.md": "## Why\n\nSame bytes.\n" });
  const state = approvedState(root, "demo", { contractRevision: 3 });
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  assert.equal(laneApproved(root, "demo", state, "qa"), true);
});

// Scenario: a task lease stays valid while the contract fingerprint is
// unchanged; a lease without a fingerprint (3.6.8) still compares revisions.
test("task lease authority binds the contract fingerprint", () => {
  const plan = { graphRevision: 1, graphIdentity: "g", contractRevision: 2, contractFingerprint: "fp" };
  const lease = { graphRevision: 1, graphIdentity: "g", contractRevision: 1, contractFingerprint: "fp" };
  assert.equal(leaseContractChanged(plan, lease), false);
  assert.equal(leaseAuthorityIsStale(plan, lease), false);
  assert.equal(leaseContractChanged(plan, { ...lease, contractFingerprint: "other" }), true);
  assert.equal(leaseAuthorityIsStale(plan, { ...lease, contractFingerprint: "other" }), true);
  const legacy = { graphRevision: 1, graphIdentity: "g", contractRevision: 1 };
  assert.equal(leaseAuthorityIsStale(plan, legacy), true);
  assert.equal(leaseAuthorityIsStale({ ...plan, contractRevision: 1 }, legacy), false);
  assert.equal(sameLeaseRenewalAuthority([], [], { owner: "a", graphRevision: 1, graphIdentity: "g",
    contractRevision: 1, contractFingerprint: "fp" }, "a", plan), true);
});

// Lifecycle route: `change resolve --reopen-grounding` carries the approval
// it would otherwise have invalidated.
test("reopen-grounding carries an approval given on the same packet", (t) => {
  const root = mkdtempSync(join(tmpdir(), "authority-reopen-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "demo";
  const dir = packet(root, id, { "proposal.md": "## Why\n\nSame bytes.\n" });
  const statePath = join(root, ".foundation", "runtime", `${id}.json`);
  mkdirSync(join(root, ".foundation", "runtime"), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    ...approvedState(root, id, { status: "change" }),
    groundingDigest: "locked", groundingLockedAt: "then"
  }));
  const loadRuntime = () => JSON.parse(readFileSync(statePath, "utf8"));
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: {}, land: {} }), fail: (message) => { throw new Error(message); },
    securityTerms: [], pathInside: () => true, readJson: () => ({}), writeJson: () => {},
    slugify: (value) => String(value).toLowerCase().replaceAll(" ", "-"),
    loadRuntime, saveRuntime: (value) => writeFileSync(statePath, JSON.stringify(value)),
    setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
    preexistingDirty: () => [], bindClaudeSession: () => {}, createSandbox: () => {},
    showPacket: () => {}, validate: () => {}, now: () => "2026-10-28T00:00:00.000Z",
    changePath: () => dir, activeChangePath: () => dir,
    approvalLanes: () => ({ configured: [], required: [] })
  });
  const log = console.log;
  console.log = () => {};
  try {
    lifecycle.resolveChange(id, { "reopen-grounding": true, "decision-ref": "D2", "reopen-reason": "revise" });
  } finally { console.log = log; }
  const state = loadRuntime();
  assert.equal(state.contractRevision, 2);
  assert.equal(state.specApproval.revision, 2);
  assert.equal(state.specApproval.carriedFrom.reason, "grounding-reopen: revise");
  assert.doesNotThrow(() => assertSpecApproval(root, id, state));
});
