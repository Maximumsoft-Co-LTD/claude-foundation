import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createSandboxRuntime, recordSandboxBaseMove, reportSandboxSync,
  sandboxMovementLine, unusedCopyResolveMessage
} from "../runtime/workflow/sandbox-runtime.mjs";
import { agreementIdentity } from "../runtime/core/user-decisions.mjs";
import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { targetHeadMovedDecision } from "../runtime/workflow/apply-recovery.mjs";
import { gateDigest } from "../runtime/core/convergent-gate.mjs";
import {
  COPY_BASE_MAX_BYTES, captureCopyBase, captureCopyBaseSurface, copyBaseBytes, copyBaseStore,
  fileSource
} from "../runtime/workflow/copy-base.mjs";

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fail = (message) => { throw new Error(message); };

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function capture(fn) {
  const prior = console.log;
  const rows = [];
  console.log = (value) => rows.push(String(value));
  try { return { value: fn(), rows }; } finally { console.log = prior; }
}

function syncFixture(id = "sync-copy", { unchanged = false, hashChanged = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sandbox-sync-source-"));
  const sandbox = join(root, ".foundation", "sandboxes", id);
  const source = join(root, "openspec", "changes", id);
  const destination = join(sandbox, "openspec", "changes", id);
  write(join(source, "tasks.md"), "- [ ] T001 keep progress\n");
  write(join(source, "proposal.md"), "target proposal\n");
  write(join(destination, "tasks.md"), "- [x] T001 keep progress\n");
  write(join(destination, "proposal.md"), "target proposal\n");
  write(join(root, "forward.txt"), "target-new\n");
  write(join(sandbox, "forward.txt"), "base-old\n");
  write(join(sandbox, "deleted.txt"), "base-old\n");
  write(join(root, "resolved.txt"), "target-new\n");
  write(join(sandbox, "resolved.txt"), "merged-result\n");
  write(join(root, "conflict.txt"), "target-new\n");
  write(join(sandbox, "conflict.txt"), "sandbox-new\n");
  const proof = join(root, ".foundation", "proof", `${id}.json`);
  write(proof, "{}\n");
  const targetManifest = {
    "same.txt": "same", "already.txt": "new", "forward.txt": "new",
    "resolved.txt": "new", "conflict.txt": "new"
  };
  const sandboxManifest = {
    "same.txt": "same", "already.txt": "new", "forward.txt": "old",
    "resolved.txt": "merged", "conflict.txt": "sandbox", "deleted.txt": "old"
  };
  const state = {
    status: "resolved", revision: 0, contractRevision: 0, executionRevision: 0,
    workspace: {
      mode: "copy", path: sandbox,
      recovery: { reason: "old" },
      baseline: {
        "same.txt": "same", "already.txt": "old", "forward.txt": "old",
        "resolved.txt": "old", "conflict.txt": "old", "deleted.txt": "old"
      }
    }
  };
  if (unchanged) {
    for (const manifest of [targetManifest, sandboxManifest, state.workspace.baseline])
      for (const path of Object.keys(manifest)) delete manifest[path];
    state.status = "proven";
  }
  let hashReads = 0;
  let repositoryScope = { source: [], destination: [] };
  let saves = 0;
  let sourceHash = "source-hash";
  let onHash = () => {};
  const manifestReads = [];
  const runtime = createSandboxRuntime({
    root,
    policy: () => ({ sandbox: {} }),
    loadRuntime: () => state,
    saveRuntime: () => { saves += 1; },
    workspaceManifest: (path) => {
      manifestReads.push(path);
      return path === root ? targetManifest : sandboxManifest;
    },
    directoryHash: () => sourceHash,
    fileDigest: digest,
    changePath: () => source,
    selectedRepositories: () => [],
    clearSnapshotCache: () => {},
    validate: () => {},
    repositorySelectionIdsAt: (path) => path === source
      ? repositoryScope.source : repositoryScope.destination,
    contractFingerprint: (_changeId, path) => unchanged ? "same-contract" : path === source
      ? "contract-next" : "contract-prior",
    executionFingerprint: (_changeId, path) => unchanged ? "same-execution" : path === source
      ? "execution-next" : "execution-prior",
    taskBlocks: (text) => text.includes("[x]")
      ? [{ id: "T001", text: "T001 keep progress", done: true }] : [],
    proofPath: () => proof,
    relevantHash: () => {
      onHash();
      return hashChanged && hashReads++ > 0 ? "changed-hash" : "relevant-hash";
    },
    now: () => "2026-08-26T00:00:00.000Z",
    fail
  });
  return {
    root, sandbox, source, destination, state, runtime, manifestReads, targetManifest,
    sandboxManifest,
    setRepositoryScope(value) { repositoryScope = value; },
    setSourceHash(value) { sourceHash = value; },
    onHash(callback) { onHash = callback; },
    saves: () => saves
  };
}

test("copy sync reconciles target movement and preserves task progress", () => {
  const fixture = syncFixture();

  const output = capture(() => fixture.runtime.sync("sync-copy", {
    resolve: "resolved.txt"
  }));

  assert.match(output.rows.join("\n"), /fast-forwarded: 2 file/);
  assert.match(output.rows.join("\n"), /CONFLICT conflict\.txt/);
  assert.match(readFileSync(join(fixture.destination, "tasks.md"), "utf8"),
    /\[x\] T001/);
  assert.equal(readFileSync(join(fixture.sandbox, "forward.txt"), "utf8"),
    "target-new\n");
  assert.equal(existsSync(join(fixture.sandbox, "deleted.txt")), false);
  assert.equal(fixture.state.workspace.baseline["resolved.txt"], "new");
  assert.equal(fixture.state.workspace.baseline["conflict.txt"], "old");
  assert.equal(fixture.state.revision, 1);
  assert.equal(fixture.state.contractRevision, 1);
  assert.equal(fixture.state.executionRevision, 1);
  assert.equal(fixture.state.workspace.recovery, undefined);
  assert.equal(existsSync(join(fixture.root, ".foundation", "proof", "sync-copy.json")),
    false);
  assert.equal(fixture.saves(), 1);
  assert.deepEqual(fixture.manifestReads, [fixture.root, fixture.sandbox],
    "copy-only sync must not walk a third manifest for an unused base-move identity");
  rmSync(fixture.root, { recursive: true, force: true });
});

// `advance` resumes a copy conflict with a plain sync (no --resolve). The
// sandbox copy settles only when a 3-way check against the captured base bytes
// proves the target's edit is in it: a changed copy alone proves nothing.
const MERGE_BASE = "a\nb\nc\nd\ne\n";
const USER_EDIT = MERGE_BASE.replace("a\n", "A (user)\n");
const CHANGE_EDIT = MERGE_BASE.replace("e\n", "E (change)\n");
const BOTH_EDITS = USER_EDIT.replace("e\n", "E (change)\n");
const identityOf = (path) => `file:regular:${digest(path)}`;

function mergeCopy(id) {
  const fixture = syncFixture(id);
  for (const manifest of [fixture.targetManifest, fixture.sandboxManifest,
    fixture.state.workspace.baseline])
    for (const path of Object.keys(manifest)) delete manifest[path];
  write(join(fixture.root, "merge.txt"), MERGE_BASE);
  write(join(fixture.sandbox, "merge.txt"), CHANGE_EDIT);
  const base = identityOf(join(fixture.root, "merge.txt"));
  fixture.state.workspace.baseline["merge.txt"] = base;
  fixture.base = base;
  fixture.sync = (flags = {}) => {
    fixture.targetManifest["merge.txt"] = identityOf(join(fixture.root, "merge.txt"));
    fixture.sandboxManifest["merge.txt"] = identityOf(join(fixture.sandbox, "merge.txt"));
    return capture(() => fixture.runtime.sync(id, flags)).value;
  };
  return fixture;
}

test("copy sync settles only a provable merge on a plain resync, as advance runs it", () => {
  for (const [label, copy, settles] of [
    ["merged", BOTH_EDITS, true],
    ["edited without merging", CHANGE_EDIT.replace("E (change)", "E (change, again)"), false],
    ["marked", `<<<<<<< sandbox\n${CHANGE_EDIT}=======\n${USER_EDIT}>>>>>>> target\n`, false]
  ]) {
    const fixture = mergeCopy(`copy-${label.replaceAll(" ", "-")}`);
    try {
      // The first sync sees the sandbox diverge while the target is still the
      // base, and stores the base bytes.
      assert.equal(fixture.sync().status, "SYNCED", label);
      write(join(fixture.root, "merge.txt"), USER_EDIT);
      assert.deepEqual(fixture.sync().conflicts, ["merge.txt"], label);
      write(join(fixture.sandbox, "merge.txt"), copy);
      const again = fixture.sync();
      assert.equal(again.status, settles ? "SYNCED" : "CONFLICT", label);
      assert.equal(fixture.state.workspace.baseline["merge.txt"],
        settles ? identityOf(join(fixture.root, "merge.txt")) : fixture.base, label);
      assert.equal(readFileSync(join(fixture.sandbox, "merge.txt"), "utf8"), copy, label);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

// The route the agent is actually given: `advance` runs the plain sync itself.
test("advance settles a copy conflict once the agent's merge is provable, never before", async () => {
  const fixture = mergeCopy("copy-advance");
  try {
    assert.equal(fixture.sync().status, "SYNCED");
    write(join(fixture.root, "merge.txt"), USER_EDIT);
    let stored = { id: "demo", status: "proven", contractRevision: 1 };
    let lands = 0;
    const settled = () => fixture.state.workspace.baseline["merge.txt"] ===
      identityOf(join(fixture.root, "merge.txt"));
    // The agent's edit is progress: it changes the sandbox workspace hash.
    const workspaceHash = () => digest(join(fixture.sandbox, "merge.txt"));
    const runtime = () => createAdvanceRuntime({
      loadRuntime: () => structuredClone(stored),
      saveRuntime: (value) => { stored = structuredClone(value); },
      agentDispatchValue: () => ({ action: "build-complete" }), relevantHash: workspaceHash,
      stableHash: gateDigest, deliveredAiAttempts: () => [],
      authorityStatusValue: () => ({ requests: [] }),
      readJson: () => ({ status: "PASS", workspaceHash: workspaceHash() }),
      proofAdvancePath: () => "unused", output: () => {}, hasLandGrant: () => true,
      proofIsCurrent: () => false,
      runProof: async () => { throw new Error("explicit Land must not rerun proof"); },
      recoverSandbox: async () => fixture.sync(),
      runLand: async () => {
        lands += 1;
        if (!settled()) return { status: "BLOCKED", decision: targetHeadMovedDecision({ changeId: "demo" }) };
        stored = { ...stored, status: "archived" };
        return { archived: true };
      }
    });
    const conflicted = await runtime().advanceThrough("demo", "archived");
    assert.equal(conflicted.legacyAction, "REPAIR_SYNC_CONFLICT");
    // An edit that drops the target's change never settles.
    write(join(fixture.sandbox, "merge.txt"), CHANGE_EDIT.replace("E (change)", "E (again)"));
    assert.equal((await runtime().advanceThrough("demo", "archived")).legacyAction,
      "REPAIR_SYNC_CONFLICT");
    assert.equal(settled(), false);
    write(join(fixture.sandbox, "merge.txt"), BOTH_EDITS);
    assert.equal((await runtime().advanceThrough("demo", "archived")).reached, "archived");
    assert.equal(settled(), true);
    assert.equal(readFileSync(join(fixture.sandbox, "merge.txt"), "utf8"), BOTH_EDITS);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("copy sync never settles a merge whose base bytes were never captured", () => {
  const fixture = mergeCopy("copy-uncaptured");
  try {
    write(join(fixture.root, "merge.txt"), USER_EDIT);
    assert.deepEqual(fixture.sync().conflicts, ["merge.txt"]);
    write(join(fixture.sandbox, "merge.txt"), BOTH_EDITS);
    assert.deepEqual(fixture.sync().conflicts, ["merge.txt"], "unprovable stays a conflict");
    assert.equal(fixture.sync({ resolve: "merge.txt" }).status, "SYNCED",
      "the explicit operator resolution still settles it");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("copy base store keeps verified text bytes and leaves large, binary, or tampered bases unprovable", () => {
  const root = mkdtempSync(join(tmpdir(), "copy-base-"));
  try {
    const files = { "text.txt": "text\n", "binary.bin": "bi\0nary", "big.txt":
      "x".repeat(COPY_BASE_MAX_BYTES + 1), "outside.txt": "outside\n" };
    for (const [path, value] of Object.entries(files)) write(join(root, path), value);
    const baseline = Object.fromEntries(Object.keys(files)
      .map((path) => [path, identityOf(join(root, path))]));
    // Eager capture covers the confined declared surface only.
    assert.equal(captureCopyBaseSurface({ root, baseline,
      matches: (path) => path !== "outside.txt" }), 1);
    assert.equal(copyBaseBytes({ root, baseline, path: "text.txt" }).toString(), "text\n");
    for (const path of ["binary.bin", "big.txt", "outside.txt"])
      assert.equal(copyBaseBytes({ root, baseline, path }), undefined, path);
    assert.equal(copyBaseBytes({ root, baseline, path: "created.txt" }), null);
    assert.equal(copyBaseBytes({ root, baseline: undefined, path: "text.txt" }), undefined);
    // A source that no longer hashes to the row is never stored.
    write(join(root, "outside.txt"), "changed\n");
    assert.equal(captureCopyBase({ root, baseline, path: "outside.txt",
      sources: [fileSource(join(root, "outside.txt"))] }), false);
    writeFileSync(join(copyBaseStore(root), baseline["text.txt"].split(":")[2]), "tampered\n");
    assert.equal(copyBaseBytes({ root, baseline, path: "text.txt" }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applied copy sync carries a recorded target edit into the sandbox copy", () => {
  const fixture = mergeCopy("copy-carry");
  try {
    assert.equal(fixture.sync().status, "SYNCED");
    write(join(fixture.root, "merge.txt"), USER_EDIT);
    fixture.state.workspace.applied = true;
    fixture.state.workspace.targetCarry = { "merge.txt": digest(join(fixture.root, "merge.txt")) };
    const synced = fixture.sync();
    assert.deepEqual(synced.targetCarried, ["merge.txt"]);
    assert.equal(readFileSync(join(fixture.sandbox, "merge.txt"), "utf8"), BOTH_EDITS);
    assert.equal(readFileSync(join(fixture.root, "merge.txt"), "utf8"), USER_EDIT,
      "the target is never written");
    assert.equal(fixture.state.workspace.targetCarry, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Build preparation imports amended tasks and preserves completed work", () => {
  const fixture = syncFixture("amended", { unchanged: true });
  try {
    fixture.state.status = "building";
    fixture.state.workspace.changeSourceHash = "previous-agreement";
    write(join(fixture.source, "tasks.md"),
      "- [ ] T001 keep progress\n- [ ] T002 new requirement\n");
    capture(() => fixture.runtime.prepareBuild("amended"));
    const tasks = readFileSync(join(fixture.destination, "tasks.md"), "utf8");
    assert.match(tasks, /\[x\] T001 keep progress/);
    assert.match(tasks, /\[ \] T002 new requirement/);
    assert.equal(fixture.state.workspace.changeSourceHash, "source-hash");
    const saves = fixture.saves();
    capture(() => fixture.runtime.prepareBuild("amended"));
    assert.equal(fixture.saves(), saves, "unchanged agreements do not repeat synchronization");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Build and copy sync preserve current and repeated sandbox amendments", () => {
  const fixture = syncFixture("isolated-amendment", { unchanged: true });
  try {
    fixture.state.status = "building";
    fixture.state.contractRevision = 1;
    fixture.state.amendments = [{ revision: 1 }];
    fixture.state.workspace.changeSourceHash = "source-hash";
    fixture.state.workspace.packetSnapshot = {
      "proposal.md": digest(join(fixture.source, "proposal.md"))
    };
    write(join(fixture.destination, "proposal.md"), "amended sandbox proposal\n");
    write(join(fixture.destination, "tasks.md"),
      "- [x] T001 keep progress\n- [ ] T002 amended requirement\n");
    const before = structuredClone(fixture.state);
    for (let attempt = 0; attempt < 2; attempt++)
      capture(() => fixture.runtime.prepareBuild("isolated-amendment"));
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "amended sandbox proposal\n");
    assert.match(readFileSync(join(fixture.destination, "tasks.md"), "utf8"),
      /\[x\] T001 keep progress\n- \[ \] T002 amended requirement/);
    assert.equal(readFileSync(join(fixture.source, "proposal.md"), "utf8"),
      "target proposal\n");
    assert.deepEqual(fixture.state, before);
    assert.equal(fixture.saves(), 0);
    capture(() => fixture.runtime.sync("isolated-amendment"));
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "amended sandbox proposal\n");
    assert.equal(fixture.state.contractRevision, 1);
    fixture.state.contractRevision = 2;
    fixture.state.amendments.push({ revision: 2 });
    write(join(fixture.destination, "proposal.md"), "second sandbox amendment\n");
    capture(() => fixture.runtime.prepareBuild("isolated-amendment"));
    capture(() => fixture.runtime.sync("isolated-amendment"));
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "second sandbox amendment\n");
    fixture.state.contractRevision = 3;
    fixture.state.workspace.changeSourceHash = "previous-agreement";
    assert.throws(() => fixture.runtime.prepareBuild("isolated-amendment"),
      /sandbox packet edits would be lost/,
      "historical amendments must still pass normal packet preservation guards");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("amended target divergence requires an explicit approved packet resolution", () => {
  const fixture = syncFixture("target-conflict", { unchanged: true });
  try {
    fixture.state.status = "building";
    fixture.state.contractRevision = 1;
    fixture.state.amendments = [{ revision: 1 }];
    fixture.state.workspace.changeSourceHash = "original-target";
    write(join(fixture.destination, "proposal.md"), "amended sandbox proposal\n");
    fixture.state.specApproval = { required: true, revision: 1,
      identity: agreementIdentity(fixture.sandbox, "target-conflict") };
    const before = structuredClone(fixture.state);
    const conflicts = (error) => error.code === "AMENDED_AGREEMENT_CONFLICT" &&
      error.decision.options.some((option) => option.command?.includes(
        "--resolve openspec/changes/target-conflict"));
    assert.throws(() => fixture.runtime.prepareBuild("target-conflict"), conflicts);
    assert.throws(() => fixture.runtime.sync("target-conflict"), conflicts);
    assert.throws(() => fixture.runtime.sync("target-conflict", { resolve: "proposal.md" }), conflicts);
    assert.deepEqual(fixture.state, before);
    write(join(fixture.destination, "proposal.md"), "approved merged agreement\n");
    const flags = { resolve: "openspec/changes/target-conflict" };
    assert.throws(() => fixture.runtime.sync("target-conflict", flags),
      (error) => error.code === "SPEC_APPROVAL_REQUIRED");
    fixture.state.specApproval.identity = agreementIdentity(fixture.sandbox, "target-conflict");
    capture(() => fixture.runtime.sync("target-conflict", flags));
    assert.equal(fixture.state.workspace.changeSourceHash, "source-hash");
    assert.equal(fixture.state.contractRevision, 1);
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "approved merged agreement\n");
    assert.equal(readFileSync(join(fixture.source, "proposal.md"), "utf8"), "target proposal\n");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("amended copy sync retains the packet through code conflict resolution", () => {
  const fixture = syncFixture("amended-copy-conflict");
  try {
    fixture.state.status = "building";
    fixture.state.contractRevision = 1;
    fixture.state.amendments = [{ revision: 1 }];
    fixture.state.workspace.changeSourceHash = "source-hash";
    write(join(fixture.destination, "proposal.md"), "isolated amendment\n");
    const first = capture(() => fixture.runtime.sync("amended-copy-conflict",
      { resolve: "resolved.txt" })).value;
    assert.equal(first.status, "CONFLICT");
    assert.deepEqual(first.conflicts, ["conflict.txt"]);
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "isolated amendment\n");
    assert.equal(readFileSync(join(fixture.sandbox, "forward.txt"), "utf8"), "target-new\n");
    assert.equal(fixture.state.workspace.baseline["conflict.txt"], "old");
    const second = capture(() => fixture.runtime.sync("amended-copy-conflict",
      { resolve: "conflict.txt" })).value;
    assert.equal(second.status, "SYNCED");
    assert.equal(fixture.state.workspace.baseline["conflict.txt"], "new");
    assert.equal(fixture.state.contractRevision, 1);
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"),
      "isolated amendment\n");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("target packet edits during amended sync cannot be acknowledged implicitly", () => {
  const fixture = syncFixture("concurrent-target", { unchanged: true });
  try {
    fixture.state.status = "building";
    fixture.state.contractRevision = 1;
    fixture.state.amendments = [{ revision: 1 }];
    fixture.state.workspace.changeSourceHash = "source-hash";
    write(join(fixture.destination, "proposal.md"), "isolated amendment\n");
    fixture.onHash(() => {
      write(join(fixture.source, "proposal.md"), "concurrent target edit\n");
      fixture.setSourceHash("concurrent-target-hash");
    });
    assert.throws(() => fixture.runtime.sync("concurrent-target"), /target agreement changed during/);
    assert.equal(fixture.state.workspace.changeSourceHash, "source-hash");
    assert.equal(fixture.saves(), 0);
    assert.equal(readFileSync(join(fixture.destination, "proposal.md"), "utf8"), "isolated amendment\n");
    assert.equal(readFileSync(join(fixture.source, "proposal.md"), "utf8"), "concurrent target edit\n");
    assert.throws(() => fixture.runtime.sync("concurrent-target"),
      (error) => error.code === "AMENDED_AGREEMENT_CONFLICT");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("repeated no-op sync preserves proof bytes and proven state", () => {
  const fixture = syncFixture("no-op", { unchanged: true });
  try {
    const proof = join(fixture.root, ".foundation", "proof", "no-op.json");
    const original = readFileSync(proof, "utf8");
    capture(() => fixture.runtime.sync("no-op"));
    capture(() => fixture.runtime.sync("no-op"));
    assert.equal(readFileSync(proof, "utf8"), original);
    assert.equal(fixture.state.status, "proven");
    assert.equal(fixture.state.contractRevision, 0);
    assert.equal(fixture.state.executionRevision, 0);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("sync invalidates proof for content movement even when the contract is unchanged", () => {
  const fixture = syncFixture("content-change", { unchanged: true, hashChanged: true });
  try {
    capture(() => fixture.runtime.sync("content-change"));
    assert.equal(existsSync(join(fixture.root, ".foundation", "proof", "content-change.json")), false);
    assert.equal(fixture.state.status, "building");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("sync rejects a resolve path that is not a conflict", () => {
  const fixture = syncFixture("unused-resolve");

  assert.throws(() => fixture.runtime.sync("unused-resolve", {
    resolve: "same.txt"
  }), /not in conflict/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("unused copy resolution diagnostics preserve singular and plural instructions", () => {
  assert.match(unusedCopyResolveMessage(["one.txt"]),
    /'one\.txt'.*which is not in conflict; drop it/s);
  assert.match(unusedCopyResolveMessage(["one.txt", "two.txt"]),
    /'one\.txt', 'two\.txt'.*which are not in conflict; drop them/s);
});

test("sync creates a missing packet for an already-applied copy", () => {
  const fixture = syncFixture("missing-packet");
  rmSync(fixture.destination, { recursive: true, force: true });
  fixture.state.workspace.packetSnapshot = {};
  fixture.state.workspace.applied = true;

  fixture.runtime.sync("missing-packet");

  assert.equal(existsSync(join(fixture.destination, "tasks.md")), true);
  assert.equal(fixture.state.workspace.baseline["forward.txt"], "old");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync rejects sandbox-only packet edits before overwriting them", () => {
  const fixture = syncFixture("packet-loss");
  fixture.state.workspace.packetSnapshot = {
    "tasks.md": digest(join(fixture.destination, "tasks.md")),
    "proposal.md": "previous-copy",
    "removed.md": "previously-present"
  };
  write(join(fixture.destination, "proposal.md"), "sandbox-only edit\n");
  write(join(fixture.destination, "sandbox-only.md"), "sandbox-only file\n");

  assert.throws(() => fixture.runtime.sync("packet-loss"),
    /sandbox packet edits would be lost/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync rejects a repository topology revision during Build", () => {
  const fixture = syncFixture("scope-change");
  fixture.setRepositoryScope({ source: ["root", "api"], destination: ["root"] });

  assert.throws(() => fixture.runtime.sync("scope-change"),
    /repository scope changed during Build/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync requires an existing active sandbox", () => {
  const fixture = syncFixture("inactive");
  fixture.state.workspace = null;

  assert.throws(() => fixture.runtime.sync("inactive"), /has no active sandbox/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("movement formatting distinguishes rebased, moved, and multi-repository results", () => {
  assert.equal(sandboxMovementLine(null), "");
  assert.match(sandboxMovementLine({
    rebased: true, multiRepository: false, from: "123456789",
    to: "abcdefghi", repositories: [{ from: "123456789", to: "abcdefghi" }]
  }), /rebased: 12345678 -> abcdefgh/);
  assert.match(sandboxMovementLine({
    rebased: false, multiRepository: false,
    repositories: [{ from: "old-head", to: "new-head" }]
  }), /target moved: old-head -> new-head/);
  assert.match(sandboxMovementLine({
    rebased: false, multiRepository: false,
    repositories: [{ from: null, to: null }]
  }), /target moved:  -> /);
  assert.match(sandboxMovementLine({
    rebased: true, multiRepository: true,
    repositories: [
      { repository: "root", from: "a", to: "b", rebased: true },
      { repository: "api", from: "c", to: "d", rebased: false }
    ]
  }), /target moved api: c -> d/);
});

test("base-move recording includes only successfully replayed repositories", () => {
  const state = {};
  recordSandboxBaseMove({
    id: "move", state, preDiffIdentity: "before",
    movement: {
      rebased: true,
      repositories: [
        { repository: "root", from: "a", to: "b", rebased: true },
        { repository: "api", from: "c", to: "d", rebased: false }
      ]
    },
    now: () => "now", changeDiffIdentity: () => "after"
  });
  assert.equal(state.lastBaseMove.movementKey, "root:b");
  assert.equal(state.lastBaseMove.postDiffIdentity, "after");
  const unchanged = {};
  recordSandboxBaseMove({ state: unchanged, movement: null });
  assert.equal(unchanged.lastBaseMove, undefined);
});

test("sync reporting renders copy and moved-target conflicts", () => {
  const rows = [];
  reportSandboxSync({
    id: "report", state: { revision: 2 }, forwarded: 1,
    conflicts: ["copy.txt"], relevantHash: () => "hash", log: (row) => rows.push(row),
    movement: {
      rebased: false, multiRepository: true,
      repositories: [{ repository: "api", from: "a", to: "b", rebased: false }],
      conflicts: [{ repository: "api", path: "api.txt" }]
    }
  });
  assert.match(rows.join("\n"), /fast-forwarded: 1 file/);
  assert.match(rows.join("\n"), /CONFLICT copy\.txt/);
  const copyRow = rows.find((row) => row.startsWith("CONFLICT copy.txt"));
  assert.match(copyRow, /advance report --through/, "the copy conflict resumes through advance");
  assert.doesNotMatch(copyRow, /--resolve|sandbox sync/);
  assert.match(rows.join("\n"), /CONFLICT api:api\.txt/);
  reportSandboxSync({
    id: "retry", state: { revision: 1 }, forwarded: 0, conflicts: [],
    relevantHash: () => "hash", log: (row) => rows.push(row),
    movement: {
      rebased: false, multiRepository: false,
      repositories: [{ from: "a", to: "b", rebased: false }], conflicts: []
    }
  });
  assert.match(rows.at(-1), /TARGET MOVED retry/);
});
