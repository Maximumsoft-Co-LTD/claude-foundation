import assert from "node:assert/strict";
import test from "node:test";
import { mergeCoverageReports } from "../merge-coverage.mjs";

test("coverage merge preserves disjoint Istanbul files", () => {
  const first = { "/repo/first.js": { path: "/repo/first.js", s: { 0: 1 } } };
  const second = { "/repo/second.js": { path: "/repo/second.js", s: { 0: 2 } } };
  assert.deepEqual(mergeCoverageReports([first, second]), { ...first, ...second });
});

test("coverage merge rejects duplicate paths instead of replacing evidence", () => {
  assert.throws(() => mergeCoverageReports([
    { "/repo/app.js": { s: { 0: 1 } } },
    { "/repo/app.js": { s: { 0: 0 } } }
  ]), /appears in more than one report/);
});
