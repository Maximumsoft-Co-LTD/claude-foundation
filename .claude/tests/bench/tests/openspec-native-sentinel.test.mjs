import assert from "node:assert/strict";
import test from "node:test";

import { runDeterministicSentinel } from "../openspec-native/sentinel.mjs";

test("release sentinel freezes and passes every workload without model spend", () => {
  const report = runDeterministicSentinel();
  assert.equal(report.protocol, "foundation-deterministic-sentinel-v1");
  assert.equal(report.zeroModelSpend, true);
  assert.equal(report.status, "pass");
  assert.equal(report.scenarios.length, 7);
  assert.ok(report.scenarios.every((row) => row.fixtureFrozen && row.status === "pass"));
  assert.match(report.matrixDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.commandOutputDigest, /^sha256:[a-f0-9]{64}$/);
});
