import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";
import { agreementIdentity, assertSpecApproval, missingApprovalLanes } from "../runtime/core/user-decisions.mjs";
import { approvalPolicyIssue } from "../runtime/core/runtime-environment.mjs";

// The lifecycle records consent; assertSpecApproval is the gate every Build,
// sandbox, and Land path calls, so a lane gap must stop it.
function fixture(t, { configured = ["tech-lead", "qa"], required = configured, state = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-approval-lanes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "demo";
  const packet = join(root, "openspec", "changes", id);
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "## Summary\n\nShow the board.\n");
  writeFileSync(join(packet, "design.md"), "## Overview\n\nBoard.\n");
  const runtimeDir = join(root, ".foundation", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const statePath = join(runtimeDir, `${id}.json`);
  writeFileSync(statePath, JSON.stringify({ id, status: "change", contractRevision: 0,
    specApproval: { required: true }, ...state }));
  const loadRuntime = () => JSON.parse(readFileSync(statePath, "utf8"));
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({}), fail: (message) => { throw new Error(message); },
    loadRuntime, saveRuntime: (value) => writeFileSync(statePath, JSON.stringify(value)),
    validate: () => {}, now: () => "2026-10-18T00:00:00.000Z",
    changePath: () => packet, activeChangePath: () => packet,
    approvalLanes: () => ({ configured, required })
  });
  const approve = (flags) => {
    const log = console.log;
    console.log = () => {};
    try { lifecycle.resolveChange(id, { "approve-spec": true, ...flags }); }
    finally { console.log = log; }
  };
  return { root, id, packet, loadRuntime, approve };
}

test("a missing lane stops the Build gate and names the role", (t) => {
  const { root, id, loadRuntime, approve } = fixture(t);
  approve({ role: "tech-lead", "decision-ref": "tl-ok" });
  const state = loadRuntime();
  assert.equal(state.specApproval.identity, undefined);
  assert.deepEqual(missingApprovalLanes(root, id, state), ["qa"]);
  assert.throws(() => assertSpecApproval(root, id, state),
    (error) => error.code === "SPEC_APPROVAL_REQUIRED" && /qa/.test(error.message) &&
      error.decision.options.some((option) => /--role qa/.test(option.command || "")));
});

test("every required lane approved passes the gate", (t) => {
  const { root, id, loadRuntime, approve } = fixture(t);
  approve({ role: "tech-lead", "decision-ref": "tl-ok" });
  approve({ role: "qa", "decision-ref": "qa-ok" });
  const state = loadRuntime();
  assert.equal(state.specApproval.identity, agreementIdentity(root, id));
  assert.equal(state.specApproval.lanes.qa.decisionRef, "qa-ok");
  assert.doesNotThrow(() => assertSpecApproval(root, id, state));
});

test("a configured role the router did not select is not required", (t) => {
  const { root, id, loadRuntime, approve } = fixture(t, {
    configured: ["tech-lead", "security"], required: ["tech-lead"]
  });
  approve({ role: "tech-lead", "decision-ref": "tl-ok" });
  assert.doesNotThrow(() => assertSpecApproval(root, id, loadRuntime()));
});

test("an unknown role is refused and records nothing", (t) => {
  const { loadRuntime, approve } = fixture(t);
  const before = JSON.stringify(loadRuntime());
  assert.throws(() => approve({ role: "cfo", "decision-ref": "x" }), /cfo.*tech-lead, qa/);
  assert.equal(JSON.stringify(loadRuntime()), before);
});

test("--role without approval.roles is refused", (t) => {
  const { approve } = fixture(t, { configured: [], required: [] });
  assert.throws(() => approve({ role: "qa", "decision-ref": "x" }), /approval\.roles/);
});

test("an approval without a role covers every lane", (t) => {
  const { root, id, loadRuntime, approve } = fixture(t);
  approve({ "decision-ref": "all-ok" });
  assert.doesNotThrow(() => assertSpecApproval(root, id, loadRuntime()));
});

test("a role approval after the whole approval adds a lane without revoking it", (t) => {
  const { root, id, loadRuntime, approve } = fixture(t);
  approve({ "decision-ref": "all-ok" });
  approve({ role: "qa", "decision-ref": "qa-ok" });
  const state = loadRuntime();
  assert.equal(state.specApproval.identity, agreementIdentity(root, id));
  assert.equal(state.specApproval.decisionRef, "all-ok");
  assert.equal(state.specApproval.lanes.qa.decisionRef, "qa-ok");
  assert.doesNotThrow(() => assertSpecApproval(root, id, state));
});

test("a malformed approval policy is refused instead of disabling lanes", () => {
  assert.match(approvalPolicyIssue({ approval: "tech-lead" }), /approval must be an object/);
  assert.match(approvalPolicyIssue({ approval: { roles: "qa" } }), /approval\.roles must be an array/);
  assert.match(approvalPolicyIssue({ approval: { roles: ["qa", "qa"] } }), /unique/);
  assert.match(approvalPolicyIssue({ approval: { roles: ["cfo"] } }), /unique values/);
  assert.equal(approvalPolicyIssue({}), null);
  assert.equal(approvalPolicyIssue({ approval: { roles: ["tech-lead", "qa"] } }), null);
});

test("legacy single approval state without lanes still passes", (t) => {
  const { root, id } = fixture(t);
  const state = { status: "change", contractRevision: 0,
    specApproval: { required: true, identity: agreementIdentity(root, id), revision: 0, decisionRef: "old" } };
  assert.doesNotThrow(() => assertSpecApproval(root, id, state));
});

test("a lane approved on an earlier packet no longer counts", (t) => {
  const { root, id, packet, loadRuntime, approve } = fixture(t);
  approve({ role: "tech-lead", "decision-ref": "tl-ok" });
  writeFileSync(join(packet, "proposal.md"), "## Summary\n\nDelete the board.\n");
  approve({ role: "qa", "decision-ref": "qa-ok" });
  const state = loadRuntime();
  assert.equal(state.specApproval.identity, undefined, "tech-lead approved different bytes");
  assert.deepEqual(missingApprovalLanes(root, id, state), ["tech-lead"]);
});
