import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

// A clean installed consumer on the shipped risk-tiered policy whose AI review
// is required (a security keyword) and whose project test is deliberately slow
// and not the Build task check, so Prove really runs it. The configured
// reviewer is a fake `claude` that records its own start/finish and answers
// from a script; the project test records its own. Overlap is judged from the
// recorded timestamps, never from a wall-clock threshold.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The fake reviewer. `pass` covers every checklist scenario; `fail` exits
// non-zero; `mutate` edits a reviewed file while it runs, then passes.
function fakeReviewerSource(events, mode) {
  return `#!/usr/bin/env node
const { appendFileSync, writeFileSync, readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const stamp = (name) => appendFileSync(${JSON.stringify(events)},
  name + " " + BigInt(Date.now()) * 1000000n + " " + process.pid + "\\n");
// Preflight probes the adapter makes before a review: authentication and the
// headless flag surface.
if (process.argv[2] === "auth") { console.log('{"loggedIn":true}'); process.exit(0); }
if (process.argv.includes("--help")) {
  console.log("--print --output-format --json-schema --model --effort --permission-mode " +
    "--tools --safe-mode --session-id --no-session-persistence");
  process.exit(0);
}
stamp("review-start");
const prompt = process.argv.at(-1);
const packet = JSON.parse(prompt.slice(prompt.indexOf("\\n", prompt.indexOf("FOUNDATION REVIEW PACKET")) + 1));
const items = packet.scenarioChecklist?.items || [];
setTimeout(() => {
  // Only the first review changes the bytes it is judging.
  if (${JSON.stringify(mode)} === "mutate" && !require("node:fs").existsSync(${JSON.stringify(events + ".mutated")})) {
    const file = process.cwd() + "/src/calc.js";
    writeFileSync(file, readFileSync(file, "utf8") + "// edited while under review\\n");
    writeFileSync(${JSON.stringify(events + ".mutated")}, "1");
  }
  stamp("review-end");
  if (${JSON.stringify(mode)} === "fail") process.exit(3);
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false,
    session_id: randomUUID(), structured_output: { status: "pass", summary: "fake pass",
      findings: [], verifiedFindingIds: [],
      scenarioCoverage: items.map((item) => ({ id: item.id, status: "covered-by-test",
        evidence: "test/calc.test.js:1" })) } }));
}, 1500);
`;
}

function consumer({ reviewer: mode = "pass", testExit = 0,
  intent = "Calc exports subtract for billing totals", policyEdit = null } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "foundation-review-overlap-"));
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
  const events = join(temp, "events.log");
  const reviewer = join(temp, "fake-claude.js");
  writeFileSync(reviewer, fakeReviewerSource(events, mode));
  chmodSync(reviewer, 0o755);
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.workflow.grounding = "optional";
  for (const config of Object.values(policy.review.reviewers)) config.executable = reviewer;
  policyEdit?.(policy);
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
  // The task check is the project test itself. Its result is bound to the
  // bytes it ran on, so the post-Build touch below makes Prove run it again.
  writeFileSync(join(project, ".foundation/drafts/subtract.json"), JSON.stringify({
    intent,
    requirements: [{ description: "The calc module SHALL export subtract(a, b) returning a minus b",
      scenarios: [{ when: "subtract(5, 3) is called", then: "it returns 2" }] }],
    tasks: [{ outcome: "Add subtract with a test", verify: "node --test",
      paths: ["src/**", "test/**"] }]
  }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.FOUNDATION_CLAUDE_SESSION_ID;
  const cli = (...args) => spawnSync("node", [".claude/harness/foundation.mjs", ...args],
    { cwd: project, encoding: "utf8", env });
  const started = cli("start", ".foundation/drafts/subtract.json",
    "--approve-spec", "--decision-ref", "fixture://user/spec");
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const id = started.stdout.match(/CREATED (\S+)/)?.[1];
  assert.ok(id, started.stdout);
  cli("advance", id, "--through", "build");
  const workspace = JSON.parse(readFileSync(
    join(project, ".foundation/runtime", `${id}.json`), "utf8")).workspace.path;
  writeFileSync(join(workspace, "src/calc.js"), "export function add(a, b) { return a + b; }\n" +
    "export function subtract(a, b) { return a - b; }\n");
  // The project test appends its own start/end around a fixed pause, so each
  // run is an interval on the same clock as the reviewer's. With `testExit`
  // set it fails only once the post-Build touch is in place, i.e. in Prove.
  writeFileSync(join(workspace, "test/calc.test.js"), 'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\nimport { appendFileSync, readFileSync } from "node:fs";\n' +
    'import { add, subtract } from "../src/calc.js";\n' +
    `const log = (name) => appendFileSync(${JSON.stringify(events)}, ` +
    '`${name} ${BigInt(Date.now()) * 1000000n} ${process.pid}\\n`);\n' +
    'const touched = readFileSync(new URL("../src/calc.js", import.meta.url), "utf8").includes("post-build touch");\n' +
    'log("test-start");\n' +
    'test("add", () => assert.equal(add(1, 2), 3));\n' +
    `test("subtract", async () => { await new Promise((r) => setTimeout(r, 2500)); ` +
    `assert.equal(subtract(5, 3), touched && ${testExit !== 0} ? 99 : 2); });\n` +
    'test.after(() => log("test-end"));\n');
  // Build completes (and its check runs the test once)...
  const built = cli("advance", id, "--through", "build");
  assert.equal(built.status, 0, built.stderr || built.stdout);
  // ...then the content moves, so Prove must run the test on the new bytes.
  writeFileSync(join(workspace, "src/calc.js"),
    `${readFileSync(join(workspace, "src/calc.js"), "utf8")}// post-build touch\n`);
  const rows = () => (existsSync(events) ? readFileSync(events, "utf8") : "")
    .trim().split("\n").filter(Boolean).map((line) => {
      const [name, at, pid] = line.split(" ");
      return { name, at: BigInt(at), pid };
    });
  const clean = () => rmSync(temp, { recursive: true, force: true });
  return { temp, project, workspace, id, cli, rows, events, clean };
}

const intervals = (rows, start, end) => rows.filter((row) => row.name === start).map((open) => ({
  start: open.at,
  end: rows.find((row) => row.name === end && row.pid === open.pid)?.at ?? null
}));
const show = (rows) => JSON.stringify(rows, (_k, v) => typeof v === "bigint" ? String(v) : v);
const proven = (result) => /"reached":"proven"/.test(result.stdout);
const overlap = (a, b) => a.end !== null && b.end !== null && a.start < b.end && b.start < a.end;

test("the required review starts before the slow project test finishes and still proves", () => {
  const fixture = consumer();
  try {
    const advanced = fixture.cli("advance", fixture.id, "--through", "proven");
    const rows = fixture.rows();
    const reviews = intervals(rows, "review-start", "review-end");
    const tests = intervals(rows, "test-start", "test-end");
    assert.ok(reviews.length >= 1 && tests.length >= 1,
      `both ran: ${show(rows)}\n${advanced.stdout.slice(0, 600)}\n${advanced.stderr.slice(0, 600)}`);
    assert.ok(tests.some((run) => reviews.some((review) => overlap(run, review))),
      `review and test intervals overlap: ${show(rows)}`);
    assert.equal(reviews.length, 1, "one review dispatch, never a second for the same content");
    assert.ok(proven(advanced), advanced.stdout.slice(0, 800));
    // The receipt names the model and the model class the review actually ran.
    const receipt = JSON.parse(readFileSync(
      join(fixture.project, ".foundation/receipts", fixture.id, "review.json"), "utf8"));
    assert.equal(receipt.review.reviewer.modelId, "haiku");
    assert.equal(receipt.review.reviewer.modelTier, "fast");
  } finally {
    fixture.clean();
  }
});

test("failing project tests never pass and leave no reviewer running", () => {
  const fixture = consumer({ testExit: 1 });
  try {
    const advanced = fixture.cli("advance", fixture.id, "--through", "proven");
    assert.equal(proven(advanced), false, "failed executable evidence never proves the change");
    const rows = fixture.rows();
    const reviews = intervals(rows, "review-start", "review-end");
    assert.ok(reviews.length >= 1, `the review started beside the test: ${show(rows)}`);
    assert.ok(reviews.every((review) => review.end !== null),
      `every started reviewer finished before advance returned: ${show(rows)}`);
    assert.ok(!existsSync(join(fixture.project, ".foundation/receipts", fixture.id, "proof.json")),
      "no proof is written");
  } finally {
    fixture.clean();
  }
});

test("a verdict for content that changed during review is never accepted", () => {
  const fixture = consumer({ reviewer: "mutate" });
  try {
    const advanced = fixture.cli("advance", fixture.id, "--through", "proven");
    const rows = fixture.rows();
    const reviews = intervals(rows, "review-start", "review-end");
    assert.match(readFileSync(join(fixture.workspace, "src/calc.js"), "utf8"),
      /edited while under review/);
    // The first review judged the old bytes: its verdict was dropped and the
    // changed content was reviewed again before anything proved.
    assert.equal(reviews.length, 2, `a second review of the new bytes: ${show(rows)}`);
    assert.ok(proven(advanced), advanced.stdout.slice(0, 800));
    const authority = join(fixture.project, ".foundation/authority", fixture.id);
    const statuses = readdirSync(authority).filter((name) => /^review-[^.]*\.json$/.test(name) && !name.includes("response"))
      .map((name) => JSON.parse(readFileSync(join(authority, name), "utf8")).status).sort();
    assert.deepEqual(statuses, ["aborted", "completed"],
      "the superseded request is aborted; only the review of the current bytes completes");
  } finally {
    fixture.clean();
  }
});
