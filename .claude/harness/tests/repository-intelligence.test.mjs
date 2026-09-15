import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectRepositoryIntelligence } from
  "../runtime/workflow/validation/repository-intelligence.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "repository-intelligence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "src/auth", "src/integrations", "db/migrations", "tests", "openspec/specs/login",
    ".foundation", "node_modules/pkg"
  ]) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "src/auth/policy.ts"),
    "export function canLogin(role: string) { return role === 'admin'; }\n");
  writeFileSync(join(root, "src/integrations/client.ts"),
    "import { canLogin } from '../auth/policy';\nexport const webhook = canLogin('admin');\n");
  writeFileSync(join(root, "db/migrations/001_users.sql"), "CREATE TABLE users (role text);\n");
  writeFileSync(join(root, "tests/login.test.ts"),
    "import { canLogin } from '../src/auth/policy';\ntest('login', () => canLogin('admin'));\n");
  writeFileSync(join(root, "openspec/specs/login/spec.md"),
    "# Login Requirement\nScenario: administrator login\n");
  writeFileSync(join(root, ".foundation/secret.md"), "permission token\n");
  writeFileSync(join(root, "node_modules/pkg/index.js"), "export const ignored = true;\n");
  return root;
}

test("discovers, classifies, ranks, and maps repository evidence deterministically", async (t) => {
  const root = await fixture(t);
  const input = {
    projectRoot: root,
    query: ["administrator login", "webhook"],
    seedPaths: ["src/auth/policy.ts"],
    limits: { maxReadSet: 5 }
  };
  const first = inspectRepositoryIntelligence(input);
  const second = inspectRepositoryIntelligence(input);

  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  assert.equal(first.complete, true);
  assert.equal(first.candidates[0].path, "src/auth/policy.ts");
  assert.ok(first.candidates[0].reasons.includes("declared-seed"));
  assert.ok(first.readSet.length > 0 && first.readSet.length <= 5);
  assert.equal(first.readSet.every((row) => row.score > 0), true);
  assert.equal(first.readSet.some((row) => row.categories.includes("specs")), true);
  assert.equal(first.readSet.some((row) => row.categories.includes("tests")), true);
  assert.equal(first.readSet.some((row) => row.categories.includes("integrations")), true);
  assert.equal(first.readSet.some((row) => row.categories.includes("permissions")), true);
  assert.equal(first.candidates.some((row) => row.path.startsWith(".foundation/")), false);
  assert.equal(first.candidates.some((row) => row.path.startsWith("node_modules/")), false);
  assert.deepEqual(first.graph.dependencies, [
    { from: "src/integrations/client.ts", to: "src/auth/policy.ts", kind: "import",
      evidence: "../auth/policy" },
    { from: "tests/login.test.ts", to: "src/auth/policy.ts", kind: "import",
      evidence: "../src/auth/policy" }
  ]);
  assert.deepEqual(first.graph.callers.map((row) => row.caller), [
    "src/integrations/client.ts", "tests/login.test.ts"
  ]);
  assert.deepEqual(first.graph.tests, [{
    test: "tests/login.test.ts", target: "src/auth/policy.ts", evidence: "../src/auth/policy"
  }]);
});

test("read-set is bounded while preserving declared seeds and category coverage", async (t) => {
  const root = await fixture(t);
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "login",
    seedPaths: ["src/auth/policy.ts"],
    limits: { maxReadSet: 3 }
  });

  assert.equal(value.readSet.length, 3);
  assert.equal(value.readSet[0].path, "src/auth/policy.ts");
  assert.equal(new Set(value.readSet.map((row) => row.path)).size, 3);
});

test("git-visible allowlist omits ignored output and oversized irrelevant files", async (t) => {
  const root = await fixture(t);
  mkdirSync(join(root, "generated"), { recursive: true });
  writeFileSync(join(root, "generated/result.json"), "x".repeat(300_000));
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "login",
    trackedPaths: ["src/auth/policy.ts", "tests/login.test.ts"],
    includedPaths: ["src/auth/policy.ts", "tests/login.test.ts"]
  });

  assert.equal(value.status, "ready");
  assert.equal(value.candidates.some((row) => row.path.startsWith("generated/")), false);
  assert.equal(value.findings.some((row) => row.code === "scan-file-size-limit"), false);
});

test("oversized irrelevant fallback files are skipped without poisoning discovery", async (t) => {
  const root = await fixture(t);
  writeFileSync(join(root, "historical-output.json"), "x".repeat(300_000));
  const value = inspectRepositoryIntelligence({ projectRoot: root, query: "login" });

  assert.equal(value.status, "ready");
  assert.equal(value.findings.some((row) =>
    row.code === "scan-file-size-skipped" && row.path === "historical-output.json"), true);
  assert.equal(value.readSet.every((row) => row.score > 0), true);
});

test("an oversized declared seed still fails closed", async (t) => {
  const root = await fixture(t);
  writeFileSync(join(root, "required-contract.json"), "x".repeat(300_000));
  const value = inspectRepositoryIntelligence({
    projectRoot: root, query: "contract", seedPaths: ["required-contract.json"]
  });

  assert.equal(value.status, "blocked");
  assert.equal(value.findings.some((row) =>
    row.code === "scan-file-size-limit" && row.path === "required-contract.json"), true);
  assert.deepEqual(value.readSet, []);
});

test("Thai query tokens rank Thai source content without category filler", async (t) => {
  const root = await fixture(t);
  writeFileSync(join(root, "src/auth/thai.ts"),
    "export const policy = 'ผู้ดูแลระบบเข้าสู่ระบบ';\n");
  const value = inspectRepositoryIntelligence({
    projectRoot: root, query: "ผู้ดูแลระบบเข้าสู่ระบบ"
  });

  assert.equal(value.status, "ready");
  assert.equal(value.readSet[0].path, "src/auth/thai.ts");
  assert.equal(value.readSet.some((row) => row.path === "db/migrations/001_users.sql"), false);
});

test("graph reports unsupported local-language resolvers instead of claiming completeness", async (t) => {
  const root = await fixture(t);
  writeFileSync(join(root, "src/auth/lib.rs"), "mod policy;\n");
  writeFileSync(join(root, "src/auth/main.go"), "package auth\nimport \"example/local/policy\"\n");
  const value = inspectRepositoryIntelligence({ projectRoot: root, query: "policy" });

  assert.equal(value.graph.completeness.status, "partial");
  assert.deepEqual(value.graph.completeness.unsupported, ["go", "rust"]);
});

test("tracked content under a normally excluded directory can be included explicitly", async (t) => {
  const root = await fixture(t);
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "ignored",
    trackedPaths: ["node_modules", "node_modules/pkg", "node_modules/pkg/index.js"]
  });

  assert.equal(value.candidates.some((row) => row.path === "node_modules/pkg/index.js"), true);
});

test("symlinks are never followed and are reported without making coverage partial", async (t) => {
  const root = await fixture(t);
  symlinkSync(join(root, "src/auth/policy.ts"), join(root, "policy-link.ts"));
  const value = inspectRepositoryIntelligence({ projectRoot: root, query: "policy" });

  assert.equal(value.status, "ready");
  assert.deepEqual(value.findings, [{ code: "scan-symlink-skipped", path: "policy-link.ts" }]);
  assert.equal(value.candidates.some((row) => row.path === "policy-link.ts"), false);
});

test("hard scan limits fail closed without returning partial candidates or graph", async (t) => {
  const root = await fixture(t);
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "login",
    limits: { maxFiles: 2 }
  });

  assert.equal(value.status, "blocked");
  assert.equal(value.complete, false);
  assert.equal(value.findings.some((row) => row.code === "scan-file-limit"), true);
  assert.deepEqual(value.candidates, []);
  assert.deepEqual(value.readSet, []);
  assert.deepEqual(value.graph.dependencies, []);
});

test("a declared seed that was not scanned fails closed", async (t) => {
  const root = await fixture(t);
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "login",
    seedPaths: ["missing.ts"]
  });

  assert.equal(value.status, "blocked");
  assert.equal(value.findings.some((row) =>
    row.code === "seed-not-discovered" && row.path === "missing.ts"), true);
  assert.deepEqual(value.readSet, []);
});

test("dependency graph limits fail closed rather than returning a partial map", async (t) => {
  const root = await fixture(t);
  writeFileSync(join(root, "src/entry.ts"),
    "import './auth/policy';\nimport './integrations/client';\n");
  const value = inspectRepositoryIntelligence({
    projectRoot: root,
    query: "login",
    limits: { maxGraphEdges: 1 }
  });

  assert.equal(value.status, "blocked");
  assert.equal(value.findings.some((row) => row.code === "scan-graph-edge-limit"), true);
  assert.deepEqual(value.graph.dependencies, []);
});

test("filesystem errors fail closed and injected adapters make behavior testable", () => {
  const fs = {
    realpath: (path) => path,
    readdir: () => { const error = new Error("denied"); error.code = "EACCES"; throw error; },
    readFile: () => { throw new Error("unexpected read"); }
  };
  const value = inspectRepositoryIntelligence({
    projectRoot: "/project", query: "login", fs
  });

  assert.equal(value.status, "blocked");
  assert.deepEqual(value.findings, [{
    code: "scan-directory-unreadable", path: "", detail: "EACCES", blocking: true
  }]);
  assert.deepEqual(value.readSet, []);
});
