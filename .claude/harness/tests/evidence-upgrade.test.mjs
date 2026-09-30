import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agreementIdentity, assertSpecApproval, preserveSpecApprovalAcross
} from "../runtime/core/user-decisions.mjs";
import { upgradeEvidenceOperation } from "../runtime/evidence/proof-readiness.mjs";

function context({
  state = { status: "active", revision: 0, executionRevision: 0 },
  evidence = { version: 1 },
  execution,
  proofExists = false
} = {}) {
  const writes = new Map();
  const removed = [];
  const logs = [];
  let saved;
  const paths = {
    evidence: "/changes/change/evidence.yaml",
    execution: "/changes/change/execution.yaml",
    proof: "/proofs/change.json"
  };
  return {
    writes,
    removed,
    logs,
    saved: () => saved,
    operation: {
      loadRuntime: () => state,
      fail: (message) => { throw new Error(message); },
      changePath: () => "/changes/change",
      proofPath: () => paths.proof,
      readJson: (path) => path === paths.evidence ? evidence : execution,
      writeJson: (path, value) => writes.set(path, structuredClone(value)),
      saveRuntime: (value) => { saved = structuredClone(value); },
      pathExists: (path) => path === paths.execution ? execution !== undefined : proofExists,
      remove: (path) => removed.push(path),
      output: { log: (message) => logs.push(message) }
    }
  };
}

test("evidence upgrade rejects archived and unknown contracts", () => {
  assert.throws(() => upgradeEvidenceOperation(context({
    state: { status: "archived" }
  }).operation, "change"), /already archived/);
  assert.throws(() => upgradeEvidenceOperation(context({
    evidence: { version: 3 }
  }).operation, "change"), /unknown evidence version '3'/);
});

test("version one upgrade creates execution wiring and clears stale proof", () => {
  const harness = context({
    state: { status: "active" },
    evidence: { version: 1, providers: { test: { command: ["npm", "test"] } }, claims: [] },
    proofExists: true
  });

  upgradeEvidenceOperation(harness.operation, "change");

  assert.deepEqual(harness.writes.get("/changes/change/evidence.yaml"), {
    version: 2,
    claims: []
  });
  assert.deepEqual(harness.writes.get("/changes/change/execution.yaml"), {
    version: 1,
    providers: { test: { command: ["npm", "test"] } },
    services: {}
  });
  assert.deepEqual(harness.saved(), {
    status: "active",
    version: 2,
    revision: 1,
    executionRevision: 1
  });
  assert.deepEqual(harness.removed, ["/proofs/change.json"]);
  assert.match(harness.logs[0], /EVIDENCE change:[\s\S]*configure execution.yaml/);
});

test("version two upgrade preserves execution overrides and increments revisions", () => {
  const harness = context({
    state: { status: "active", revision: 4, executionRevision: 7 },
    evidence: {
      version: 2,
      providers: { test: { command: ["old"] }, review: { external: true } }
    },
    execution: {
      version: 1,
      providers: { test: { command: ["new"] } },
      services: { api: { command: ["serve"] } }
    }
  });

  upgradeEvidenceOperation(harness.operation, "change");

  assert.deepEqual(harness.writes.get("/changes/change/evidence.yaml"), { version: 2 });
  assert.deepEqual(harness.writes.get("/changes/change/execution.yaml"), {
    version: 1,
    providers: {
      test: { command: ["new"] },
      review: { external: true }
    },
    services: { api: { command: ["serve"] } }
  });
  assert.deepEqual(harness.saved(), {
    status: "active",
    version: 2,
    revision: 5,
    executionRevision: 8
  });
  assert.deepEqual(harness.removed, []);
});

function approvedPacket(t, { workspace = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-evidence-upgrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (base) => {
    const dir = join(base, "openspec", "changes", "change");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proposal.md"), "# Change\n");
    writeFileSync(join(dir, "tasks.md"), "- [ ] **T001** implement\n");
    writeFileSync(join(dir, "evidence.yaml"), JSON.stringify({
      version: 1, providers: { test: { command: ["npm", "test"] } }, claims: []
    }));
    return dir;
  };
  write(root);
  const sandbox = workspace ? join(root, "sandbox") : null;
  if (sandbox) write(sandbox);
  let state = {
    id: "change", status: "built", contractRevision: 2,
    ...(sandbox ? { workspace: { mode: "copy", path: sandbox } } : {}),
    specApproval: {
      required: true, revision: 2, decisionRef: "user:ok",
      identity: agreementIdentity(root, "change")
    }
  };
  const io = {
    loadRuntime: () => structuredClone(state),
    saveRuntime: (value) => { state = structuredClone(value); },
    now: () => "2026-09-30T00:00:00.000Z"
  };
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));
  const upgrade = (base) => upgradeEvidenceOperation({
    ...io, fail: (message) => { throw new Error(message); },
    changePath: (id) => join(base, "openspec", "changes", id),
    proofPath: () => join(root, "proof.json"),
    readJson, writeJson, output: { log: () => {} }
  }, "change");
  return {
    root, sandbox, io, upgrade, state: () => state,
    edit: (base) => writeFileSync(join(base, "openspec", "changes", "change", "proposal.md"),
      "# Change\n\nUnapproved scope.\n")
  };
}

test("evidence upgrade keeps spec approval that was valid before it", (t) => {
  const packet = approvedPacket(t);
  const before = packet.state().specApproval.identity;
  preserveSpecApprovalAcross(packet.root, "change", packet.io,
    () => packet.upgrade(packet.root), "evidence-upgrade");

  const state = packet.state();
  assert.notEqual(state.specApproval.identity, before, "wiring rewrite changed packet bytes");
  assert.doesNotThrow(() => assertSpecApproval(packet.root, "change", state));
  assert.equal(state.specApproval.decisionRef, "user:ok");
  assert.equal(state.approvalCarries.at(-1).reason, "evidence-upgrade");
  assert.deepEqual(state.approvalCarries.at(-1).delta, { added: [], revised: [], removed: [] });
});

test("evidence upgrade keeps approval when the isolated packet is upgraded too", (t) => {
  const packet = approvedPacket(t, { workspace: true });
  preserveSpecApprovalAcross(packet.root, "change", packet.io, () => {
    packet.upgrade(packet.root);
    packet.upgrade(packet.sandbox);
  }, "evidence-upgrade");
  assert.doesNotThrow(() => assertSpecApproval(packet.root, "change", packet.state()));
});

test("evidence upgrade never refreshes approval for an unapproved agreement edit", (t) => {
  const packet = approvedPacket(t);
  packet.edit(packet.root);
  preserveSpecApprovalAcross(packet.root, "change", packet.io,
    () => packet.upgrade(packet.root), "evidence-upgrade");
  assert.equal(packet.state().approvalCarries, undefined);
  assert.throws(() => assertSpecApproval(packet.root, "change", packet.state()),
    (error) => error.code === "SPEC_APPROVAL_REQUIRED");
});

test("an agreement edit after an evidence upgrade still requires approval", (t) => {
  const packet = approvedPacket(t);
  preserveSpecApprovalAcross(packet.root, "change", packet.io,
    () => packet.upgrade(packet.root), "evidence-upgrade");
  packet.edit(packet.root);
  assert.throws(() => assertSpecApproval(packet.root, "change", packet.state()),
    (error) => error.code === "SPEC_APPROVAL_REQUIRED");
});
