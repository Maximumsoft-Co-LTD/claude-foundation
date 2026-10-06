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

// A failed setup the harness cannot finish is handed to the agent with the
// exact command, directory, and output, never a bare diagnostic loop.
test("a failed repository setup carries its handoff into the advance repair", async () => {
  const { advanceFailureAction } = await import("../runtime/workflow/advance-runtime.mjs");
  const plan = executionPreparationValue({
    id: "demo",
    state: { workspace: { path: "/ws" }, repositories: { root: {
      path: "/ws", setup: { status: "failed", exitCode: 1, logTail: "exit 1\nnpm ERR! missing lockfile" }
    } } },
    repositories: [{ id: "root", setupCommand: "npm ci" }],
    openSpec: { level: "ok" }, stableHash
  });
  assert.deepEqual(plan.issues[0].handoff, {
    step: "sandbox setup for repository 'root'", command: "npm ci", cwd: "/ws",
    log: "exit 1\nnpm ERR! missing lockfile"
  });
  let error;
  try { assertExecutionPreparationReady(plan); } catch (caught) { error = caught; }
  const repair = advanceFailureAction("demo", error, { stage: "build", through: "proven" });
  assert.equal(repair.action, "REPAIR");
  assert.equal(repair.owner, "agent");
  assert.equal(repair.command, "npm ci");
  assert.equal(repair.handoff.cwd, "/ws");
  assert.match(repair.instruction, /could not finish sandbox setup/);
  assert.equal(repair.recovery.type, "HANDOFF");
});

// With no configured setup the harness runs the detected lockfile install
// itself; a failure is the same agent handoff a configured command gets.
test("a failed detected lockfile install is planned and handed off like configured setup", async () => {
  const { advanceFailureAction } = await import("../runtime/workflow/advance-runtime.mjs");
  const state = { workspace: { path: "/ws", setup: {
    command: "pnpm install --frozen-lockfile", status: "failed", exitCode: 127,
    source: "lockfile", lockfile: "pnpm-lock.yaml", cwd: "/ws",
    logTail: "exit 127\nsh: pnpm: not found"
  } } };
  const plan = executionPreparationValue({
    id: "demo", state, repositories: [{ id: "root", mode: "write" }],
    openSpec: { level: "ok" }, stableHash
  });
  assert.equal(plan.repositories[0].setupCommand, "pnpm install --frozen-lockfile");
  assert.equal(plan.repositories[0].setupSource, "lockfile");
  assert.equal(plan.status, "REPAIR_REQUIRED");
  let error;
  try { assertExecutionPreparationReady(plan); } catch (caught) { error = caught; }
  const repair = advanceFailureAction("demo", error, { stage: "build", through: "proven" });
  assert.equal(repair.action, "REPAIR");
  assert.equal(repair.owner, "agent");
  assert.equal(repair.command, "pnpm install --frozen-lockfile");
  assert.equal(repair.handoff.cwd, "/ws");
  assert.match(repair.handoff.log, /pnpm: not found/);

  const calls = [];
  const retried = retryFailedSandboxSetups({
    loadRuntime: () => state, saveRuntime: () => {},
    selectedRepositories: () => [{ id: "root" }],
    policy: () => ({ sandbox: { setupTimeoutMs: 50 } }),
    runSetupCommand: (record, command) => {
      calls.push(command);
      record.setup = { command, status: "ok", exitCode: 0 };
    }
  }, "demo", state);
  assert.deepEqual(retried, ["root"]);
  assert.deepEqual(calls, ["pnpm install --frozen-lockfile"]);
  assert.equal(state.workspace.setup.source, "lockfile",
    "a retried detected install stays recorded as detected");

  state.workspace.setup.status = "failed";
  retryFailedSandboxSetups({
    loadRuntime: () => state, saveRuntime: () => {},
    selectedRepositories: () => [{ id: "root" }],
    policy: () => ({ sandbox: { installDependencies: false } }),
    runSetupCommand: () => { throw new Error("opted out"); }
  }, "demo", state);
  assert.equal(state.workspace.setup, undefined,
    "opting out withdraws a failed detected install instead of blocking Build");
});

test("a failed OpenSpec preparation hands its install command to the agent", () => {
  assert.throws(() => ensureProjectOpenSpec({
    root: "/project", status: () => ({ level: "error", detail: "missing" }),
    spawn: () => ({ status: 1, stderr: "ENOTFOUND registry.npmjs.org" }),
    prependPath: () => []
  }), (error) => {
    assert.match(error.details.handoff.command, /^npm install --prefix \.foundation\/tools /);
    assert.equal(error.details.handoff.cwd, "/project");
    assert.match(error.details.handoff.log, /ENOTFOUND/);
    return true;
  });
});
