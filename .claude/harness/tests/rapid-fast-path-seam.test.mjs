import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

// A clean installed consumer on the shipped risk-tiered policy. Every
// configured reviewer is a fake that records each call and fails, so a
// review that runs is observable and can never pass by accident.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function consumer(intent) {
  const temp = mkdtempSync(join(tmpdir(), "foundation-rapid-fast-path-"));
  const project = join(temp, "consumer");
  mkdirSync(project, { recursive: true });
  const run = (command, args, cwd = project) => execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  run("git", ["init", "-q"]);
  run("git", ["config", "user.email", "fixture@example.test"]);
  run("git", ["config", "user.name", "Fixture"]);
  run("bash", [join(sourceRoot, "install.sh"), project, "--source", sourceRoot, "--yes"],
    sourceRoot);
  const calls = join(temp, "reviewer-calls");
  const reviewer = join(temp, "fake-reviewer.sh");
  writeFileSync(reviewer, `#!/bin/sh\necho called >> "${calls}"\nexit 3\n`);
  chmodSync(reviewer, 0o755);
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  assert.equal(policy.workflow.reviewPolicy, "risk-tiered", "the shipped default is under test");
  policy.workflow.grounding = "optional";
  for (const config of Object.values(policy.review.reviewers)) config.executable = reviewer;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  mkdirSync(join(project, "src"));
  mkdirSync(join(project, "test"));
  writeFileSync(join(project, "package.json"),
    '{"name":"calc","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n');
  writeFileSync(join(project, "src/calc.js"), "export function add(a, b) { return a + b; }\n");
  writeFileSync(join(project, "test/calc.test.js"), 'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\nimport { add } from "../src/calc.js";\n' +
    'test("add", () => assert.equal(add(1, 2), 3));\n');
  run("git", ["add", "-A"]);
  run("git", ["commit", "-qm", "seed"]);
  mkdirSync(join(project, ".foundation/drafts"), { recursive: true });
  writeFileSync(join(project, ".foundation/drafts/subtract.json"), JSON.stringify({
    intent,
    requirements: [{ description: "The calc module SHALL export subtract(a, b) returning a minus b",
      scenarios: [{ when: "subtract(5, 3) is called", then: "it returns 2" }] }],
    tasks: [{ outcome: "Add subtract with a test", verify: "node --test",
      paths: ["src/**", "test/**"] }]
  }));
  // The consumer's own `node --test` must not report into this runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const cli = (...args) => spawnSync("node", [".claude/harness/foundation.mjs", ...args],
    { cwd: project, encoding: "utf8", env });
  const started = cli("start", ".foundation/drafts/subtract.json",
    "--approve-spec", "--decision-ref", "fixture://user/spec");
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const id = started.stdout.match(/CREATED (\S+)/)?.[1];
  assert.ok(id, started.stdout);
  assert.match(started.stdout, /schema: foundation-rapid/);
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
  const reviewerCalls = () => existsSync(calls)
    ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
  return { temp, project, id, cli, started, reviewerCalls };
}

test("a quiet low-tier rapid change lands on deterministic evidence without a reviewer", () => {
  const fixture = consumer("Calc exports subtract that returns a minus b");
  try {
    assert.match(fixture.started.stdout,
      /review: not required \(rapid lane, low tier: deterministic evidence only\)/);
    assert.doesNotMatch(fixture.started.stderr, /review assurance posture/);
    // One advance carries the built change through Prove and Land.
    const landed = fixture.cli("advance", fixture.id, "--through", "archived");
    assert.equal(landed.status, 0, landed.stderr || landed.stdout);
    assert.match(landed.stdout, /"reached":"archived"/);
    assert.equal(fixture.reviewerCalls(), 0, "no reviewer is invoked");
    const receipts = join(fixture.project, ".foundation/receipts", fixture.id);
    assert.equal(existsSync(join(receipts, "review.json")), false);
    // The project's own tests are still the proof.
    assert.equal(JSON.parse(readFileSync(join(receipts, "test.json"), "utf8")).status, "pass");
    assert.match(readFileSync(join(fixture.project, "src/calc.js"), "utf8"), /subtract/);
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

// Land interrupted between code apply and archive leaves the change at
// `applied`. Recovery is the same advance route, even from another session
// (a backend or a fresh host), never a user-run repair command.
test("a quiet rapid change left at applied resumes to archived through advance", () => {
  const fixture = consumer("Calc exports subtract that returns a minus b");
  try {
    const bin = join(fixture.temp, "failing-openspec");
    mkdirSync(bin);
    writeFileSync(join(bin, "openspec"), "#!/bin/sh\n" +
      'if [ "$1" = "archive" ]; then echo "injected archive interruption" >&2; exit 1; fi\n' +
      // Every other call reaches the real CLI behind this wrapper.
      'PATH="${PATH#*:}" exec openspec "$@"\n');
    chmodSync(join(bin, "openspec"), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      FOUNDATION_CLAUDE_SESSION_ID: "interrupted-host-session" };
    delete env.NODE_TEST_CONTEXT;
    const interrupted = spawnSync("node", [".claude/harness/foundation.mjs", "advance",
      fixture.id, "--through", "archived"], { cwd: fixture.project, encoding: "utf8", env });
    assert.doesNotMatch(interrupted.stdout, /"reached":"archived"/);
    const runtime = join(fixture.project, ".foundation/runtime", `${fixture.id}.json`);
    assert.equal(JSON.parse(readFileSync(runtime, "utf8")).status, "applied",
      interrupted.stderr || interrupted.stdout);
    assert.match(readFileSync(join(fixture.project, "src/calc.js"), "utf8"), /subtract/);
    const resumed = fixture.cli("advance", fixture.id, "--through", "archived");
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
    assert.match(resumed.stdout, /"reached":"archived"/);
    assert.equal(JSON.parse(readFileSync(runtime, "utf8")).status, "archived");
    assert.equal(fixture.reviewerCalls(), 0, "recovery invokes no reviewer");
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test("a rapid change with a security keyword still runs the configured reviewer", () => {
  const fixture = consumer("Calc exports subtract for billing totals");
  try {
    assert.match(fixture.started.stdout, /review: risk-tiered AI review \(low tier/);
    const proving = fixture.cli("advance", fixture.id, "--through", "proven");
    assert.ok(fixture.reviewerCalls() > 0, "the configured reviewer is invoked");
    assert.doesNotMatch(proving.stdout, /"reached":"proven"/,
      "a failed review never proves the change");
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});
