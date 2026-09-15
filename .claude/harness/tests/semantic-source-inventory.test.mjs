import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectSemanticSources,
  semanticSourceFreshnessFindings
} from "../runtime/workflow/validation/semantic-source-inventory.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "semantic-source-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "README.md"), "contract\n");
  writeFileSync(join(root, "src", "app.mjs"), "export const value = 1;\n");
  return root;
}

test("inventory is path-sorted and hashes exact file bytes deterministically", async (t) => {
  const root = await fixture(t);
  const first = inspectSemanticSources({
    projectRoot: root,
    sourcePaths: ["src/app.mjs", "README.md"]
  });
  const second = inspectSemanticSources({
    projectRoot: root,
    sourcePaths: ["README.md", "src/app.mjs"]
  });

  assert.deepEqual(first.findings, []);
  assert.deepEqual(first.staleFindings, []);
  assert.deepEqual(first.inventory, second.inventory);
  assert.deepEqual(first.inventory.sources.map((row) => row.path), [
    "README.md", "src/app.mjs"
  ]);
  assert.equal(first.inventory.sources[0].bytes, 9);
  assert.match(first.inventory.sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(first.inventory.digest, /^sha256:[a-f0-9]{64}$/);
});

test("inventory rejects invalid, duplicate, missing, directory, and escaping sources", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  symlinkSync(join(outside, "README.md"), join(root, "outside-link"));
  const value = inspectSemanticSources({
    projectRoot: root,
    sourcePaths: [
      "README.md", "README.md", "missing.md", "src", "outside-link", "../outside", "/tmp/file"
    ]
  });

  assert.deepEqual(value.inventory.sources.map((row) => row.path), ["README.md"]);
  assert.deepEqual(value.findings.map((row) => row.code).sort(), [
    "duplicate-source-path",
    "invalid-source-path",
    "source-missing",
    "source-not-file",
    "source-outside-project",
    "source-outside-project"
  ]);
});

test("inventory follows a contained symlink while preserving its declared path", async (t) => {
  const root = await fixture(t);
  symlinkSync(join(root, "README.md"), join(root, "readme-link"));

  const value = inspectSemanticSources({
    projectRoot: root, sourcePaths: ["readme-link"]
  });
  assert.deepEqual(value.findings, []);
  assert.equal(value.inventory.sources[0].path, "readme-link");
});

test("freshness reports changed, removed, and newly declared sources", async (t) => {
  const root = await fixture(t);
  const baseline = inspectSemanticSources({
    projectRoot: root,
    sourcePaths: ["README.md", "src/app.mjs"]
  }).inventory;
  writeFileSync(join(root, "README.md"), "changed\n");
  writeFileSync(join(root, "new.md"), "new\n");
  const current = inspectSemanticSources({
    projectRoot: root,
    sourcePaths: ["README.md", "new.md"],
    baseline
  });

  assert.deepEqual(current.staleFindings.map((row) => [row.code, row.path]), [
    ["source-digest-changed", "README.md"],
    ["source-missing", "src/app.mjs"],
    ["source-added", "new.md"]
  ]);
  assert.equal(current.staleFindings[0].detail.expected,
    baseline.sources.find((row) => row.path === "README.md").sha256);
});

test("freshness comparison is pure and accepts inventory rows directly", () => {
  const before = [{ path: "a", sha256: "old", bytes: 1 }];
  const after = [{ path: "a", sha256: "new", bytes: 1 }];
  const snapshot = structuredClone(before);

  assert.deepEqual(semanticSourceFreshnessFindings(before, after), [{
    code: "source-digest-changed",
    path: "a",
    detail: { expected: "old", actual: "new" }
  }]);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(semanticSourceFreshnessFindings(null, after), []);
});

test("filesystem dependencies are injectable without creating harness state", () => {
  const files = new Map([["/project/source.md", Buffer.from("source")]]);
  const fs = {
    realpath: (path) => path,
    lstat: (path) => ({
      isSymbolicLink: () => false,
      isFile: () => files.has(path)
    }),
    readFile: (path) => files.get(path)
  };
  const value = inspectSemanticSources({
    projectRoot: "/project", sourcePaths: ["source.md"], fs
  });

  assert.deepEqual(value.findings, []);
  assert.equal(value.inventory.sources[0].bytes, 6);
});
