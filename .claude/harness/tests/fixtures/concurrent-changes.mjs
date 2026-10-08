import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Shared driver for the model-free concurrent-change seam suites. A clean
// consumer is installed from this repository and hosts several active changes
// started from one base. The tests play the coding agent by editing each
// change's own sandbox by script. The shipped risk-tiered policy keeps quiet
// low-tier rapid changes on deterministic evidence, so no reviewer is invoked.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const SHARED_LINES = 30;

export function world() {
  const temp = mkdtempSync(join(tmpdir(), "foundation-concurrent-"));
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
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.workflow.grounding = "optional";
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  mkdirSync(join(project, "src"));
  mkdirSync(join(project, "test"));
  writeFileSync(join(project, "package.json"),
    '{"name":"calc","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n');
  writeFileSync(join(project, "src/shared.txt"),
    `${Array.from({ length: SHARED_LINES }, (unused, i) => `shared line ${i + 1}`).join("\n")}\n`);
  for (const name of ["alpha", "bravo", "charlie"]) {
    writeFileSync(join(project, `src/${name}.txt`), `${name} base\n`);
  }
  writeFileSync(join(project, "test/base.test.js"), 'import test from "node:test";\n' +
    'test("base", () => {});\n');
  run("git", ["add", "-A"]);
  run("git", ["commit", "-qm", "seed"]);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.FOUNDATION_CLAUDE_SESSION_ID;
  const ids = {};
  // Harness operations (CLI invocations) per change label; `-` is pre-start.
  const operations = { count: 0, byChange: {} };
  // Arguments name changes by short label; the harness gets the real id.
  const cli = (...argv) => {
    const owner = Object.keys(ids).find((key) => argv.includes(key)) || "-";
    operations.count += 1;
    operations.byChange[owner] = (operations.byChange[owner] || 0) + 1;
    return spawnSync("node",
      [".claude/harness/foundation.mjs", ...argv.map((arg) => ids[arg] || arg)],
      { cwd: project, encoding: "utf8", env });
  };
  const read = (file) => readFileSync(join(project, file), "utf8");
  const write = (file, text) => writeFileSync(join(project, file), text);
  return { temp, project, cli, read, write, operations, run, ids };
}

// Starts one change that owns `files` (paths under the consumer) and a test.
export function startChange(w, label, files) {
  mkdirSync(join(w.project, ".foundation/drafts"), { recursive: true });
  writeFileSync(join(w.project, ".foundation/drafts", `${label}.json`), JSON.stringify({
    intent: `${label} adds a note to its own file`,
    requirements: [{ description: `The ${label} note SHALL be present in ${files.join(", ")}`,
      scenarios: [{ when: `${label} note is read`, then: "it is present" }] }],
    tasks: [{ outcome: `Add the ${label} note with a test`, verify: "node --test",
      paths: [...files, `test/${label}.test.js`] }]
  }));
  const started = w.cli("start", `.foundation/drafts/${label}.json`,
    "--approve-spec", "--decision-ref", "fixture://user/spec");
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const real = started.stdout.match(/CREATED (\S+)/)?.[1];
  assert.ok(real?.startsWith(label), started.stdout);
  w.ids[label] = real;
  return real;
}

const runtimePath = (w, label) => join(w.project, ".foundation/runtime", `${w.ids[label]}.json`);
export const runtimeText = (w, label) => readFileSync(runtimePath(w, label), "utf8");
export const status = (w, label) => JSON.parse(runtimeText(w, label)).status;

export function buildChange(w, label) {
  const built = w.cli("advance", label, "--through", "build");
  assert.match(built.stdout, /"action":"EDIT"/, built.stderr || built.stdout);
  return JSON.parse(runtimeText(w, label)).workspace.path;
}

export function proveChange(w, label) {
  const proven = w.cli("advance", label, "--through", "proven");
  assert.match(proven.stdout, /"reached":"proven"/, proven.stderr || proven.stdout);
}

// The scripted agent: transforms the change's sandbox files and writes the
// test that pins `<label>-edit` in the first of them.
export function agentEdit(sandbox, label, edits) {
  for (const [file, transform] of Object.entries(edits)) {
    const path = join(sandbox, file);
    writeFileSync(path, transform(readFileSync(path, "utf8")));
  }
  writeFileSync(join(sandbox, `test/${label}.test.js`),
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
    'import { readFileSync } from "node:fs";\n' +
    `test("${label}", () => assert.match(readFileSync(new URL("../${Object.keys(edits)[0]}", ` +
    `import.meta.url), "utf8"), /${label}-edit/));\n`);
}

export const replaceLine = (n, text) => (body) => {
  const lines = body.split("\n");
  lines[n - 1] = text;
  return lines.join("\n");
};
export const append = (text) => (body) => `${body}${text}\n`;

const outcomeOf = (result) => {
  const text = result.stdout.trim();
  try { return JSON.parse(text); } catch { return JSON.parse(text.split("\n").pop()); }
};
const AGENT_STOPS = new Set(["EDIT", "REPAIR", "ASK_USER", "BLOCKED"]);

// `advance --through archived`, resumed while the harness owns the next step.
// Returns every outcome; it never answers an agent or user stop.
export function landTrail(w, label, { limit = 4 } = {}) {
  const trail = [];
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const outcome = outcomeOf(w.cli("advance", label, "--through", "archived"));
    trail.push(outcome);
    if (outcome.action === "DONE" || AGENT_STOPS.has(outcome.action)) break;
  }
  return trail;
}

export function assertArchived(w, label, trail) {
  const last = trail.at(-1);
  assert.equal(last.action, "DONE",
    `${label}: ${JSON.stringify(trail.map((o) => [o.action, o.reason]))}`);
  assert.equal(last.reached, "archived");
  assert.equal(status(w, label), "archived");
  for (const outcome of trail)
    assert.notEqual(outcome.action, "ASK_USER", `${label} never asks the user: ${outcome.reason}`);
}

// An agent-owned conflict stop with an exact resume route, never a user ask.
export function assertAgentConflict(stop, w, label) {
  assert.ok(["REPAIR", "EDIT"].includes(stop.action), JSON.stringify(stop));
  assert.equal(stop.actor, "agent");
  assert.equal(stop.boundary, "conflict");
  assert.equal(stop.resumeCommand,
    `claude-foundation advance ${w.ids[label]} --through archived`);
}

// The route the harness took, recorded in the change's runtime record.
export const tookLandedSync = (w, label) => runtimeText(w, label).includes("[landed-change-sync]");

export function cleanup(w) { rmSync(w.temp, { recursive: true, force: true }); }
