import assert from "node:assert/strict";
import test from "node:test";

import { shellMutationViolation } from "../../hooks/phase-guard-policy.mjs";

test("shell mutation policy blocks read-only lifecycle phases", () => {
  assert.equal(shellMutationViolation("change", {}),
    "Change cannot run mutating shell commands");
  assert.equal(shellMutationViolation("prove", {}),
    "Prove cannot run mutating shell commands");
});

test("shell mutation policy requires Land transaction authority", () => {
  assert.equal(shellMutationViolation("land", {}),
    "Land shell mutations require the runtime transaction marker");
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "0"
  }), "Land shell mutations require the runtime transaction marker");
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "1"
  }), null);
});

test("shell mutation policy requires an isolated Build workspace", () => {
  assert.equal(shellMutationViolation("build", {}),
    "Build shell mutations require an isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }), null);
  assert.equal(shellMutationViolation("unknown", {}), null);
});
