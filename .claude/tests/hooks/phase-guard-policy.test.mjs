import assert from "node:assert/strict";
import test from "node:test";

import {
  looksMutatingShellCommand, shellMutationViolation
} from "../../hooks/phase-guard-policy.mjs";

test("shell mutation detection covers formatters, package scripts, and script runners", () => {
  for (const command of [
    "npx prettier --write src", "eslint src --fix", "ruff check --fix .",
    "ruff format .", "black .", "gofmt -w main.go", "cargo fmt",
    "npm run build", "pnpm exec prettier --write .", "yarn run generate",
    "bun run build", "sh generate.sh", "bash scripts/update.sh"
  ]) assert.equal(looksMutatingShellCommand(command), true, command);
  for (const command of ["git status", "node --test", "python3 -m unittest", "cat README.md"])
    assert.equal(looksMutatingShellCommand(command), false, command);
});

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
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "npm install"), "Build shell mutations must start inside the isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && npm install"), null);
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && echo x > /outside.txt"),
  "Build shell mutation contains an obvious path outside the isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && cp ../secret ./secret"),
  "Build shell mutation contains an obvious path outside the isolated workspace");
  for (const command of [
    "cd /workspace && cp $SOURCE ./source",
    "cd /workspace && cp $(pwd)/source ./source",
    "cd /workspace && cp `pwd`/source ./source",
    "cd /workspace && cp ~/source ./source"
  ]) assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, command), "Build shell mutation contains a dynamic path that cannot be proven isolated");
  assert.equal(shellMutationViolation("unknown", {}), null);
});
