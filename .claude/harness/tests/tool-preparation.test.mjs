import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExecutionPreparationReady,
  ensureProjectOpenSpec,
  executionPreparationValue,
  foundationToolPaths
} from "../runtime/core/tool-preparation.mjs";
import { retryFailedSandboxSetups } from
  "../runtime/workflow/sandbox-runtime.mjs";
import {
  executableIdentity, gitIndexIdentity, memoizeByGitIndex
} from "../runtime/core/tool-identity.mjs";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stableHash = (value) => JSON.stringify(value);

test("tool paths are project-local and ordered before ambient PATH", () => {
  assert.deepEqual(foundationToolPaths("/repo", (path) =>
    path.endsWith("node_modules/.bin")), [
    "/repo/.foundation/tools/node_modules/.bin",
    "/repo/node_modules/.bin"
  ]);
});

test("OpenSpec preparation installs locally once and verifies the result", () => {
  let ready = false;
  const calls = [];
  const result = ensureProjectOpenSpec({
    root: "/repo",
    status: () => ready
      ? { level: "ok", version: "1.7.0", detail: "1.7.0" }
      : { level: "error", version: null, detail: "missing" },
    prependPath: () => {},
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      ready = true;
      return { status: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(result.source, ".foundation/tools");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npm");
  assert(calls[0].args.includes("/repo/.foundation/tools"));
  assert(calls[0].args.includes("@fission-ai/openspec@1.7.0"));
});

test("preparation reuses identity and reports repository setup as Harness work", () => {
  const input = {
    id: "change-a",
    state: {
      revision: 1,
      workspace: {
        path: "/sandbox", baseHead: "base",
        setup: { status: "failed", exitCode: 1 }
      }
    },
    repositories: [{ id: "root", mode: "write", setupCommand: "npm ci" }],
    providers: [{ id: "test", adapter: "command", command: "npm test" }],
    openSpec: { level: "ok", version: "1.7.0", source: "path" },
    stableHash,
    now: () => "2026-09-05T00:00:00.000Z"
  };
  const failed = executionPreparationValue(input);
  assert.equal(failed.status, "REPAIR_REQUIRED");
  assert.equal(failed.issues[0].owner, "harness");
  assert.throws(() => assertExecutionPreparationReady(failed), (error) =>
    error.owner === "harness" && error.code === "EXECUTION_PREPARATION_FAILED");

  input.state.workspace.setup.status = "ok";
  const ready = executionPreparationValue(input);
  const reused = executionPreparationValue({ ...input, prior: ready });
  assert.equal(ready.status, "READY");
  assert.equal(reused.reused, true);
});

test("preparation observes the root setup record even with a repository row", () => {
  const plan = executionPreparationValue({
    id: "change-root",
    state: {
      workspace: { path: "/sandbox", setup: { status: "failed" } },
      repositories: { root: { path: "/sandbox", access: "write" } }
    },
    repositories: [{ id: "root", mode: "write", setupCommand: "npm ci" }],
    openSpec: { level: "ok", version: "1.7.0" },
    stableHash
  });
  assert.equal(plan.status, "REPAIR_REQUIRED");
  assert.equal(plan.repositories[0].setupStatus, "failed");
});

test("failed repository setup is retried without repeating ready siblings", () => {
  const state = {
    workspace: { path: "/root-box", setup: { status: "failed" } },
    repositories: {
      root: { path: "/root-box", access: "write" },
      api: { path: "/api-box", access: "write", setup: { status: "failed" } },
      web: { path: "/web-box", access: "write", setup: { status: "ok" } }
    }
  };
  const calls = [];
  let saves = 0;
  const attempted = retryFailedSandboxSetups({
    loadRuntime: () => state,
    saveRuntime: () => { saves += 1; },
    selectedRepositories: () => [
      { id: "root", setupCommand: "root setup" },
      { id: "api", setupCommand: "api setup" },
      { id: "web", setupCommand: "web setup" }
    ],
    policy: () => ({ sandbox: { setupTimeoutMs: 50 } }),
    runSetupCommand: (record, command) => {
      calls.push(command);
      record.setup.status = "ok";
    },
    git: () => ({ status: 0, stdout: "" })
  }, "change-a", state);
  assert.deepEqual(attempted, ["root", "api"]);
  assert.deepEqual(calls, ["root setup", "api setup"]);
  assert.equal(saves, 1);
});

test("Git index queries are reused only while the index is unchanged", () => {
  const workspace = mkdtempSync(join(tmpdir(), "foundation-index-memo-"));
  const run = (...args) => spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
  try {
    run("init", "-q");
    writeFileSync(join(workspace, "a.txt"), "a\n");
    writeFileSync(join(workspace, "b.txt"), "b\n");
    run("add", "a.txt");
    let computed = 0;
    const tracked = (rel) => memoizeByGitIndex(workspace, `tracked:${rel}`, () => {
      computed += 1;
      return run("ls-files", "--error-unmatch", "--", rel).status === 0;
    });
    assert.equal(tracked("b.txt"), false);
    assert.equal(tracked("b.txt"), false);
    assert.equal(computed, 1, "an unchanged index answers from the memo");
    run("add", "b.txt");
    assert.equal(tracked("b.txt"), true, "an index write invalidates the memo");
    assert.equal(computed, 2);
    assert.equal(gitIndexIdentity(workspace, { GIT_INDEX_FILE: "/elsewhere" }), null,
      "an overridden index is never identified");
    assert.equal(gitIndexIdentity(join(workspace, "missing")), null);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executable identity follows content, not the path", () => {
  const dir = mkdtempSync(join(tmpdir(), "foundation-exe-identity-"));
  const env = { PATH: dir };
  try {
    const exe = join(dir, "tool");
    writeFileSync(exe, "#!/bin/sh\necho 1\n");
    chmodSync(exe, 0o755);
    const first = executableIdentity("tool", env, dir);
    assert.ok(first);
    assert.equal(executableIdentity("tool", env, dir), first);
    writeFileSync(exe, "#!/bin/sh\necho 2\n");
    assert.notEqual(executableIdentity("tool", env, dir), first);
    writeFileSync(join(dir, "package.json"), "{\"version\":\"1.0.0\"}");
    const withManifest = executableIdentity("tool", env, dir);
    writeFileSync(join(dir, "package.json"), "{\"version\":\"1.0.1\"}");
    assert.notEqual(executableIdentity("tool", env, dir), withManifest,
      "a package version change is a different CLI");
    assert.equal(executableIdentity("absent-tool", env, dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
