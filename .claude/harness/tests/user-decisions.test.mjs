import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agreementIdentity, assertSpecApproval, REVIEW_WINDOW_MS,
  reviewWindowRemaining, reviewWindowError, currentWaivers, autoExtendReviewWindow,
  AUTO_REVIEW_EXTENSION_REF } from "../runtime/core/user-decisions.mjs";
import { advanceFailureAction, createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { workspaceCapabilityValue } from "../runtime/core/execution-contract.mjs";

test("spec approval binds semantics and revision, not task completion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "spec-consent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec/changes/demo");
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "Change the greeting");
  writeFileSync(join(packet, "tasks.md"), "- [ ] Implement greeting\n");
  const state = { status: "change", specApproval: { required: true } };
  assert.throws(() => assertSpecApproval(root, "demo", state), { code: "SPEC_APPROVAL_REQUIRED" });
  state.specApproval = { required: true, identity: agreementIdentity(root, "demo"), revision: 0 };
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  writeFileSync(join(packet, "tasks.md"), "- [x] Implement greeting\n");
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  writeFileSync(join(packet, "proposal.md"), "Delete the greeting");
  assert.throws(() => assertSpecApproval(root, "demo", state), { code: "SPEC_APPROVAL_REQUIRED" });
  const workspace = join(root, "workspace");
  const workspacePacket = join(workspace, "openspec/changes/demo");
  mkdirSync(workspacePacket, { recursive: true });
  writeFileSync(join(workspacePacket, "proposal.md"), "Amend the greeting");
  writeFileSync(join(workspacePacket, "tasks.md"), "- [x] Implement greeting\n");
  state.status = "building";
  state.contractRevision = 1;
  assert.equal(workspaceCapabilityValue("demo", state).mode, "agreement-only");
  state.workspace = { mode: "copy", path: workspace };
  state.amendments = [{ revision: 1 }];
  state.specApproval = { required: true, identity: agreementIdentity(workspace, "demo"), revision: 1 };
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  state.amendments = [];
  // Without an amendment no single approval identity can equal both packets.
  assert.throws(() => assertSpecApproval(root, "demo", state), { code: "AGREEMENT_DRIFT" });
});

// A consumer Build widened a task's `[paths:]` in its isolated packet; the
// approval could then never match both packets and `advance` asked the user to
// approve again forever, until the agent asked the user to copy tasks.md.
test("task write scope is bookkeeping and packet drift is agent repair", (t) => {
  const root = mkdtempSync(join(tmpdir(), "spec-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const tasks = (paths) => `- [ ] T001 Build it [paths:${paths}] — verify: npm test\n`;
  for (const base of [root, workspace]) {
    mkdirSync(join(base, "openspec/changes/demo"), { recursive: true });
    writeFileSync(join(base, "openspec/changes/demo/proposal.md"), "Change the greeting");
    writeFileSync(join(base, "openspec/changes/demo/tasks.md"), tasks("src/a.ts"));
  }
  const legacy = agreementIdentity(root, "demo", { legacy: true });
  const state = { status: "building", contractRevision: 0, workspace: { path: workspace },
    specApproval: { required: true, identity: agreementIdentity(root, "demo"), revision: 0 } };
  writeFileSync(join(workspace, "openspec/changes/demo/tasks.md"),
    tasks("src/a.ts,app/[tenant]/**"));
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  // Approvals recorded before the upgrade keep their exact-bytes identity,
  // including when the sandbox later widens only its write scope.
  writeFileSync(join(workspace, "openspec/changes/demo/tasks.md"), tasks("src/a.ts"));
  state.specApproval.identity = legacy;
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  writeFileSync(join(workspace, "openspec/changes/demo/tasks.md"), tasks("src/a.ts,src/b.ts"));
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  // Changing what a task does still changes consent.
  writeFileSync(join(workspace, "openspec/changes/demo/tasks.md"),
    "- [ ] T001 Delete it [paths:src/a.ts] — verify: npm test\n");
  let drift;
  assert.throws(() => assertSpecApproval(root, "demo", state), (error) => (drift = error, true));
  assert.equal(drift.code, "AGREEMENT_DRIFT");
  const action = advanceFailureAction("demo", drift, { through: "build" });
  assert.equal(action.action, "REPAIR");
  assert.equal(action.actor, "agent");
  assert.match(action.command, /^claude-foundation change amend demo /);
});

test("legacy in-flight state needs no invented approval", () => {
  assert.doesNotThrow(() => assertSpecApproval("/missing", "legacy", { status: "building" }));
});

test("one deadline survives retry, fallback, and process resume", () => {
  const start = Date.parse("2026-09-09T00:00:00Z");
  const state = { reviewWindow: { startedAt: new Date(start).toISOString(),
    deadline: new Date(start + REVIEW_WINDOW_MS).toISOString() } };
  assert.equal(reviewWindowRemaining(state, start), 1_800_000);
  assert.equal(reviewWindowRemaining(JSON.parse(JSON.stringify(state)), start + 1_200_000), 600_000);
  assert.equal(reviewWindowRemaining(state, start + 1_800_000), 0);
  assert.equal(reviewWindowRemaining({ reviewWindow: { deadline: "corrupt" } }, start), 0);
  const action = advanceFailureAction("demo", reviewWindowError("demo"), { stage: "prove", through: "archived" });
  assert.equal(action.action, "ASK_USER");
  assert.deepEqual(action.decision.options.map((row) => row.id), ["continue", "land", "pause"]);
});

test("waivers expire on changed product or agreement without rewriting findings", () => {
  const waiver = { capability: "review", reason: "User accepts unreviewed scope",
    binding: { workspaceHash: "a", contractRevision: 2 } };
  const state = { contractRevision: 2, waivers: [waiver] };
  assert.deepEqual(currentWaivers(state, "a"), [waiver]);
  assert.deepEqual(currentWaivers(state, "b"), []);
  assert.deepEqual(currentWaivers({ ...state, contractRevision: 3 }, "a"), []);
  assert.deepEqual(state.waivers, [waiver]);
});

test("the first expired review window extends itself once as a harness decision", () => {
  const state = { reviewWindow: { startedAt: "2026-09-09T00:00:00Z", deadline: "2026-09-09T00:30:00Z" } };
  const at = Date.parse("2026-09-09T00:31:00Z");
  assert.equal(autoExtendReviewWindow({ reviewWindow: { deadline: "2026-09-09T01:00:00Z" } }, at), false);
  assert.equal(autoExtendReviewWindow({}, at), false);
  assert.equal(autoExtendReviewWindow(state, at), true);
  assert.equal(state.reviewWindow.decisionRef, AUTO_REVIEW_EXTENSION_REF);
  assert.equal(state.reviewWindow.owner, "harness");
  assert.equal(state.reviewWindow.deadline, "2026-09-09T01:01:00.000Z");
  assert.deepEqual(state.reviewWindowHistory, [
    { startedAt: "2026-09-09T00:00:00Z", deadline: "2026-09-09T00:30:00Z" }]);
  assert.equal(reviewWindowRemaining(state, at), REVIEW_WINDOW_MS);
  assert.equal(autoExtendReviewWindow(state, Date.parse("2026-09-09T01:02:00Z")), false);
  // A user-granted window after the automatic one still asks when it ends.
  state.reviewWindowHistory.push(state.reviewWindow);
  state.reviewWindow = { deadline: "2026-09-09T01:30:00Z", decisionRef: "user://continue" };
  assert.equal(autoExtendReviewWindow(state, Date.parse("2026-09-09T01:31:00Z")), false);
});

test("advance persists the automatic review extension instead of asking", () => {
  const state = { status: "building", reviewWindow: { deadline: "2026-09-09T00:30:00Z" } };
  const saved = [];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    saveRuntime: (value) => saved.push(structuredClone(value)),
    nowMs: () => Date.parse("2026-09-09T00:31:00Z"),
    agentDispatchValue: () => ({ action: "build-complete" }),
    authorityStatusValue: () => ({ requests: [{ type: "review", status: "requested" }] }),
    relevantHash: assert.fail, deliveredAiAttempts: assert.fail,
    readJson: assert.fail, proofAdvancePath: assert.fail, stableHash: assert.fail
  });
  const action = runtime.advanceValue("demo");
  assert.notEqual(action.boundary, "review-time-exhausted");
  assert.equal(saved[0]?.reviewWindow.decisionRef, AUTO_REVIEW_EXTENSION_REF);
});

test("resuming an expired review after the automatic extension returns a user decision without dispatching work", () => {
  const auto = { deadline: "2026-09-09T00:30:00Z", decisionRef: AUTO_REVIEW_EXTENSION_REF };
  const state = { status: "building", reviewWindow: auto,
    reviewWindowHistory: [{ deadline: "2026-09-09T00:00:00Z" }] };
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    nowMs: () => Date.parse("2026-09-09T00:31:00Z"),
    agentDispatchValue: () => ({ action: "build-complete" }),
    authorityStatusValue: () => ({ requests: [{ type: "review", status: "requested" }] }),
    relevantHash: assert.fail, deliveredAiAttempts: assert.fail,
    readJson: assert.fail, proofAdvancePath: assert.fail, stableHash: assert.fail
  });
  for (let i = 0; i < 2; i++) {
    const action = runtime.advanceValue("demo");
    assert.equal(action.action, "ASK_USER");
    assert.equal(action.boundary, "review-time-exhausted");
  }
  assert.equal(state.reviewWindow, auto);
});
