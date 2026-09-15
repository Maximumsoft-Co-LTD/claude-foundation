import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditReferenceGovernance } from "./reference-governance.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "reference-governance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "change", "references"), { recursive: true });
  writeFileSync(join(root, "change", "SKILL.md"),
    "# Change\n\nRead [workflow](references/workflow.md#source-contract).\n");
  writeFileSync(join(root, "change", "references", "workflow.md"),
    "# Source contract\n\nA short canonical contract.\n");
  return root;
}

test("audits reachable references and heading fragments", (t) => {
  assert.deepEqual(auditReferenceGovernance(fixture(t)), []);
});

test("reports unresolved anchors and orphaned lifecycle references", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "change", "SKILL.md"),
    "# Change\n\nRead [workflow](references/workflow.md#missing).\n");
  writeFileSync(join(root, "change", "references", "orphan.md"), "# Orphan\n");
  const issues = auditReferenceGovernance(root);
  assert.ok(issues.some((issue) => issue.includes("unresolved anchor")));
  assert.ok(issues.some((issue) => issue.includes("orphan.md is not reachable")));
});

test("reports duplicated long blocks inside one bundle", (t) => {
  const root = fixture(t);
  const repeated = "This canonical paragraph deliberately contains enough distinct words to " +
    "exercise ownership governance across separate reference documents while preserving the " +
    "same lifecycle semantics, authority boundary, recovery route, evidence source, durable " +
    "state, validation rule, and user decision contract without ambiguity or hidden behavior.";
  writeFileSync(join(root, "change", "SKILL.md"),
    "# Change\n\nRead `references/workflow.md` and `references/duplicate.md`.\n");
  writeFileSync(join(root, "change", "references", "workflow.md"), `# Workflow\n\n${repeated}\n`);
  writeFileSync(join(root, "change", "references", "duplicate.md"), `# Duplicate\n\n${repeated}\n`);
  assert.ok(auditReferenceGovernance(root).some((issue) => issue.includes("duplicate a long block")));
});

test("reports near-duplicate ownership drift across skill bundles", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "testing", "references"), { recursive: true });
  writeFileSync(join(root, "testing", "SKILL.md"),
    "# Testing\n\nRead `references/design.md`.\n");
  const original = "A canonical reference must keep every durable lifecycle boundary in one " +
    "owned location so future agents can resolve authority, persistence, evidence, recovery, " +
    "validation, compatibility, user decisions, source freshness, and completion without " +
    "loading conflicting instructions from several files that slowly drift apart over time.";
  const near = original.replace("future agents", "later agents");
  writeFileSync(join(root, "change", "references", "workflow.md"), `# Source contract\n\n${original}\n`);
  writeFileSync(join(root, "testing", "references", "design.md"), `# Design\n\n${near}\n`);
  assert.ok(auditReferenceGovernance(root).some((issue) => issue.includes("near-duplicate")));
});

test("Investigate harness-ownership prose is backed by runtime enforcement", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const workflow = readFileSync(join(root,
    ".claude/skills/investigate/references/workflow.md"), "utf8");
  const runtime = readFileSync(join(root,
    ".claude/harness/runtime/workflow/investigation-runtime.mjs"), "utf8");
  const guard = readFileSync(join(root, ".claude/hooks/phase-mutation-guard.mjs"), "utf8");
  const execution = readFileSync(join(root,
    ".claude/harness/runtime/core/execution-contract.mjs"), "utf8");
  assert.match(workflow, /harness owns boundaries, persistence, and resume routing/i);
  assert.match(runtime, /sourceInventory/);
  assert.match(runtime, /noProgress/);
  assert.match(guard, /phase === "investigate"/);
  assert.match(execution, /capability\.phase === "investigate"/);
});
