import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildExecCommandViolation, createExecRuntime
} from "../runtime/observability/exec-runtime.mjs";

function rows(logs, id) {
  return readFileSync(join(logs, id, "operations.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
}

test("observed execution validates lifecycle and command presence", (t) => {
  const logs = mkdtempSync(join(tmpdir(), "foundation-exec-runtime-"));
  t.after(() => rmSync(logs, { recursive: true, force: true }));
  const workspace = join(logs, "workspace");
  mkdirSync(workspace);
  let status = "archived";
  const runtime = createExecRuntime({
    logs, loadRuntime: () => ({ status, workspace: { path: workspace } }),
    now: () => "2026-08-27T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  assert.throws(() => runtime.execObserved("change", [process.execPath]),
    /archived change is finished evidence/);
  status = "building";
  assert.throws(() => runtime.execObserved("change", []),
    /requires a command after --/);
  assert.throws(() => runtime.execObserved("change", [process.execPath], {
    phase: "land"
  }), /does not match change state 'building'/);
  assert.throws(() => runtime.execObserved("change", [
    "foundation-command-that-does-not-exist"
  ]), /could not start/);
});

test("observed execution records success, failure, signal death, and bounded commands", (t) => {
  const logs = mkdtempSync(join(tmpdir(), "foundation-exec-runtime-"));
  t.after(() => rmSync(logs, { recursive: true, force: true }));
  const workspace = join(logs, "workspace");
  mkdirSync(workspace);
  const runtime = createExecRuntime({
    logs, loadRuntime: () => ({ status: "building", workspace: { path: workspace } }),
    now: () => "2026-08-27T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  const priorPhase = process.env.FOUNDATION_PUBLIC_OPERATION;
  process.env.FOUNDATION_PUBLIC_OPERATION = "prove";
  try {
    assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""], {
      phase: "build"
    }), 0);
    assert.equal(runtime.execObserved("change", [
      process.execPath, "-e", "process.exit(7)", "x".repeat(700)
    ]), 7);
    assert.equal(runtime.execObserved("change", [
      process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"
    ], { phase: "" }), 1);
    delete process.env.FOUNDATION_PUBLIC_OPERATION;
    assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""]), 0);
  } finally {
    if (priorPhase === undefined) delete process.env.FOUNDATION_PUBLIC_OPERATION;
    else process.env.FOUNDATION_PUBLIC_OPERATION = priorPhase;
  }
  const values = rows(logs, "change");
  assert.equal(values.length, 4);
  assert.deepEqual(values.map(({ status, exitCode }) => ({ status, exitCode })), [
    { status: "completed", exitCode: 0 },
    { status: "failed", exitCode: 7 },
    { status: "failed", exitCode: 1 },
    { status: "completed", exitCode: 0 }
  ]);
  assert.equal(values[0].phase, "build");
  assert.equal(values[1].phase, "build");
  assert.equal(values[2].phase, "build");
  assert.equal(values[3].phase, "build");
  assert.equal(values[1].command.length, 512);
  assert.equal(values[0].measurement, "external-command-observed");
  assert.equal(values[0].requests, null);
  assert.ok(values.every((value) => value.durationMs >= 0));
});

test("Build exec runs in the isolated workspace and refuses path escapes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-exec-containment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  symlinkSync(outside, join(workspace, "escape"));
  assert.equal(buildExecCommandViolation(["touch", "file"], join(root, "missing")),
    "Build exec requires an existing isolated workspace");
  const runtime = createExecRuntime({
    logs,
    loadRuntime: () => ({ status: "building", workspace: { path: workspace } }),
    now: () => "2026-09-04T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  assert.equal(runtime.execObserved("change", [
    process.execPath, "-e",
    "require('node:fs').writeFileSync('cwd.txt', process.cwd())"
  ], { phase: "build" }), 0);
  assert.equal(readFileSync(join(workspace, "cwd.txt"), "utf8"), realpathSync(workspace));

  // The strict shell guard refuses escapes before the command starts.
  process.env.FOUNDATION_SHELL_GUARD = "block";
  t.after(() => { delete process.env.FOUNDATION_SHELL_GUARD; });
  const escaped = join(outside, "escaped.txt");
  assert.throws(() => runtime.execObserved("change", ["touch", escaped], {
    phase: "build"
  }), /outside the isolated workspace/);
  assert.equal(existsSync(escaped), false);
  assert.throws(() => runtime.execObserved("change", ["touch", "escape/symlinked.txt"], {
    phase: "build"
  }), /outside the isolated workspace/);
  assert.equal(existsSync(join(outside, "symlinked.txt")), false);
});

test("exec preserves real phase overlaps but never bypasses phase mutation policy", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-exec-phase-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  let status = "building";
  const runtime = createExecRuntime({
    logs: join(root, "logs"),
    loadRuntime: () => ({ status, workspace: { path: workspace } }),
    now: () => "2026-09-04T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });

  assert.equal(runtime.execObserved("change", [process.execPath, "-e", ""], {
    phase: "prove"
  }), 0);
  status = "proven";
  assert.throws(() => runtime.execObserved("change", ["git", "push"], {
    phase: "land"
  }), /Land shell mutations require the runtime transaction marker/);
});

// The live hook records text-inferred shell findings outside Land; exec did
// the same check as a hard refusal, so `exec -- npm run e2e` failed in Prove.
test("exec records shell findings outside Land like the live hook and runs Prove checks in the workspace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-exec-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  let status = "building";
  const notices = [];
  const original = console.error;
  console.error = (line) => notices.push(String(line));
  t.after(() => { console.error = original; });
  const runtime = createExecRuntime({
    logs: join(root, "logs"),
    loadRuntime: () => ({ status, workspace: { path: workspace } }),
    now: () => "2026-09-04T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  const escaped = join(outside, "recorded.txt");
  assert.equal(runtime.execObserved("change", ["touch", escaped], { phase: "build" }), 0);
  assert.equal(existsSync(escaped), true);
  assert.match(notices.join("\n"), /NOTICE: exec recorded an unverified shell mutation/);

  status = "proven";
  assert.equal(runtime.execObserved("change", [
    process.execPath, "-e", "require('node:fs').writeFileSync('prove-cwd.txt', process.cwd())"
  ], { phase: "prove" }), 0);
  assert.equal(readFileSync(join(workspace, "prove-cwd.txt"), "utf8"), realpathSync(workspace));
  assert.throws(() => runtime.execObserved("change", ["git", "push"], { phase: "land" }),
    /Land shell mutations require the runtime transaction marker/);
});

// A multi-repository change: the shared sandbox holds only an empty mirror of
// the `api` submodule; its work and checks live in its repository sandbox.
function multiRepositoryFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "foundation-exec-repositories-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, ".foundation", "sandboxes", "change");
  const api = join(root, ".foundation", "repository-sandboxes", "change", "api");
  for (const path of [join(root, "services", "api", "src"), join(shared, "services", "api"),
    join(shared, "docs"), join(api, "src")]) mkdirSync(path, { recursive: true });
  const state = {
    status: "building",
    workspace: { path: shared },
    repositories: {
      root: { path: shared, targetPath: root, access: "write" },
      api: { path: api, targetPath: join(root, "services", "api"), access: "write" }
    }
  };
  let tasks = [{ id: "T001", repository: "api", done: false }];
  let caller = root;
  const failures = [];
  const runtime = createExecRuntime({
    logs: join(root, ".foundation", "logs"), root,
    loadRuntime: () => state,
    changeTasks: () => tasks,
    callerCwd: () => caller,
    now: () => "2026-10-07T00:00:00.000Z",
    fail: (message, code, details) => {
      failures.push(details?.code || null);
      throw new Error(message);
    }
  });
  const where = (options = {}) => {
    const out = join(root, "where.txt");
    assert.equal(runtime.execObserved("change", [process.execPath, "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(out)}, ` +
      "process.cwd() + '\\n' + process.env.FOUNDATION_WORKSPACE_ROOT)"
    ], { phase: "build", ...options }), 0);
    return readFileSync(out, "utf8").split("\n");
  };
  return {
    root, shared, api, state, failures, runtime, where,
    setTasks: (value) => { tasks = value; },
    setCaller: (value) => { caller = value; }
  };
}

test("CASE-EXEC-REPOSITORY-SANDBOX: a repository task's command runs in that repository's sandbox", (t) => {
  const fixture = multiRepositoryFixture(t);
  // The pending task belongs to `api`, so its check starts in the api sandbox,
  // not in the shared sandbox's empty mirror of it.
  assert.deepEqual(fixture.where(), [fixture.api, fixture.api]);
  assert.deepEqual(fixture.where({ repository: "root" }), [fixture.shared, fixture.shared]);
  assert.deepEqual(fixture.where({ repository: "api" }), [fixture.api, fixture.api]);
  assert.deepEqual(fixture.where({ task: "t001" }), [fixture.api, fixture.api]);

  // Pending work in several repositories is ambiguous: the shared sandbox, as
  // before, plus a notice naming the repository form.
  fixture.setTasks([
    { id: "T001", repository: "api", done: false },
    { id: "T002", repository: "root", done: false }
  ]);
  const notices = [];
  const original = console.error;
  console.error = (line) => notices.push(String(line));
  try {
    assert.deepEqual(fixture.where(), [fixture.shared, fixture.shared]);
  } finally { console.error = original; }
  assert.match(notices.join("\n"), /repository 'api'.*--repo <repository>/);
  assert.deepEqual(fixture.where({ task: "T001" }), [fixture.api, fixture.api]);
  assert.deepEqual(fixture.where({ task: "T002" }), [fixture.shared, fixture.shared]);

  // Prove reads the same sandboxes.
  fixture.state.status = "proven";
  fixture.setTasks([{ id: "T001", repository: "api", done: true }]);
  assert.equal(fixture.runtime.execObserved("change", [process.execPath, "-e",
    `require('node:fs').writeFileSync('prove.txt', '')`], { repository: "api" }), 0);
  assert.equal(existsSync(join(fixture.api, "prove.txt")), true);
});

// Build hands each task's verify back as `exec <change> --task <id> -- sh -c
// '<verify>'` so the agent's focused check is pre-allowed; it must run in that
// task's sandbox with its shell text intact and pass the exit code through.
test("a task checkCommand runs its shell verify in the task's sandbox", (t) => {
  const fixture = multiRepositoryFixture(t);
  const verify = "printf ok > check.txt && pwd | tail -1 > where.txt && exit 3";
  assert.equal(fixture.runtime.execObserved("change", ["sh", "-c", verify],
    { task: "T001" }), 3);
  assert.equal(readFileSync(join(fixture.api, "check.txt"), "utf8"), "ok");
  assert.equal(readFileSync(join(fixture.api, "where.txt"), "utf8").trim(), fixture.api);
  assert.equal(existsSync(join(fixture.root, "check.txt")), false);
});

test("exec maps the caller's directory into the matching sandbox", (t) => {
  const fixture = multiRepositoryFixture(t);
  fixture.setTasks([]);
  const apiSource = join(fixture.api, "src");
  // Inside the repository sandbox, the main checkout's copy of the
  // repository, or the shared sandbox's mirror of it.
  fixture.setCaller(apiSource);
  assert.deepEqual(fixture.where(), [apiSource, fixture.api]);
  fixture.setCaller(join(fixture.root, "services", "api", "src"));
  assert.deepEqual(fixture.where(), [apiSource, fixture.api]);
  fixture.setCaller(join(fixture.shared, "services", "api"));
  assert.deepEqual(fixture.where(), [fixture.api, fixture.api]);
  // A root-repository directory maps within the shared sandbox.
  mkdirSync(join(fixture.root, "docs"));
  fixture.setCaller(join(fixture.root, "docs"));
  assert.deepEqual(fixture.where(), [join(fixture.shared, "docs"), fixture.shared]);
  // An explicit repository still honours a caller already inside it.
  fixture.setCaller(apiSource);
  assert.deepEqual(fixture.where({ repository: "api" }), [apiSource, fixture.api]);
  // A directory missing from the sandbox starts at the sandbox root.
  mkdirSync(join(fixture.root, "untracked"));
  fixture.setCaller(join(fixture.root, "untracked"));
  assert.deepEqual(fixture.where(), [fixture.shared, fixture.shared]);
});

test("exec refuses unknown repositories and tasks and never runs in the main checkout", (t) => {
  const fixture = multiRepositoryFixture(t);
  const marker = join(fixture.root, "ran.txt");
  const command = [process.execPath, "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`];
  assert.throws(() => fixture.runtime.execObserved("change", command, { repository: "web" }),
    /repository 'web', which has no sandbox in change 'change' \(known: root, api\); run `claude-foundation exec change --repo <repository>/);
  assert.throws(() => fixture.runtime.execObserved("change", command, { task: "T404" }),
    /'T404', which is not a task of change 'change'/);
  assert.throws(() => fixture.runtime.execObserved("change", command, {
    repository: "root", task: "T001"
  }), /belongs to repository 'api', not 'root'/);
  fixture.state.workspace.path = fixture.root;
  assert.throws(() => fixture.runtime.execObserved("change", command),
    /exec never runs in the main checkout/);
  fixture.state.workspace.path = undefined;
  fixture.state.status = "change";
  assert.throws(() => fixture.runtime.execObserved("change", command, { repository: "api" }),
    /needs the change's isolated Build workspace.*advance change --through build/);
  assert.deepEqual(fixture.failures, [
    "EXEC_REPOSITORY_UNKNOWN", "EXEC_TASK_UNKNOWN", "EXEC_REPOSITORY_CONFLICT",
    "EXEC_WORKSPACE_NOT_ISOLATED", "EXEC_WORKSPACE_MISSING"
  ]);
  assert.equal(existsSync(marker), false);
});
