import assert from "node:assert/strict";
import test from "node:test";

import { npmLockfileConsistency } from "../runtime/evidence/npm-lockfile-check.mjs";

test("npm lockfile consistency accepts a synchronized root package", () => {
  assert.deepEqual(npmLockfileConsistency({
    name: "demo", version: "1.0.0", dependencies: { alpha: "^1.0.0" }
  }, {
    lockfileVersion: 3,
    packages: { "": { name: "demo", version: "1.0.0", dependencies: { alpha: "^1.0.0" } } }
  }), []);
});

test("npm lockfile consistency rejects stale identity and dependencies", () => {
  const issues = npmLockfileConsistency({
    name: "new-name", private: true, devDependencies: { beta: "2.0.0" }
  }, {
    lockfileVersion: 3,
    packages: { "": { name: "old-name", devDependencies: { stale: "1.0.0" } } }
  });
  assert.ok(issues.some((issue) => issue.includes("package name")));
  assert.ok(issues.some((issue) => issue.includes("devDependencies.beta")));
  assert.ok(issues.some((issue) => issue.includes("devDependencies.stale")));
});
