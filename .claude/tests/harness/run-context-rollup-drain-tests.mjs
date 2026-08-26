// Archive-time context-event drain in createTelemetryRuntime().recordContextMetric:
// when more than 1000 pending context-event files exist, the oldest 500 are
// folded into context-rollup.json and removed. Rows with junk or missing
// bytes/kind must be excluded from the aggregates but still removed from disk;
// the drain must be idempotent, merge a pre-existing rollup, count zero-byte
// rows, and survive a corrupt pre-existing rollup — the pinned defect: a junk
// counter concatenated or NaN-poisoned the persisted rollup, and a missing
// byKind threw inside the drain loop where the outer catch swallowed it, so
// every later drain failed silently while pending files grew past the
// threshold forever.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createTelemetryRuntime } from "../../harness/runtime/observability/telemetry-runtime.mjs";

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const ID = "test-change";

function freshRuntime() {
  const root = mkdtempSync(join(tmpdir(), "context-rollup-drain-"));
  const logs = join(root, "logs");
  const runtime = createTelemetryRuntime({
    root,
    logs,
    contextEventSchemaVersion: 1,
    stableHash,
    now: () => new Date().toISOString(),
    readJson,
    writeJson,
    readJsonLines: () => [],
    readJsonLinesTolerant: () => [],
    loadRuntime: () => ({}),
    saveRuntime: () => {},
    synchronizeBudgetUsage: () => {},
    reportBudget: () => {},
    snapshotPath: () => join(root, "missing-snapshot.json"),
    parseFlags: () => ({ flags: {}, rest: [] }),
    activeChangePath: () => root,
    repositoryById: () => {},
    taskBlocks: () => [],
    fail: (message) => { throw new Error(message); }
  });
  return { logs, runtime, dir: join(logs, ID, "context-events") };
}

// Seed `count` pending event files whose names sort before anything
// recordContextMetric writes (its names start with the current Date.now()).
// `make(i)` returns the row content, or a raw string for unparseable files.
function seed(dir, count, make) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const row = make(i);
    const name = `0000000000000-seed-${String(i).padStart(6, "0")}.json`;
    writeFileSync(join(dir, name),
      typeof row === "string" ? row : `${JSON.stringify(row)}\n`);
  }
}

function pendingCount(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
}

test("small event sets stay pending without creating a rollup", () => {
  const { logs, runtime, dir } = freshRuntime();
  runtime.recordContextMetric(ID, "single", 3);
  assert.equal(pendingCount(dir), 1);
  assert.equal(existsSync(join(logs, ID, "context-rollup.json")), false);
});

test("a fresh rollup lock defers the drain without dropping events", () => {
  const { logs, runtime, dir } = freshRuntime();
  seed(dir, 1000, () => ({ kind: "pending", bytes: 1 }));
  const lockPath = join(logs, ID, "context-rollup.lock");
  writeFileSync(lockPath, "busy\n");
  runtime.recordContextMetric(ID, "trigger", 2);
  assert.equal(pendingCount(dir), 1001);
  assert.equal(existsSync(join(logs, ID, "context-rollup.json")), false);
});

test("a stale rollup lock is reclaimed before draining", () => {
  const { logs, runtime, dir } = freshRuntime();
  seed(dir, 1000, () => ({ kind: "recovered", bytes: 1 }));
  const lockPath = join(logs, ID, "context-rollup.lock");
  writeFileSync(lockPath, "stale\n");
  utimesSync(lockPath, new Date(0), new Date(0));
  runtime.recordContextMetric(ID, "trigger", 2);
  assert.equal(pendingCount(dir), 501);
  assert.equal(readJson(join(logs, ID, "context-rollup.json")).count, 500);
});

test("context telemetry failures remain non-blocking and debug-visible", () => {
  const root = mkdtempSync(join(tmpdir(), "context-rollup-failure-"));
  const logs = join(root, "logs");
  writeFileSync(logs, "not-a-directory\n");
  const runtime = createTelemetryRuntime({
    root, logs, contextEventSchemaVersion: 1, stableHash,
    now: () => "2026-08-27T00:00:00.000Z", readJson, writeJson,
    readJsonLines: () => [], readJsonLinesTolerant: () => [],
    loadRuntime: () => ({}), saveRuntime: () => {},
    synchronizeBudgetUsage: () => {}, reportBudget: () => {},
    snapshotPath: () => join(root, "snapshot.json"),
    parseFlags: () => ({ flags: {}, rest: [] }), activeChangePath: () => root,
    repositoryById: () => {}, taskBlocks: () => [],
    fail: (message) => { throw new Error(message); }
  });
  const priorDebug = process.env.FOUNDATION_TELEMETRY_DEBUG;
  const priorError = console.error;
  const warnings = [];
  process.env.FOUNDATION_TELEMETRY_DEBUG = "1";
  console.error = (message) => warnings.push(String(message));
  try {
    assert.doesNotThrow(() => runtime.recordContextMetric(ID, "unavailable", 1));
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.FOUNDATION_TELEMETRY_DEBUG;
    else process.env.FOUNDATION_TELEMETRY_DEBUG = priorDebug;
  }
  assert.match(warnings[0], /context telemetry unavailable/);
});

test("junk and missing rows are excluded but their files are drained", () => {
  const { logs, runtime, dir } = freshRuntime();
  // Oldest 500 files: indices 0..499. Valid rows only at even indices < 20;
  // the rest of the first 500 are junk of every observed shape.
  seed(dir, 1000, (i) => {
    if (i >= 500) return { kind: "late", bytes: 1 };
    if (i < 20 && i % 2 === 0) return { kind: "good", bytes: 10 };
    const junk = [
      { bytes: 5 },                        // missing kind
      { kind: "junk" },                    // missing bytes
      { kind: "junk", bytes: "garbage" },  // non-numeric string
      { kind: "junk", bytes: -4 },         // negative measurement
      { kind: "junk", bytes: true },       // boolean coercion trap
      { kind: "junk", bytes: [7] },        // array coercion trap
      { kind: "junk", bytes: null },
      { kind: "", bytes: 3 },              // blank kind is falsy
      "{ not json at all",                 // unparseable file
      { kind: "junk", bytes: "" }          // blank string
    ];
    return junk[i % junk.length];
  });
  runtime.recordContextMetric(ID, "trigger", 2);
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(rollup.count, 10, "only the 10 valid rows count");
  assert.equal(rollup.totalBytes, 100);
  assert.deepEqual(Object.keys(rollup.byKind), ["good"]);
  assert.deepEqual(rollup.byKind.good, { count: 10, totalBytes: 100, maxBytes: 10 });
  // 1001 files existed after the trigger write; the oldest 500 — junk
  // included — must be gone regardless of validity.
  assert.equal(pendingCount(dir), 501, "all 500 oldest files removed");
  const remaining = readdirSync(dir).filter((n) => n.startsWith("0000000000000-"));
  assert.equal(remaining.length, 500);
  assert.ok(remaining.every((n) => Number(n.split("-")[2].replace(".json", "")) >= 500),
    "every drained file was among the oldest 500");
});

test("byKind count/totalBytes/maxBytes across multiple kinds", () => {
  const { logs, runtime, dir } = freshRuntime();
  seed(dir, 1000, (i) => {
    if (i >= 500) return { kind: "late", bytes: 1 };
    if (i < 100) return { kind: "alpha", bytes: i };          // 0..99
    if (i < 150) return { kind: "beta", bytes: 1000 + i };    // 50 rows
    return { kind: "gamma", bytes: 7 };                       // 350 rows
  });
  runtime.recordContextMetric(ID, "trigger", 2);
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(rollup.count, 500);
  const alphaTotal = (99 * 100) / 2;
  const betaTotal = Array.from({ length: 50 }, (_, i) => 1100 + i)
    .reduce((sum, value) => sum + value, 0);
  assert.deepEqual(rollup.byKind.alpha, { count: 100, totalBytes: alphaTotal, maxBytes: 99 });
  assert.deepEqual(rollup.byKind.beta, { count: 50, totalBytes: betaTotal, maxBytes: 1149 });
  assert.deepEqual(rollup.byKind.gamma, { count: 350, totalBytes: 7 * 350, maxBytes: 7 });
  assert.equal(rollup.totalBytes, alphaTotal + betaTotal + 7 * 350);
});

test("repeated drains never recount a drained event", () => {
  const { logs, runtime, dir } = freshRuntime();
  seed(dir, 1000, () => ({ kind: "steady", bytes: 3 }));
  runtime.recordContextMetric(ID, "trigger", 2);   // drains oldest 500
  const first = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(first.count, 500);
  assert.equal(first.totalBytes, 1500);
  // Refill past the threshold and drain again: the leftovers plus 500 fresh
  // rows. The second drain takes the oldest 500 of those; nothing from the
  // first drain can reappear because its files were removed.
  for (let i = 0; i < 500; i += 1)
    writeFileSync(join(dir, `0000000000001-refill-${String(i).padStart(6, "0")}.json`),
      `${JSON.stringify({ kind: "steady", bytes: 3 })}\n`);
  runtime.recordContextMetric(ID, "trigger", 2);
  const second = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(second.count, 1000, "500 + 500, never 500 counted twice");
  assert.equal(second.totalBytes, 3000);
  assert.deepEqual(second.byKind.steady, { count: 1000, totalBytes: 3000, maxBytes: 3 });
});

test("pre-existing context-rollup.json merges additively", () => {
  const { logs, runtime, dir } = freshRuntime();
  writeJson(join(logs, ID, "context-rollup.json"), {
    version: 1,
    changeId: ID,
    count: 40,
    totalBytes: 4000,
    byKind: {
      old: { count: 30, totalBytes: 3000, maxBytes: 200 },
      shared: { count: 10, totalBytes: 1000, maxBytes: 500 }
    }
  });
  seed(dir, 1000, (i) => (i >= 500
    ? { kind: "late", bytes: 1 }
    : { kind: "shared", bytes: 20 }));
  runtime.recordContextMetric(ID, "trigger", 2);
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(rollup.count, 540);
  assert.equal(rollup.totalBytes, 4000 + 500 * 20);
  assert.deepEqual(rollup.byKind.old, { count: 30, totalBytes: 3000, maxBytes: 200 });
  assert.deepEqual(rollup.byKind.shared,
    { count: 510, totalBytes: 1000 + 500 * 20, maxBytes: 500 });
});

test("zero-byte rows count as measured zeros", () => {
  const { logs, runtime, dir } = freshRuntime();
  seed(dir, 1000, (i) => (i >= 500
    ? { kind: "late", bytes: 1 }
    : (i < 490 ? { kind: "empty", bytes: 0 } : { kind: "empty", bytes: "0" })));
  runtime.recordContextMetric(ID, "trigger", 2);
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(rollup.count, 500, "zero and '0' are measurements");
  assert.equal(rollup.totalBytes, 0);
  assert.deepEqual(rollup.byKind.empty, { count: 500, totalBytes: 0, maxBytes: 0 });
});

test("corrupt pre-existing rollup neither crashes nor poisons the drain", () => {
  const { logs, runtime, dir } = freshRuntime();
  writeJson(join(logs, ID, "context-rollup.json"), {
    version: 1,
    changeId: ID,
    count: "5",                        // numeric string: += would concatenate
    totalBytes: undefined,             // missing: += would produce NaN
    byKind: {
      poisoned: { count: "x", totalBytes: 10, maxBytes: 10 },
      kept: { count: 2, totalBytes: 8, maxBytes: 6 }
    }
  });
  seed(dir, 1000, (i) => (i >= 500
    ? { kind: "late", bytes: 1 }
    : { kind: "poisoned", bytes: 4 }));
  runtime.recordContextMetric(ID, "trigger", 2);
  assert.equal(pendingCount(dir), 501, "drain completed despite corrupt rollup");
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(typeof rollup.count, "number", "count stays numeric");
  assert.equal(rollup.count, 505, "numeric string counter recovered as 5");
  assert.equal(typeof rollup.totalBytes, "number", "totalBytes stays numeric");
  assert.equal(rollup.totalBytes, 2000, "missing counter restarts at zero");
  assert.deepEqual(rollup.byKind.kept, { count: 2, totalBytes: 8, maxBytes: 6 });
  assert.deepEqual(rollup.byKind.poisoned,
    { count: 500, totalBytes: 2000, maxBytes: 4 },
    "junk archived row is replaced by the fresh measurements");
});

test("rollup without byKind does not abort mid-drain", () => {
  const { logs, runtime, dir } = freshRuntime();
  writeJson(join(logs, ID, "context-rollup.json"),
    { version: 1, changeId: ID, count: 3, totalBytes: 30 });
  seed(dir, 1000, (i) => (i >= 500
    ? { kind: "late", bytes: 1 }
    : { kind: "fresh", bytes: 2 }));
  runtime.recordContextMetric(ID, "trigger", 2);
  assert.equal(pendingCount(dir), 501,
    "all 500 oldest files drained, none stranded by a thrown merge");
  const rollup = readJson(join(logs, ID, "context-rollup.json"));
  assert.equal(rollup.count, 503);
  assert.equal(rollup.totalBytes, 1030);
  assert.deepEqual(rollup.byKind.fresh, { count: 500, totalBytes: 1000, maxBytes: 2 });
});
