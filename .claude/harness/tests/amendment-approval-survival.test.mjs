import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";
import {
  agreementIdentity, amendedAgreementMatches, assertSpecApproval, snapshotAmendedPacket
} from "../runtime/core/user-decisions.mjs";

const ROOT_TASKS = "## 1\n- [ ] T001 Verify [paths: go-deposit/**] — verify: `go test ./...`\n";
const AMENDED_TASKS = "## 1\n- [ ] T001 Verify [paths: go-deposit/**] — verify: `cd go-deposit && go test ./...`\n";

function write(base, id, files) {
  const packet = join(base, "openspec", "changes", id);
  mkdirSync(packet, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(packet, name), content);
  return packet;
}

// A target packet, an isolated workspace whose packet was amended by the
// harness (snapshot + identity recorded like `change amend` does), and a
// lifecycle whose active packet is the isolated one.
function fixture(t, { bookkeepingBumps = 1 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "amendment-survival-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "demo";
  write(root, id, { "proposal.md": "## Why\n\nLadder claim.\n", "tasks.md": ROOT_TASKS });
  const workspace = join(root, ".foundation", "sandboxes", id);
  const sandboxPacket = write(workspace, id, {
    "proposal.md": "## Why\n\nLadder claim.\n", "tasks.md": AMENDED_TASKS });
  const amendedRevision = 4;
  const amended = snapshotAmendedPacket(root, workspace, id, amendedRevision);
  const statePath = join(root, ".foundation", "runtime", `${id}.json`);
  mkdirSync(join(root, ".foundation", "runtime"), { recursive: true });
  const state = {
    id, status: "building", contractRevision: amendedRevision + bookkeepingBumps,
    workspace: { path: workspace, mode: "worktree" },
    specApproval: { required: true, identity: agreementIdentity(root, id),
      revision: amendedRevision - 1, decisionRef: "D-approve", approvedAt: "2026-10-27T00:00:00.000Z" },
    amendments: [{ version: 1, revision: amendedRevision, reason: "verify needs cd + TAP",
      ...amended }]
  };
  writeFileSync(statePath, JSON.stringify(state));
  const loadRuntime = () => JSON.parse(readFileSync(statePath, "utf8"));
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({}), fail: (message) => { throw new Error(message); },
    loadRuntime, saveRuntime: (value) => writeFileSync(statePath, JSON.stringify(value)),
    validate: () => {}, now: () => "2026-10-28T00:00:00.000Z",
    changePath: () => join(root, "openspec", "changes", id),
    activeChangePath: () => sandboxPacket,
    approvalLanes: () => ({ configured: [], required: [] })
  });
  const approve = () => {
    const log = console.log;
    const error = console.error;
    const notices = [];
    console.log = () => {};
    console.error = (line) => notices.push(String(line));
    try { lifecycle.resolveChange(id, { "approve-spec": true, "decision-ref": "D-reapprove" }); }
    finally { console.log = log; console.error = error; }
    return notices;
  };
  const driftDir = join(root, ".foundation", "agreement-drift", id);
  const drifts = () => existsSync(driftDir) ? readdirSync(driftDir) : [];
  return { root, id, workspace, sandboxPacket, loadRuntime, approve, drifts, amended };
}

// Scenario: amend → reopen grounding (revision moves) → approve-spec keeps
// the amended verify and records consent on the sandbox packet.
test("approve-spec after a bookkeeping bump keeps the amended packet", (t) => {
  const { root, id, workspace, sandboxPacket, loadRuntime, approve, drifts } = fixture(t);
  const notices = approve();
  assert.equal(readFileSync(join(sandboxPacket, "tasks.md"), "utf8"), AMENDED_TASKS);
  assert.deepEqual(drifts(), []);
  assert.deepEqual(notices, []);
  const state = loadRuntime();
  assert.equal(state.specApproval.identity, agreementIdentity(workspace, id));
  assert.notEqual(state.specApproval.identity, agreementIdentity(root, id));
  assert.doesNotThrow(() => assertSpecApproval(root, id, state));
});

// Scenario: several amendments with bookkeeping bumps between them; the
// packet matching the latest one is the agreement, an older one is not.
test("the latest amendment is the agreement across repeated bumps", (t) => {
  const { root, id, workspace, sandboxPacket, loadRuntime } = fixture(t, { bookkeepingBumps: 1 });
  const state = loadRuntime();
  assert.equal(amendedAgreementMatches(state, workspace, id), true);
  writeFileSync(join(sandboxPacket, "tasks.md"), AMENDED_TASKS + "- [ ] T002 Second\n");
  const second = snapshotAmendedPacket(root, workspace, id, 6);
  state.amendments.push({ version: 1, revision: 6, reason: "second", ...second });
  state.contractRevision = 7;
  assert.equal(amendedAgreementMatches(state, workspace, id), true);
  writeFileSync(join(sandboxPacket, "tasks.md"), AMENDED_TASKS);
  assert.equal(amendedAgreementMatches(state, workspace, id), false,
    "a packet matching only an older amendment is not the current agreement");
});

// Scenario: a hand edit after the latest amendment is still drift, restored
// from the amended text (not the stale target packet) with the edit saved.
test("a hand edit after the amendment is restored to the amended text", (t) => {
  const { root, id, sandboxPacket, loadRuntime, approve, drifts } = fixture(t);
  writeFileSync(join(sandboxPacket, "proposal.md"), "## Why\n\nSomething else.\n");
  const notices = approve();
  assert.equal(readFileSync(join(sandboxPacket, "tasks.md"), "utf8"), AMENDED_TASKS,
    "the amended verify survives the restore");
  assert.equal(readFileSync(join(sandboxPacket, "proposal.md"), "utf8"), "## Why\n\nLadder claim.\n");
  assert.equal(drifts().length, 1);
  assert.equal(readFileSync(join(root, ".foundation", "agreement-drift", id, drifts()[0], "proposal.md"), "utf8"),
    "## Why\n\nSomething else.\n");
  assert.match(notices.join("\n"), /Restored: proposal\.md\./);
  assert.doesNotThrow(() => assertSpecApproval(root, id, loadRuntime()));
});

// Rows recorded by 3.6.8 carry no identity: they keep the revision-bound
// rule, so an upgraded runtime neither trusts nor restores more than before.
test("amendment rows without an identity keep the revision-bound rule", (t) => {
  const root = mkdtempSync(join(tmpdir(), "amendment-legacy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "ws");
  write(root, "demo", { "tasks.md": ROOT_TASKS });
  write(workspace, "demo", { "tasks.md": AMENDED_TASKS });
  const state = { contractRevision: 4, amendments: [{ revision: 4 }] };
  assert.equal(amendedAgreementMatches(state, workspace, "demo"), true);
  state.contractRevision = 5;
  assert.equal(amendedAgreementMatches(state, workspace, "demo"), false);
});
