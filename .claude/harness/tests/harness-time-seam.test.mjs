import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The harness's own time per rapid change. Wall-clock is flaky; process spawns
// are not. The harness used to start a process for every "what is HEAD?" and
// "does this still lint?" question (1,700+ spawns and ~20 s for one tiny change
// in a plain directory); the structure pinned here is what keeps it from
// regressing: no spawn that a file read can answer, one OpenSpec lint per
// agreement, and one run of the project's suite shared by Build and Prove.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Preloaded into every node process of the lifecycle; one JSON line per spawn.
const RECORDER = `
const cp = require("node:child_process");
const fs = require("node:fs");
const log = process.env.SPAWN_RECORD;
function record(command, args) {
  if (!log) return;
  fs.appendFileSync(log, JSON.stringify({
    command: String(command), args: (Array.isArray(args) ? args : []).map(String)
  }) + "\\n");
}
for (const name of ["spawnSync", "execFileSync", "spawn", "execFile"]) {
  const original = cp[name];
  cp[name] = function (command, args, ...rest) {
    record(command, args);
    return original.call(this, command, args, ...rest);
  };
}
`;

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function lifecycle(t, { repository }) {
  const temp = mkdtempSync(join(tmpdir(), "foundation-harness-time-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const project = join(temp, "consumer");
  mkdirSync(project, { recursive: true });
  if (repository) {
    run("git", ["init", "-q"], project);
    run("git", ["config", "user.email", "fixture@example.test"], project);
    run("git", ["config", "user.name", "Fixture"], project);
  }
  run("bash", [join(sourceRoot, "install.sh"), project, "--source", sourceRoot, "--yes"],
    sourceRoot);
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.workflow.grounding = "optional";
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  mkdirSync(join(project, "src"));
  mkdirSync(join(project, "test"));
  writeFileSync(join(project, "package.json"),
    '{"name":"calc","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n');
  writeFileSync(join(project, "src/calc.js"), "export function add(a, b) { return a + b; }\n");
  writeFileSync(join(project, "test/calc.test.js"), 'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\nimport { add } from "../src/calc.js";\n' +
    'test("add", () => assert.equal(add(1, 2), 3));\n');
  if (repository) {
    run("git", ["add", "-A"], project);
    run("git", ["commit", "-qm", "seed"], project);
  }
  mkdirSync(join(project, ".foundation/drafts"), { recursive: true });
  writeFileSync(join(project, ".foundation/drafts/subtract.json"), JSON.stringify({
    intent: "Calc exports subtract that returns a minus b",
    requirements: [{ description: "The calc module SHALL export subtract(a, b) returning a minus b",
      scenarios: [{ when: "subtract(5, 3) is called", then: "it returns 2" }] }],
    tasks: [{ outcome: "Add subtract with a test", verify: "node --test",
      paths: ["src/**", "test/**"] }]
  }));

  const recorder = join(temp, "spawn-recorder.cjs");
  const spawnLog = join(temp, "spawns.jsonl");
  writeFileSync(recorder, RECORDER);
  const env = { ...process.env, SPAWN_RECORD: spawnLog, NODE_OPTIONS: `--require ${recorder}` };
  delete env.NODE_TEST_CONTEXT;
  delete env.FOUNDATION_CLAUDE_SESSION_ID;
  const cli = (...args) => spawnSync("node", [".claude/harness/foundation.mjs", ...args],
    { cwd: project, encoding: "utf8", env });

  const started = cli("start", ".foundation/drafts/subtract.json",
    "--approve-spec", "--decision-ref", "fixture://user/spec");
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const id = started.stdout.match(/CREATED (\S+)/)?.[1];
  assert.ok(id, started.stdout);
  const build = cli("advance", id, "--through", "build");
  assert.match(build.stdout, /"action":"EDIT"/, build.stderr);
  const workspace = JSON.parse(readFileSync(
    join(project, ".foundation/runtime", `${id}.json`), "utf8")).workspace.path;
  writeFileSync(join(workspace, "src/calc.js"), "export function add(a, b) { return a + b; }\n" +
    "export function subtract(a, b) { return a - b; }\n");
  writeFileSync(join(workspace, "test/calc.test.js"), 'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\nimport { add, subtract } from "../src/calc.js";\n' +
    'test("add", () => assert.equal(add(1, 2), 3));\n' +
    'test("subtract", () => assert.equal(subtract(5, 3), 2));\n');
  const landed = cli("advance", id, "--through", "archived");
  assert.equal(landed.status, 0, landed.stderr || landed.stdout);
  assert.match(landed.stdout, /"reached":"archived"/);

  const spawns = existsSync(spawnLog)
    ? readFileSync(spawnLog, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const calls = (program, predicate = () => true) => spawns.filter((row) =>
    basename(row.command) === program && predicate(row.args));
  const operations = readFileSync(join(project, ".foundation/logs", id, "operations.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  return {
    project, id, spawns, calls, operations,
    suiteRuns: calls("sh", (args) => args[0] === "-c" && args[1] === "node --test").length,
    provenance: readFileSync(join(project, ".foundation/receipts", id, "test.json"), "utf8")
  };
}

// Per-phase harness time already lands in operations.jsonl (the metrics
// source); assert the structure and print the numbers for the maintainer.
function assertPhaseTiming(t, operations) {
  const advances = operations.filter((row) => row.operation === "advance");
  assert.ok(advances.length >= 2, "the build and the through-archived advances are recorded");
  for (const row of operations) {
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0, `${row.operation} is timed`);
    for (const span of [...(row.phaseSpans || []), ...(row.stageSpans || [])])
      assert.ok(Number.isFinite(span.durationMs) && span.durationMs >= 0);
  }
  const final = advances.at(-1);
  const phases = Object.fromEntries((final.phaseSpans || []).map((span) =>
    [span.phase, span.durationMs]));
  for (const phase of ["build", "prove", "land"])
    assert.ok(phase in phases, `phase ${phase} has a measured span`);
  t.diagnostic(`harness time ms: ${operations.map((row) =>
    `${row.operation}=${row.durationMs}`).join(" ")}; through-archived phases ${
    JSON.stringify(phases)}`);
}

function gitCommands(spawns) {
  return spawns.filter((row) => basename(row.command) === "git");
}

test("a rapid change in a plain directory needs almost no git and shares one suite run", (t) => {
  const f = lifecycle(t, { repository: false });
  const git = gitCommands(f.spawns);
  assert.equal(f.calls("git", (args) => args[0] === "rev-parse").length, 0,
    "HEAD is answered from the files, and a non-repository answers itself");
  assert.ok(git.length <= 6, `git is not asked what the directory already says (${git.length})`);
  assert.ok(f.calls("openspec", (args) => args[0] === "validate").length <= 2,
    "one strict lint per agreement content");
  assert.equal(f.calls("openspec", (args) => args[0] === "archive").length, 1);
  assert.ok(f.calls("openspec", (args) => args[0] === "--version").length <= 1,
    "the OpenSpec version is probed once per executable, not once per command");
  assert.equal(f.suiteRuns, 1, "Build's task check is Prove's test run, not a second one");
  assert.match(f.provenance, /reused Build task check/);
  assert.ok(f.spawns.length <= 40, `bounded total spawns (${f.spawns.length})`);
  assertPhaseTiming(t, f.operations);
});

test("a rapid change in a repository keeps git to a bounded set of queries", (t) => {
  const f = lifecycle(t, { repository: true });
  const git = gitCommands(f.spawns);
  assert.ok(f.calls("git", (args) => args[0] === "rev-parse" && args[1] === "HEAD").length <= 3,
    "HEAD is read from refs, not from a process per question");
  assert.ok(git.length <= 100, `bounded git queries (${git.length})`);
  assert.ok(f.calls("openspec", (args) => args[0] === "validate").length <= 2);
  assert.equal(f.calls("openspec", (args) => args[0] === "archive").length, 1);
  // The project's suite runs for Build+Prove once, plus once on the base source
  // for the test-discrimination check; never a third time.
  assert.ok(f.suiteRuns <= 2, `suite runs (${f.suiteRuns})`);
  assert.match(f.provenance, /reused Build task check/);
  assertPhaseTiming(t, f.operations);
});
