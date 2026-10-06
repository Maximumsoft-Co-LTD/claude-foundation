import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  inspectRepositoryIntelligence, repositoryIntelligenceRequired, skippedRepositoryIntelligence
} from "../runtime/workflow/validation/repository-intelligence.mjs";
import { createChangeLifecycle } from "../runtime/workflow/change-lifecycle.mjs";

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

// Dogfooding: a consumer's source scan selected `.claude/harness/**` files.
test("a consumer's managed install paths are not product sources unless seeded", async (t) => {
  const root = await fixture(t);
  for (const directory of [".claude/harness/runtime", ".claude/skills/change", "openspec/schemas/x"])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, ".claude/harness/runtime/policy.mjs"), "export const permission = 'admin';\n");
  writeFileSync(join(root, ".claude/skills/change/SKILL.md"), "permission login\n");
  writeFileSync(join(root, "WORKFLOW.md"), "permission login\n");
  const managed = (row) => /^(?:\.claude\/(?:harness|skills)|WORKFLOW\.md)/.test(row.path);
  const consumer = inspectRepositoryIntelligence({ projectRoot: root, query: "permission login" });
  assert.equal(consumer.status, "ready");
  assert.equal(consumer.candidates.some(managed), false);
  const seeded = inspectRepositoryIntelligence({ projectRoot: root, query: "permission",
    seedPaths: [".claude/harness/runtime/policy.mjs"] });
  assert.equal(seeded.status, "ready");
  assert.deepEqual(seeded.candidates.filter(managed).map((row) => row.path),
    [".claude/harness/runtime/policy.mjs"]);
  // The upstream source tree (it carries install.sh) keeps its harness sources.
  writeFileSync(join(root, "install.sh"), "#!/bin/sh\n");
  const upstream = inspectRepositoryIntelligence({ projectRoot: root, query: "permission login" });
  assert.equal(upstream.candidates.some(managed), true);
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

test("repository discovery runs only for the standard lane or medium-plus risk", () => {
  const rapid = { impact: "low", coupling: "isolated", securityTriggers: ["none"] };
  assert.equal(repositoryIntelligenceRequired(rapid), false);
  assert.equal(repositoryIntelligenceRequired({}), false);
  assert.equal(repositoryIntelligenceRequired(rapid, { standardLane: true }), true);
  for (const change of [
    { impact: "medium" }, { impact: "high" }, { coupling: "coupled" },
    { securityTriggers: ["auth"] }, { reviewRequired: true },
    { acceptance: { required: true } }, { riskSignals: ["access-control"] },
    { integrations: [{ name: "billing" }] }, { externalOperations: [{ kind: "deploy" }] }
  ]) assert.equal(repositoryIntelligenceRequired({ ...rapid, ...change }), true,
    JSON.stringify(change));
  const skipped = skippedRepositoryIntelligence();
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.complete, false);
  // Nothing was scanned: unknown stays null, never a measured zero.
  assert.equal(skipped.scan, null);
  assert.equal(skipped.candidates, null);
  assert.equal(skipped.graph, null);
  assert.deepEqual(skipped.readSet, []);
});

test("rapid draft inspection skips the repository scan; medium impact runs it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "repository-intelligence-lane-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "specs"), { recursive: true });
  writeFileSync(join(root, "README.md"), "readme\n");
  let scans = 0;
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    slugify: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    measureStage: (_stage, operation) => operation(),
    git: (args) => {
      if (args[0] === "ls-files") scans += 1;
      return { status: 0, stdout: "README.md\0" };
    },
    changePath: (id) => join(root, "openspec", "changes", id),
    loadRuntime: () => ({}), saveRuntime: () => {}, setOperationChangeId: () => {},
    initialBudget: () => ({}), gitHead: () => "head", preexistingDirty: () => [],
    now: () => "2026-09-30T00:00:00.000Z", bindClaudeSession: () => {},
    validate: () => {}, rollbackStart: () => []
  });
  const inspect = (impact) => {
    const draftPath = `draft-${impact}.json`;
    writeFileSync(join(root, draftPath), JSON.stringify({
      version: 4, intent: "Adjust the readme wording", impact, coupling: "isolated",
      securityTriggers: [], acceptance: { required: false }
    }));
    return lifecycle.inspectDraft(draftPath, { quiet: true });
  };
  const rapid = inspect("low");
  assert.equal(scans, 0);
  assert.equal(rapid.intelligence.repository.status, "skipped");
  assert.equal(rapid.intelligence.repository.complete, false);
  assert.equal(rapid.intelligence.repository.scan, null);
  assert.deepEqual(rapid.intelligence.repository.selectedSources, []);
  const medium = inspect("medium");
  assert.ok(scans > 0);
  assert.equal(medium.intelligence.repository.status, "ready");
});
