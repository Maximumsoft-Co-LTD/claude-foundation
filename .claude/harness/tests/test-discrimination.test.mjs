import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  behaviorChangingWork, createTestDiscriminationRuntime, scopedTestCommand
} from "../runtime/evidence/test-discrimination.mjs";
import { configuredCommand } from "../runtime/evidence/evidence-results.mjs";
import { lightKind, packetWorkTypes } from "../runtime/workflow/validation/dev-document.mjs";
import { taskChangeIssue } from "../runtime/workflow/task-change.mjs";

const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

// A committed base with one passing test; the change is left uncommitted in
// the same checkout, the way a sandbox holds it.
function repository(root, name, base, change) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q");
  git(path, "config", "user.email", "fixture@example.invalid");
  git(path, "config", "user.name", "fixture");
  write(path, base);
  git(path, "add", "-A");
  git(path, "commit", "-qm", "base");
  const baseHead = git(path, "rev-parse", "HEAD");
  write(path, change);
  return { id: name, mode: "write", workspacePath: path, baseHead };
}

const GREET_BASE = {
  "package.json": "{\"type\":\"module\"}\n",
  "src/greet.js": "export function greet(name) { return `Hello ${name}`; }\n",
  "test/greet.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
    "import { greet } from '../src/greet.js';\n" +
    "test('greets', () => assert.match(greet('Ada'), /Ada/));\n"
};
const GREET_CHANGE = {
  "src/greet.js": "export function greet(name) { return `Hello, ${name}!`; }\n"
};

function harness({ repositories, workTypes = ["feature"], spawns = [], logs }) {
  const byId = new Map(repositories.map((row) => [row.id, row]));
  const state = { repositories: Object.fromEntries(repositories.map((row) =>
    [row.id, { baseHead: row.baseHead }])) };
  const surface = () => repositories.flatMap((row) => {
    const tracked = git(row.workspacePath, "diff", "--name-only", row.baseHead);
    const untracked = git(row.workspacePath, "ls-files", "--others", "--exclude-standard");
    return [...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean)
      .map((path) => ({ repositoryId: row.id, path }));
  });
  return createTestDiscriminationRuntime({
    LOGS: logs,
    requiredProviders: () => repositories.map((row) => `test-${row.id}`),
    providerConfig: () => ({ adapter: "command", command: ["node", "--test"] }),
    providerCapability: () => "test",
    providerRepository: (_id, provider) => byId.get(provider.slice(5)),
    selectedRepositories: () => repositories,
    repositoryBaseHead: (repository) => repository.baseHead,
    changedSurface: surface,
    pathKind: lightKind,
    changeWorkTypes: () => workTypes,
    receiptValidity: () => ({ validity: "valid" }),
    configuredCommand, fileDigest, stableHash,
    loadRuntime: () => state,
    // A nested `node --test` under this runner would report to it instead of
    // exiting with its own status.
    environment: Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => name !== "NODE_TEST_CONTEXT")),
    spawnCommandSync: (command, args, options) => {
      spawns.push({ command, args, cwd: options.cwd });
      return spawnSync(command, args, options);
    }
  });
}

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "discrimination-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a new test that also passes on the base source is a repair naming the file", (t) => {
  const root = fixtureRoot(t);
  const repo = repository(root, "root", GREET_BASE, {
    ...GREET_CHANGE,
    "test/greet-more.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "import { greet } from '../src/greet.js';\ntest('mentions the name', () => assert.match(greet('Lin'), /Lin/));\n"
  });
  const before = git(repo.workspacePath, "status", "--porcelain");
  const spawns = [];
  const result = harness({ repositories: [repo], spawns, logs: join(root, "logs") })
    .evaluate("change-a", "hash-a");
  assert.equal(result.status, "fail");
  assert.equal(result.repositories[0].outcome, "passes-on-base");
  assert.deepEqual(result.findings[0].paths, ["test/greet-more.test.js"]);
  assert.match(result.findings[0].message,
    /test\/greet-more\.test\.js .*pass on the original code.*do not verify the change/);
  // Only the change's test file runs, in a scratch copy outside the sandbox.
  assert.deepEqual(spawns[0].args, ["--test", "test/greet-more.test.js"]);
  assert.ok(!spawns[0].cwd.startsWith(repo.workspacePath));
  assert.equal(git(repo.workspacePath, "status", "--porcelain"), before);
  assert.equal(git(repo.workspacePath, "worktree", "list").split("\n").length, 1);
});

test("a new test that fails on base and passes on the change satisfies the rule, once", (t) => {
  const root = fixtureRoot(t);
  const repo = repository(root, "root", GREET_BASE, {
    ...GREET_CHANGE,
    "test/greet-format.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "import { greet } from '../src/greet.js';\ntest('formats', () => assert.equal(greet('Ada'), 'Hello, Ada!'));\n"
  });
  assert.equal(spawnSync("node", ["--test", "test/greet-format.test.js"],
    { cwd: repo.workspacePath }).status, 0, "the new test passes on the change");
  const spawns = [];
  const runtime = harness({ repositories: [repo], spawns, logs: join(root, "logs") });
  const first = runtime.evaluate("change-a", "hash-a");
  assert.equal(first.status, "pass");
  assert.equal(first.repositories[0].outcome, "fails-on-base");
  assert.deepEqual(first.findings, []);
  // Content-digest cache: an unchanged rerun repeats no command.
  const second = runtime.evaluate("change-a", "hash-a");
  assert.equal(second.status, "pass");
  assert.equal(second.repositories[0].cached, true);
  assert.equal(spawns.length, 1);
  // Changing the test file is new input and runs again.
  write(repo.workspacePath, { "test/greet-format.test.js": readFileSync(
    join(repo.workspacePath, "test/greet-format.test.js"), "utf8") + "// edited\n" });
  runtime.evaluate("change-a", "hash-b");
  assert.equal(spawns.length, 2);
});

test("refactor, docs, chore, and config work skip the rule without running anything", (t) => {
  const root = fixtureRoot(t);
  const repo = repository(root, "root", GREET_BASE, GREET_CHANGE);
  for (const workTypes of [["refactor"], ["docs"], ["chore", "config"], []]) {
    const spawns = [];
    const result = harness({ repositories: [repo], spawns, workTypes, logs: join(root, "logs") })
      .evaluate("change-a", "hash-a");
    assert.equal(result.status, "not-applicable", workTypes.join(","));
    assert.equal(spawns.length, 0);
  }
  assert.equal(behaviorChangingWork(["refactor", "bugfix"]), true);
  assert.equal(behaviorChangingWork(["code"]), true);
});

test("a test importing a module the change adds counts as failing on base", (t) => {
  const root = fixtureRoot(t);
  const repo = repository(root, "root", GREET_BASE, {
    "src/farewell.js": "export function farewell(name) { return `Bye ${name}`; }\n",
    "test/farewell.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "import { farewell } from '../src/farewell.js';\ntest('says bye', () => assert.match(farewell('Ada'), /Ada/));\n"
  });
  const result = harness({ repositories: [repo], logs: join(root, "logs") })
    .evaluate("change-a", "hash-a");
  assert.equal(result.status, "pass");
  assert.equal(result.repositories[0].outcome, "fails-on-base");
});

test("multi-repository changes are evaluated per repository", (t) => {
  const root = fixtureRoot(t);
  const api = repository(root, "api", GREET_BASE, {
    ...GREET_CHANGE,
    "test/greet-format.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "import { greet } from '../src/greet.js';\ntest('formats', () => assert.equal(greet('Ada'), 'Hello, Ada!'));\n"
  });
  const web = repository(root, "web", GREET_BASE, {
    ...GREET_CHANGE,
    "test/greet-again.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "import { greet } from '../src/greet.js';\ntest('still greets', () => assert.match(greet('Ada'), /Ada/));\n"
  });
  const docs = repository(root, "docs", { "README.md": "# Docs\n" }, { "README.md": "# Docs v2\n" });
  const result = harness({ repositories: [api, web, docs], logs: join(root, "logs") })
    .evaluate("change-a", "hash-a");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.repositories.map((row) => [row.repositoryId, row.outcome]), [
    ["api", "fails-on-base"], ["web", "passes-on-base"], ["docs", "no-product-change"]
  ]);
  assert.deepEqual(result.findings.map((row) => row.id), ["test-discrimination:web"]);
  assert.match(result.findings[0].message, /repository 'web'/);
});

test("a behavior change with no changed test runs the suite once on base", (t) => {
  const root = fixtureRoot(t);
  const repo = repository(root, "root", GREET_BASE, GREET_CHANGE);
  const spawns = [];
  const result = harness({ repositories: [repo], spawns, logs: join(root, "logs") })
    .evaluate("change-a", "hash-a");
  assert.equal(result.status, "fail");
  assert.deepEqual(spawns[0].args, ["--test"]);
  assert.match(result.findings[0].message, /no test in repository 'root' fails on the original code/);
  assert.deepEqual(readdirSync(join(root, "logs", "change-a", "test-discrimination"))
    .filter((name) => name.endsWith(".json")).length, 1);
});

test("test runners that take files are narrowed to the change's test files", () => {
  const files = ["tests/test_api.py"];
  assert.deepEqual(scopedTestCommand({ command: "node",
    args: ["--test", "--test-reporter", "tap", "test/"] }, ["test/a.test.js"]),
  { command: "node", args: ["--test", "--test-reporter", "tap", "test/a.test.js"] });
  assert.deepEqual(scopedTestCommand({ command: "pytest", args: ["-q", "tests"] }, files),
    { command: "pytest", args: ["-q", ...files] });
  assert.deepEqual(scopedTestCommand({ command: "python3", args: ["-m", "pytest", "-k", "api"] }, files),
    { command: "python3", args: ["-m", "pytest", "-k", "api", ...files] });
  assert.deepEqual(scopedTestCommand({ command: "go", args: ["test", "-count=1", "./..."] },
    ["pkg/store/store_test.go", "main_test.go"]),
  { command: "go", args: ["test", "-count=1", ".", "./pkg/store"] });
  assert.equal(scopedTestCommand({ command: "npm", args: ["test"] }, ["test/a.test.js"]), null);
  assert.equal(lightKind("pkg/store/store_test.go"), "test");
  assert.equal(lightKind("tests/test_api.py"), "test");
});

test("the compiled packet states the work type the rule reads", () => {
  assert.deepEqual(packetWorkTypes({ design: "# D\n\n## Work type\n\nfeature, api\n" }),
    ["feature", "api"]);
  assert.deepEqual(packetWorkTypes({
    proposal: "## Work type\n\ncode (inferred from paths; declare workType to override)\n"
  }), ["code"]);
  assert.deepEqual(packetWorkTypes({ proposal: "## Refactor invariants\n\n- same output\n" }),
    ["refactor"]);
  assert.deepEqual(packetWorkTypes({
    tasks: "- [ ] **T001** Update docs [paths:README.md] — verify: `true`\n"
  }), ["docs"]);
});

test("verify-only completion of a behavior task with no diff in its paths is refused", () => {
  const task = { id: "T001", kind: "implementation", paths: ["src/**"] };
  assert.match(taskChangeIssue({ workTypes: ["feature"], task, changedPaths: ["README.md"] }),
    /task T001 completed with no change.*src\/\*\*/);
  assert.equal(taskChangeIssue({ workTypes: ["feature"], task, changedPaths: ["src/a.js"] }), null);
  assert.equal(taskChangeIssue({ workTypes: ["refactor"], task, changedPaths: [] }), null);
  assert.equal(taskChangeIssue({ workTypes: ["feature"], task: { ...task, paths: [] },
    changedPaths: [] }), null);
  assert.equal(taskChangeIssue({ workTypes: ["feature"],
    task: { ...task, paths: ["docs/guide.md"] }, changedPaths: [] }), null);
});
