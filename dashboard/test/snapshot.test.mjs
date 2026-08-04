import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  assert.equal(snapshot.schemaVersion, 1);
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

test("snapshot never projects prompt or provider payload content", () => {
  const serialized = JSON.stringify(buildDashboardSnapshot(fixture()));
  assert.equal(serialized.includes("must-never-leave-the-machine"), false);
  assert.equal(serialized.includes("private provider output"), false);
});
