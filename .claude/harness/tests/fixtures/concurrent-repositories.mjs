import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Model-free driver for stacked changes in a multi-repository consumer: two
// external child repositories (`backend`, `sdk`) under a control root that is
// not itself a Git repository. Changes are started from one base, built in
// their repository sandboxes by script, and landed through the real CLI. The
// shared helpers (landing trail, archive assertions, cleanup) are the root
// suites' own.
export { assertArchived, cleanup, landTrail, status } from "./concurrent-changes.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const REPOSITORIES = ["backend", "sdk"];
const lines = (count) => `${Array.from({ length: count }, (unused, i) => `shared line ${i + 1}`).join("\n")}\n`;

export function repositoriesWorld() {
  const temp = mkdtempSync(join(tmpdir(), "foundation-stacked-repositories-"));
  const project = join(temp, "consumer");
  mkdirSync(project, { recursive: true });
  const run = (command, args, cwd = project) => execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  for (const repository of REPOSITORIES) {
    mkdirSync(join(project, repository, "test"), { recursive: true });
    writeFileSync(join(project, repository, "package.json"),
      `{"name":"${repository}","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n`);
    writeFileSync(join(project, repository, "shared.txt"), lines(30));
    writeFileSync(join(project, repository, "other.txt"), "other base\n");
    writeFileSync(join(project, repository, "test/base.test.js"),
      'import test from "node:test";\ntest("base", () => {});\n');
  }
  writeFileSync(join(project, "package.json"),
    '{"name":"consumer","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n');
  writeFileSync(join(project, ".gitignore"), ".foundation/\n");
  run("bash", [join(sourceRoot, "install.sh"), project, "--source", sourceRoot, "--yes"], sourceRoot);
  mkdirSync(join(project, "openspec"), { recursive: true });
  writeFileSync(join(project, "openspec/repositories.yaml"), `${JSON.stringify({
    version: 1,
    repositories: REPOSITORIES.map((id, index) => ({
      id, path: id, type: "external", mode: "write", dependsOn: index ? [REPOSITORIES[index - 1]] : []
    }))
  }, null, 2)}\n`);
  const policyPath = join(project, "foundation.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.workflow.grounding = "optional";
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  for (const repository of REPOSITORIES) {
    const cwd = join(project, repository);
    run("git", ["-c", "init.defaultBranch=main", "init", "-q"], cwd);
    run("git", ["config", "user.email", "fixture@example.test"], cwd);
    run("git", ["config", "user.name", "Fixture"], cwd);
    run("git", ["add", "-A"], cwd);
    run("git", ["commit", "-qm", "seed"], cwd);
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.FOUNDATION_CLAUDE_SESSION_ID;
  const ids = {};
  const cli = (...argv) => spawnSync("node",
    [".claude/harness/foundation.mjs", ...argv.map((arg) => ids[arg] || arg)],
    { cwd: project, encoding: "utf8", env });
  const read = (file) => readFileSync(join(project, file), "utf8");
  return { temp, project, cli, read, ids, run };
}

// Starts one change whose single task edits `files` of `repository` and a test.
export function startRepositoryChange(w, label, repository, files) {
  mkdirSync(join(w.project, ".foundation/drafts"), { recursive: true });
  writeFileSync(join(w.project, ".foundation/drafts", `${label}.json`), JSON.stringify({
    intent: `${label} edits ${repository} files`,
    repositories: [{ id: repository, mode: "write" }],
    requirements: [{ capability: `${label}-note`,
      description: `The ${label} note SHALL be present in ${repository}/${files[0]}`,
      scenarios: [{ when: `${label} note is read`, then: "it is present" }] }],
    tasks: [{ outcome: `Add the ${label} note with a test`, verify: "node --test", repository,
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

export const repositorySandbox = (w, label, repository) =>
  join(w.project, ".foundation/repository-sandboxes", w.ids[label], repository);

// Opens Build for the change and returns its repository sandbox.
export function buildRepositoryChange(w, label, repository) {
  const built = w.cli("advance", label, "--through", "build");
  assert.match(built.stdout, /"action":"EDIT"/, built.stderr || built.stdout);
  return repositorySandbox(w, label, repository);
}

export function proveRepositoryChange(w, label) {
  const proven = w.cli("advance", label, "--through", "proven");
  assert.match(proven.stdout, /"reached":"proven"/, proven.stderr || proven.stdout);
}

// The scripted agent: transforms files of one repository sandbox and writes
// the test that pins the change.
export function editRepositorySandbox(sandbox, label, edits) {
  for (const [file, transform] of Object.entries(edits)) {
    const path = join(sandbox, file);
    // A file the sandbox does not have yet starts empty.
    writeFileSync(path, transform(existsSync(path) ? readFileSync(path, "utf8") : ""));
  }
  writeFileSync(join(sandbox, `test/${label}.test.js`),
    `import test from "node:test";\ntest("${label}", () => {});\n`);
}

export const replaceLine = (n, text) => (body) => {
  const rows = body.split("\n");
  rows[n - 1] = text;
  return rows.join("\n");
};

// One change in one repository, built and proven; returns its sandbox.
export function singleRepositoryChange(w, label, repository, edits, files = ["shared.txt"]) {
  startRepositoryChange(w, label, repository, files);
  const sandbox = buildRepositoryChange(w, label, repository);
  editRepositorySandbox(sandbox, label, edits);
  proveRepositoryChange(w, label);
  return sandbox;
}

// Two changes in one repository, both built and proven from one base.
export function stackedPair(w, repository, aEdits, bEdits, files = ["shared.txt"]) {
  const sandboxes = {};
  for (const [label, edits] of [["alpha", aEdits], ["bravo", bEdits]]) {
    startRepositoryChange(w, label, repository, files);
  }
  for (const [label, edits] of [["alpha", aEdits], ["bravo", bEdits]]) {
    sandboxes[label] = buildRepositoryChange(w, label, repository);
    editRepositorySandbox(sandboxes[label], label, edits);
    proveRepositoryChange(w, label);
  }
  return sandboxes;
}
