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
  createLandJournal,
  landEntryNoOp
} from "../runtime/workflow/land-journal.mjs";

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
