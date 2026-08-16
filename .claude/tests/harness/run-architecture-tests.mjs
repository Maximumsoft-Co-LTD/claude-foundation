#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { dependencyFindings } from "./architecture-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const RUNTIME = join(ROOT, ".claude", "harness", "runtime");
let assertions = 0;
const pass = (message) => { assertions += 1; console.log(`  PASS: ${message}`); };

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

assert.deepEqual(dependencyFindings(RUNTIME), []);
pass("shipped runtime imports follow the domain dependency graph");

const fixture = mkdtempSync(join(tmpdir(), "foundation-architecture-"));
try {
  const runtime = join(fixture, ".claude", "harness", "runtime");
  mkdirSync(join(runtime, "core"), { recursive: true });
  mkdirSync(join(runtime, "workflow"), { recursive: true });
  writeFileSync(join(runtime, "workflow", "task.mjs"), "export const task = true;\n");
  writeFileSync(join(runtime, "core", "bad-static.mjs"),
    'import { task } from "../workflow/task.mjs";\nexport { task };\n');
  writeFileSync(join(runtime, "core", "bad-dynamic.mjs"),
    'export const task = await import("../workflow/task.mjs");\n');
  writeFileSync(join(runtime, "core", "bad-require.mjs"),
    'const task = require("../workflow/task.mjs");\nexport { task };\n');
  writeFileSync(join(runtime, "core", "bad-loader.mjs"),
    'import { createRequire } from "node:module";\n' +
    'const runtimeRequire = createRequire(import.meta.url);\n' +
    'export const task = runtimeRequire("../workflow/task.mjs");\n');
  const findings = dependencyFindings(runtime);
  assert.equal(findings.length, 4);
  assert.ok(findings.every((finding) => finding.sourceDomain === "core"));
  assert.ok(findings.every((finding) => finding.targetDomain === "workflow"));
  pass("architecture guard detects static, dynamic, require, and createRequire reverse dependencies");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

for (const path of walk(join(ROOT, ".claude", "harness"))
  .filter((candidate) => candidate.endsWith(".mjs"))) {
  const checked = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  assert.equal(checked.status, 0, `${path}: ${checked.stderr || checked.stdout}`);
}
pass("every shipped harness module parses as JavaScript");

const workflow = readFileSync(join(ROOT, ".github", "workflows", "workflow-tests.yml"), "utf8");
for (const required of [
  "'.claude/**'", "'openspec/**'", "'dashboard/**'", "'install-*.sh'",
  "'package.json'", "'package-lock.json'", "'foundation.json'"
]) {
  const count = workflow.split(required).length - 1;
  assert.equal(count, 2, `${required} must trigger workflow-tests on pull_request and push`);
}
pass("CI path filters cover every tested product surface");

console.log(`architecture contract tests: ALL PASS (${assertions}/${assertions} assertions)`);
