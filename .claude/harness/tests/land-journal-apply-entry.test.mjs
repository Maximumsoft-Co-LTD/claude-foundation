import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  applyFailureAfter,
  applyLandJournalEntry,
  cleanupLandJournalOperation,
  createLandJournal,
  landEntryNoOp,
  restoreLandJournalEntry,
  rollbackLandJournalOperation,
  verifyLandJournalOperation
} from "../runtime/workflow/land-journal.mjs";
import { landUndoPlan } from "../runtime/workflow/land-undo.mjs";

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(name) {
  const root = mkdtempSync(join(tmpdir(), `foundation-land-entry-${name}-`));
  const transactions = join(root, ".foundation", "transactions");
  const sandbox = join(root, ".foundation", "sandbox");
  const writes = [];
  const runtime = createLandJournal({
    root,
    transactions,
    fileDigest: (path) => readFileSync(path, "utf8"),
    directoryHash: (path) => `directory:${path}`,
    pathInside: (parent, path) => path.startsWith(`${parent}/`),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      write(path, `${JSON.stringify(value)}\n`);
      writes.push(JSON.parse(JSON.stringify(value)));
    },
    now: () => "2026-08-26T00:00:00.000Z"
  });
  const journal = {
    changeId: "change",
    transactionId: "transaction",
    sandboxPath: sandbox,
    appliedPaths: [],
    inFlightPaths: []
  };
  return { root, sandbox, runtime, journal, writes };
}

test("apply entry replaces a target through staging and records journal order", () => {
  const { root, sandbox, runtime, journal, writes } = fixture("replace");
  write(join(root, "src/app.txt"), "before");
  write(join(sandbox, "src/app.txt"), "after");
  runtime.applyEntry(journal, {
    path: "src/app.txt", before: "before", after: "after"
  }, 0);
  assert.equal(readFileSync(join(root, "src/app.txt"), "utf8"), "after");
  assert.deepEqual(journal.appliedPaths, ["src/app.txt"]);
  assert.deepEqual(journal.inFlightPaths, []);
  assert.deepEqual(writes.map((row) => row.inFlightPaths), [["src/app.txt"], []]);
  assert.equal(existsSync(join(root, ".foundation/transactions/change/transaction/stage/0")), false);
});

test("apply entry creates, deletes, and accepts exact no-op projections", () => {
  const created = fixture("create");
  write(join(created.sandbox, "new.txt"), "new");
  created.runtime.applyEntry(created.journal, {
    path: "new.txt", before: null, after: "new"
  }, 0);
  assert.equal(readFileSync(join(created.root, "new.txt"), "utf8"), "new");

  const deleted = fixture("delete");
  write(join(deleted.root, "old.txt"), "old");
  deleted.runtime.applyEntry(deleted.journal, {
    path: "old.txt", before: "old", after: null
  }, 0);
  assert.equal(existsSync(join(deleted.root, "old.txt")), false);

  const unchanged = fixture("noop");
  write(join(unchanged.root, "same.txt"), "same");
  unchanged.runtime.applyEntry(unchanged.journal, {
    path: "same.txt", before: "same", after: "same"
  }, 0);
  assert.equal(readFileSync(join(unchanged.root, "same.txt"), "utf8"), "same");
});

test("apply entry fails before journaling when the target has drifted", () => {
  const { root, sandbox, runtime, journal, writes } = fixture("drift");
  write(join(root, "app.txt"), "divergent");
  write(join(sandbox, "app.txt"), "after");
  assert.throws(() => runtime.applyEntry(journal, {
    path: "app.txt", before: "before", after: "after"
  }, 0), /target changed during apply/);
  assert.deepEqual(writes, []);
  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "divergent");
});

test("post-apply mismatch leaves the path in flight for rollback", () => {
  const journal = { appliedPaths: [], inFlightPaths: [] };
  let matchCalls = 0;
  const saves = [];
  assert.throws(() => applyLandJournalEntry({
    safeRootPath: () => "/target",
    pathIdentity: () => "before",
    matches: () => ++matchCalls === 1,
    save: (value) => saves.push([...value.inFlightPaths]),
    env: {},
    pathExists: () => false,
    remove: assert.fail,
    copyPath: () => {},
    makeDirectory: () => {},
    rename: () => {},
    transactionRoot: () => "/transaction"
  }, journal, { path: "app.txt", before: "before", after: "before" }, 0),
  /post-apply projection mismatch/);
  assert.deepEqual(journal.inFlightPaths, ["app.txt"]);
  assert.deepEqual(saves, [["app.txt"]]);
});

test("test-mode failure is injected only after the applied journal is durable", () => {
  const journal = { appliedPaths: [], inFlightPaths: [] };
  const saves = [];
  assert.throws(() => applyLandJournalEntry({
    safeRootPath: () => "/target",
    pathIdentity: () => "same",
    matches: () => true,
    save: (value) => saves.push({
      applied: [...value.appliedPaths], inFlight: [...value.inFlightPaths]
    }),
    env: { FOUNDATION_TEST_MODE: "1", FOUNDATION_TEST_FAIL_APPLY_AFTER: "1" }
  }, journal, { path: "same.txt", before: "same", after: "same" }, 0),
  /injected apply failure after 1 path/);
  assert.deepEqual(saves.at(-1), { applied: ["same.txt"], inFlight: [] });
});

test("entry decisions account for modes and guarded test injection", () => {
  assert.equal(landEntryNoOp({ before: "x", after: "x" }), true);
  assert.equal(landEntryNoOp({ before: "x", after: "x", beforeMode: 0o644, afterMode: 0o755 }), false);
  assert.equal(applyFailureAfter({ FOUNDATION_TEST_MODE: "0", FOUNDATION_TEST_FAIL_APPLY_AFTER: "2" }), 0);
  assert.equal(applyFailureAfter({ FOUNDATION_TEST_MODE: "1", FOUNDATION_TEST_FAIL_APPLY_AFTER: "2" }), 2);
});

test("restore entry accepts settled state and rejects unowned divergence", () => {
  const entry = { path: "app.txt", before: "before", after: "after", backup: "backup/0" };
  let removed = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "before",
    matches: (_path, _entry, side) => side === "before",
    remove: () => { removed += 1; }, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: [] }, entry);
  assert.equal(removed, 0);

  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "divergent",
    matches: () => false, remove: assert.fail, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: [] }, entry), /manual recovery/);

  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => "divergent",
    matches: () => false, remove: assert.fail, copyPath: assert.fail,
    transactionRoot: () => "/transaction"
  }, { appliedPaths: ["app.txt"], inFlightPaths: [] }, entry), /manual recovery/);
});

test("restore entry removes applied creations and restores verified backups", () => {
  const creation = { path: "new.txt", before: null, after: "new", backup: null };
  const calls = [];
  let matchCall = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/new", pathIdentity: () => "new",
    matches: () => [false, true, true][matchCall++],
    remove: (...args) => calls.push(["remove", ...args]),
    copyPath: assert.fail, transactionRoot: () => "/transaction"
  }, { appliedPaths: [], inFlightPaths: ["new.txt"] }, creation);
  assert.deepEqual(calls, [["remove", "/new", { recursive: true }]]);

  const restored = [];
  matchCall = 0;
  restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => null,
    matches: () => [false, false, true][matchCall++],
    remove: assert.fail,
    copyPath: (...args) => restored.push(args),
    transactionRoot: () => "/transaction"
  }, {
    changeId: "change", transactionId: "tx",
    appliedPaths: ["app.txt"], inFlightPaths: []
  }, { path: "app.txt", before: "before", after: "after", backup: "backup/0" });
  assert.deepEqual(restored, [["/transaction/backup/0", "/target"]]);

  matchCall = 0;
  assert.throws(() => restoreLandJournalEntry({
    safeRootPath: () => "/target", pathIdentity: () => null,
    matches: () => [false, false, false][matchCall++],
    remove: assert.fail, copyPath: () => {}, transactionRoot: () => "/transaction"
  }, {
    changeId: "change", transactionId: "tx",
    appliedPaths: ["app.txt"], inFlightPaths: []
  }, { path: "app.txt", before: "before", after: "after", backup: "backup/0" }),
  /rollback verification failed/);
});

test("rollback processes entries in reverse and records manual recovery failures", () => {
  const order = [];
  const saves = [];
  const journal = {
    changeId: "change", transactionId: "tx", inFlightPaths: ["b"],
    entries: [{ path: "a" }, { path: "b" }]
  };
  rollbackLandJournalOperation({
    restoreEntry: (_journal, entry) => order.push(entry.path),
    save: (value) => saves.push(value.status),
    now: () => "now", transactionRoot: () => "/transaction"
  }, journal, new Error("apply failed"));
  assert.deepEqual(order, ["b", "a"]);
  assert.deepEqual(saves, ["rolling-back", "rolled-back"]);
  assert.equal(journal.failure, "apply failed");
  assert.deepEqual(journal.inFlightPaths, []);

  const failed = {
    changeId: "change", transactionId: "tx", inFlightPaths: [],
    entries: [{ path: "a" }, { path: "b" }]
  };
  assert.throws(() => rollbackLandJournalOperation({
    restoreEntry: () => { throw new Error("target diverged"); },
    save: () => {}, now: () => "now", transactionRoot: () => "/transaction",
    safeRootPath: (path) => `/root/${path}`,
    // 'a' holds neither the pre-apply nor the applied bytes; 'b' is Land's own.
    matches: (path, _entry, side) => path === "/root/b" && side === "after"
  }, failed, "apply failed"), /target diverged/);
  assert.equal(failed.status, "manual-recovery");
  assert.equal(failed.recoveryError, "target diverged");
  assert.deepEqual(failed.divergentPaths, ["a"]);
  // Keeping the current target overwrites nothing, so the harness applies it.
  assert.equal(failed.decision.recommended, "keep-current");
  assert.equal(failed.decision.automaticRecovery, "keep-current");
  assert.deepEqual(failed.decision.divergentPaths, ["a"]);
  assert.equal(failed.decision.transactionRoot, "/transaction");
});

test("journal verification distinguishes every invalid projection state", () => {
  const base = {
    journalPath: () => "/journal", exists: () => true,
    readJson: () => ({ entries: [], projectionHash: "projection" }),
    matches: () => true, safeRootPath: (path) => `/root/${path}`
  };
  assert.deepEqual(verifyLandJournalOperation(base, { id: "change", workspace: {} }), {
    valid: false, reason: "missing-apply-transaction"
  });
  const state = {
    id: "change", workspace: { apply: { transactionId: "tx", projectionHash: "projection" } }
  };
  assert.deepEqual(verifyLandJournalOperation({ ...base, exists: () => false }, state), {
    valid: false, reason: "missing-apply-journal"
  });
  assert.deepEqual(verifyLandJournalOperation({
    ...base,
    readJson: () => ({ entries: [{ path: "bad.txt" }], projectionHash: "projection" }),
    matches: () => false
  }, state), { valid: false, reason: "projection-mismatch:bad.txt" });
  assert.deepEqual(verifyLandJournalOperation({
    ...base, readJson: () => ({ entries: [], projectionHash: "other" })
  }, state), { valid: false, reason: "projection-identity-mismatch" });
  assert.equal(verifyLandJournalOperation(base, state).valid, true);
});

test("archive verification relocates only the agreement and keeps its original identity", () => {
  const state = { id: "change", workspace: { apply: {
    transactionId: "tx", projectionHash: "projection"
  } } };
  const archivedChangePath = "openspec/changes/archive/2026-09-17-change";
  const entries = [
    { path: "openspec/changes/change", after: "directory:approved", afterMode: 0o755 },
    { path: "app.txt", after: "proven-product", afterMode: 0o644 }
  ];
  const observed = [];
  const context = {
    journalPath: () => "/journal", exists: () => true,
    readJson: () => ({ entries, projectionHash: "projection" }),
    safeRootPath: (path) => `/root/${path}`,
    matches: (path, entry, side) => { observed.push([path, entry.after, entry.afterMode, side]); return true; }
  };
  assert.equal(verifyLandJournalOperation(context, state, { archivedChangePath }).valid, true);
  assert.deepEqual(observed, [
    [`/root/${archivedChangePath}`, "directory:approved", 0o755, "after"],
    ["/root/app.txt", "proven-product", 0o644, "after"]
  ]);
  for (const path of ["../escape", "openspec/changes/archive/../change", "openspec/changes/archive//change"])
    assert.equal(verifyLandJournalOperation(context, state, { archivedChangePath: path }).reason,
      "invalid-archive-projection-path");
  assert.equal(verifyLandJournalOperation({ ...context, matches: () => false }, state,
    { archivedChangePath }).reason, "projection-mismatch:openspec/changes/change");
});

test("journal cleanup removes staged data, keeps the pre-Land backup, commits journals, and reports failures", () => {
  const noApply = cleanupLandJournalOperation({}, { workspace: {} });
  assert.deepEqual(noApply, { status: "not-needed" });

  const removed = [];
  const saved = [];
  const journal = { status: "applied", inFlightPaths: ["app.txt"] };
  const state = { id: "change", workspace: { apply: { transactionId: "tx" } } };
  const result = cleanupLandJournalOperation({
    transactionRoot: () => "/transaction",
    exists: (path) => path !== "/transaction/backup",
    remove: (...args) => removed.push(args),
    journalPath: () => "/journal", readJson: () => journal,
    now: () => "now", save: (value) => saved.push(value)
  }, state);
  assert.deepEqual(result, { status: "committed", transactionId: "tx" });
  assert.deepEqual(removed, [["/transaction/stage", { recursive: true }]],
    "the pre-Land backup is retained for an undo of the uncommitted Land");
  assert.equal(journal.status, "committed");
  assert.equal(journal.committedAt, "now");
  assert.equal("inFlightPaths" in journal, false);
  assert.equal(saved.length, 1);

  assert.deepEqual(cleanupLandJournalOperation({
    transactionRoot: () => "/transaction", exists: () => true,
    remove: () => { throw new Error("busy"); }, journalPath: () => "/journal"
  }, state), { status: "failed", transactionId: "tx", reason: "busy" });
});

// Undo of an archived, uncommitted Land: every path Land wrote must still hold
// exactly what Land wrote, or the undo refuses before any write.
function undoInputs(overrides = {}) {
  const state = {
    id: "change", status: "archived", archivedChangePath: "openspec/changes/archive/d-change",
    workspace: { mode: "worktree", baseHead: "base", apply: { transactionId: "tx" } },
    deliveryIntegrity: { entries: [
      { path: "openspec/changes/archive/d-change", identity: "directory:pkt" },
      { path: "openspec/specs/cap/spec.md", identity: "spec-after", mode: "100644" }
    ] }
  };
  const journal = { transactionId: "tx", entries: [
    { path: "a.txt", role: "code", before: "a0", after: "a1", beforeMode: 420, afterMode: 420 },
    { path: "new.txt", role: "code", before: null, after: "n1" },
    { path: "same.txt", role: "code", before: "s0", after: "s1" },
    { path: "openspec/changes/change", role: "change-artifacts", before: "p0", after: "p1" }
  ] };
  const target = { "a.txt": ["a1", 420], "new.txt": ["n1", 420], "same.txt": ["s0", 420] };
  const delivered = { "openspec/changes/archive/d-change": { identity: "directory:pkt" },
    "openspec/specs/cap/spec.md": { identity: "spec-after", mode: "100644" } };
  return {
    state, journal, specBefore: { cap: "spec before\n" }, headNow: "base", staged: [],
    observe: (path) => ({ identity: target[path]?.[0] ?? null, mode: target[path]?.[1] ?? null }),
    delivered: (path) => delivered[path] || { identity: null },
    sources: () => "staged",
    target, delivered_: delivered,
    ...overrides
  };
}

test("land undo plans a restore of every path still at Land's bytes", () => {
  const plan = landUndoPlan(undoInputs());
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(plan.code.map(({ entry, source }) => [entry.path, source]),
    [["a.txt", "staged"], ["new.txt", "remove"]], "already-reverted paths are skipped");
  assert.deepEqual(plan.specs, [{ path: "openspec/specs/cap/spec.md", before: "spec before\n" }]);
  assert.equal(plan.packet, "openspec/changes/archive/d-change");
});

test("land undo refuses a later edit, a moved HEAD, staged paths, and missing pre-Land bytes", () => {
  const edited = undoInputs();
  edited.target["a.txt"] = ["user", 420];
  edited.delivered_["openspec/specs/cap/spec.md"] = { identity: "spec-edited", mode: "100644" };
  assert.match(landUndoPlan(edited).refusals.join(" "),
    /changed after Land at: a\.txt, openspec\/specs\/cap\/spec\.md/);
  const modeOnly = undoInputs();
  modeOnly.target["a.txt"] = ["a1", 493];
  assert.match(landUndoPlan(modeOnly).refusals.join(" "), /changed after Land at: a\.txt/);
  assert.match(landUndoPlan(undoInputs({ headNow: "moved" })).refusals.join(" "),
    /HEAD moved since Land/);
  assert.match(landUndoPlan(undoInputs({ staged: ["a.txt"] })).refusals.join(" "),
    /staged in the Git index: a\.txt/);
  assert.match(landUndoPlan(undoInputs({ sources: () => null })).refusals.join(" "),
    /pre-Land bytes are not recorded for: a\.txt/);
  assert.match(landUndoPlan(undoInputs({ specBefore: null })).refusals.join(" "),
    /not recorded for: openspec\/specs\/cap\/spec\.md/);
  const unarchived = undoInputs();
  unarchived.state.status = "applied";
  assert.match(landUndoPlan(unarchived).refusals.join(" "), /is not archived/);
  const multi = undoInputs();
  multi.state.repositories = { root: {}, api: {} };
  assert.match(landUndoPlan(multi).refusals.join(" "), /single-repository/);
});
