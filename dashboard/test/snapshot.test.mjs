import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboardSnapshot } from "../snapshot.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cf-dashboard-snapshot-"));
  mkdirSync(join(root, ".foundation", "runtime"), { recursive: true });
  mkdirSync(join(root, ".foundation", "receipts", "safe-change"), { recursive: true });
  writeFileSync(join(root, ".foundation", "runtime", "safe-change.json"), JSON.stringify({
    version: 2, id: "safe-change", schema: "foundation-standard", status: "building",
    contractRevision: 3, size: "M", createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z", prompt: "must-never-leave-the-machine",
    blockers: [{ code: "waiting", reason: "provider unavailable" }],
    budget: { lifetime: { usedRequests: 2, usedTokens: 100 },
      window: { id: "run-1", usedRequests: 1, usedTokens: 40, targetRequests: 4, targetTokens: 1000 } }
  }));
  writeFileSync(join(root, ".foundation", "runtime", "corrupt.json"), "{not-json");
  writeFileSync(join(root, ".foundation", "receipts", "safe-change", "test.json"),
    JSON.stringify({ status: "pass", output: "private provider output" }));
  return root;
}

test("projects current runtime into the stable dashboard schema", () => {
  const snapshot = buildDashboardSnapshot(fixture(), { generatedAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(snapshot.schemaVersion, 2);
  const protocol = JSON.parse(readFileSync(new URL("../../.claude/harness/protocol.json", import.meta.url), "utf8"));
  assert.equal(String(snapshot.schemaVersion), protocol.dashboardSnapshotSchema);
  assert.equal(snapshot.sourceSchema, "foundation-runtime-v2");
  assert.equal(snapshot.changes.length, 1);
  assert.equal(snapshot.changes[0].phase, "build");
  assert.equal(snapshot.runs[0].id, "safe-change");
  assert.equal(snapshot.blockers[0].code, "waiting");
  assert.equal(snapshot.budgets["safe-change"].window.usedTokens, 40);
  assert.deepEqual(snapshot.evidence["safe-change"].providers, [{ provider: "test", status: "pass" }]);
  assert.equal(snapshot.diagnostics.malformedStates, 1);
  assert.equal(snapshot.generatedAt, "2026-08-04T00:00:00.000Z");
});

test("operation timing merges overlaps, omits unknown phases, and keeps telemetry private", () => {
  const root = fixture();
  const dir = join(root, ".foundation", "logs", "safe-change");
  mkdirSync(dir, { recursive: true });
  const row = (phase, start, end) => JSON.stringify({ phase,
    startedAt: new Date(start).toISOString(), finishedAt: new Date(end).toISOString(),
    command: "private-command" });
  writeFileSync(join(dir, "operations.jsonl"), [
    row("build", 1000, 4000), row("build", 2000, 3000), row("build", 3000, 5000),
    row("prove", 6000, 6500), row("land", 9000, 8000), row("unknown", 1000, 9999),
    'null', '{broken', JSON.stringify({ phase: "change" })
  ].join("\n"));
  const snapshot = buildDashboardSnapshot(root);
  assert.deepEqual(snapshot.runs[0].operationMs, { build: 4000, prove: 500 });
  assert.equal(JSON.stringify(snapshot).includes("private-command"), false);
});

test("sparse valid runtime states project stable defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-dashboard-snapshot-sparse-"));
  const runtimeDir = join(root, ".foundation", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, "sparse.json"), JSON.stringify({
    id: "sparse", revision: 7, workspace: {}
  }));

  const snapshot = buildDashboardSnapshot(root);
  assert.deepEqual(snapshot.changes[0], {
    id: "sparse", schema: "unknown", status: "unknown", phase: "change",
    revision: 7, updatedAt: null, blockerCount: 0, evidenceStatus: "missing"
  });
  assert.equal(snapshot.runs[0].type, "unknown");
  assert.equal(snapshot.runs[0].lifecycleStatus, "unknown");
  assert.equal(snapshot.runs[0].branch, snapshot.project.branch);
  assert.equal(snapshot.runs[0].owner, snapshot.project.owner);
  assert.equal(snapshot.runs[0].ownerEmail, snapshot.project.ownerEmail);
  assert.equal(snapshot.runs[0].size, "");
  assert.equal(snapshot.runs[0].started, 0);
  assert.equal(snapshot.runs[0].finished, 0);
  assert.equal(snapshot.runs[0].done, false);
});

test("snapshot never projects prompt or provider payload content", () => {
  const serialized = JSON.stringify(buildDashboardSnapshot(fixture()));
  assert.equal(serialized.includes("must-never-leave-the-machine"), false);
  assert.equal(serialized.includes("private provider output"), false);
});

test("a live failing provider outranks a stale passing proof.json", () => {
  // `proof.json` is only ever written with status "pass", and only two code
  // paths in the runtime ever delete it (evidence-contract upgrade, base-move
  // sync) — an ordinary edit-then-reprove cycle that fails a provider check
  // leaves a prior successful proof.json on disk untouched. The projection
  // must not let that stale certificate outrank a provider that currently
  // reports "fail".
  const root = mkdtempSync(join(tmpdir(), "cf-dashboard-snapshot-"));
  mkdirSync(join(root, ".foundation", "runtime"), { recursive: true });
  mkdirSync(join(root, ".foundation", "receipts", "regressed-change"), { recursive: true });
  writeFileSync(join(root, ".foundation", "runtime", "regressed-change.json"), JSON.stringify({
    id: "regressed-change", schema: "foundation-standard", status: "building",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z"
  }));
  writeFileSync(join(root, ".foundation", "receipts", "regressed-change", "proof.json"),
    JSON.stringify({ status: "pass" }));
  writeFileSync(join(root, ".foundation", "receipts", "regressed-change", "tests.json"),
    JSON.stringify({ status: "fail" }));
  const snapshot = buildDashboardSnapshot(root);
  assert.equal(snapshot.evidence["regressed-change"].status, "failing");
});

test("a changed non-failing receipt makes an old proof partial until re-proven", () => {
  const root = fixture();
  const dir = join(root, ".foundation", "receipts", "safe-change");
  const receiptPath = join(dir, "test.json");
  const original = JSON.stringify({ status: "pass", output: "private provider output" });
  const originalDigest = createHash("sha256").update(original).digest("hex");
  writeFileSync(join(dir, "proof.json"), JSON.stringify({
    status: "pass", receipts: [{ provider: "test", sha256: originalDigest }],
    excludedReceipts: []
  }));
  assert.equal(buildDashboardSnapshot(root).evidence["safe-change"].status, "pass");

  writeFileSync(receiptPath, JSON.stringify({ status: "pass", output: "new run" }));
  assert.equal(buildDashboardSnapshot(root).evidence["safe-change"].status, "partial");
});

test("receipt projection ignores malformed files and honors explicit proof exclusions", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-dashboard-snapshot-"));
  const runtimeDir = join(root, ".foundation", "runtime");
  const receiptDir = join(root, ".foundation", "receipts", "mixed-change");
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(receiptDir, { recursive: true });
  mkdirSync(join(receiptDir, "directory.json"));
  for (const id of ["mixed-change", "no-receipts", "empty-receipts"]) {
    writeFileSync(join(runtimeDir, `${id}.json`), JSON.stringify({
      id, schema: "foundation-standard", status: "building"
    }));
  }
  mkdirSync(join(root, ".foundation", "receipts", "empty-receipts"), { recursive: true });

  writeFileSync(join(receiptDir, "notes.txt"), "ignored");
  writeFileSync(join(receiptDir, "broken.json"), "{not-json");
  writeFileSync(join(receiptDir, "null.json"), "null");
  const testReceipt = JSON.stringify({ status: "pass" });
  writeFileSync(join(receiptDir, "test.json"), testReceipt);
  writeFileSync(join(receiptDir, "optional.json"), JSON.stringify({}));
  writeFileSync(join(receiptDir, "proof.json"), JSON.stringify({
    status: "pass",
    receipts: [{
      provider: "test", sha256: createHash("sha256").update(testReceipt).digest("hex")
    }],
    excludedReceipts: [{ provider: "optional" }]
  }));

  const snapshot = buildDashboardSnapshot(root);
  assert.equal(snapshot.evidence["mixed-change"].status, "pass");
  assert.deepEqual(snapshot.evidence["mixed-change"].providers, [
    { provider: "optional", status: "unknown" },
    { provider: "test", status: "pass" }
  ]);
  assert.deepEqual(snapshot.evidence["no-receipts"], { status: "missing", providers: [] });
  assert.deepEqual(snapshot.evidence["empty-receipts"], { status: "missing", providers: [] });
});

test("snapshot bounds blocker variants and nulls malformed budget fields", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-dashboard-snapshot-"));
  const runtimeDir = join(root, ".foundation", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const repeated = Array.from({ length: 55 }, (_, index) => ({ code: `code-${index}` }));
  writeFileSync(join(runtimeDir, "edge.json"), JSON.stringify({
    id: "edge", schema: "foundation-standard", status: "building",
    blockers: ["prose", { id: "by-id" }, {}, null, 7, ...repeated],
    pendingBlockers: "not-an-array",
    land: { blockers: [{ code: "land-code" }] },
    budget: {
      lifetime: { usedRequests: "many", usedTokens: 0 },
      window: {
        id: 7, usedRequests: null, usedTokens: 4,
        targetRequests: "ten", targetTokens: 100
      }
    }
  }));
  writeFileSync(join(runtimeDir, "invalid-budget.json"), JSON.stringify({
    id: "invalid-budget", schema: "foundation-standard", status: "change", budget: "invalid"
  }));
  writeFileSync(join(runtimeDir, "sparse-budget.json"), JSON.stringify({
    id: "sparse-budget", schema: "foundation-standard", status: "change", budget: {}
  }));

  const snapshot = buildDashboardSnapshot(root);
  assert.deepEqual(snapshot.budgets.edge, {
    lifetime: { usedRequests: null, usedTokens: 0 },
    window: {
      id: null, usedRequests: null, usedTokens: 4,
      targetRequests: null, targetTokens: 100
    }
  });
  assert.equal(Object.hasOwn(snapshot.budgets, "invalid-budget"), false);
  assert.deepEqual(snapshot.budgets["sparse-budget"], {
    lifetime: { usedRequests: null, usedTokens: null },
    window: {
      id: null, usedRequests: null, usedTokens: null,
      targetRequests: null, targetTokens: null
    }
  });
  assert.equal(snapshot.changes.find((change) => change.id === "edge").blockerCount, 50);
  assert.deepEqual(snapshot.blockers.slice(0, 3).map((item) => item.code),
    ["runtime-blocker", "by-id", "runtime-blocker"]);
  assert.equal(snapshot.blockers.some((item) => item.code === "land-code"), false,
    "the global cap applies before later blocker sources");
});
