import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEPENDENCY_FILES, dependencySnapshot, postLandInstall
} from "../runtime/workflow/apply-runtime.mjs";

const identity = (path) => existsSync(path) ? `file:${readFileSync(path, "utf8")}` : null;

function project(t, files) {
  const root = mkdtempSync(join(tmpdir(), "post-land-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return root;
}

function land(root, files) {
  const before = dependencySnapshot(root, identity);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return { before, after: dependencySnapshot(root, identity) };
}

function recorder(status = 0) {
  const calls = [];
  return { calls, run: (command, cwd) => { calls.push({ command, cwd }); return { status, stderr: status ? "E404 left-pad" : "" }; } };
}

test("the snapshot covers the manifest and every known lockfile", () => {
  assert.ok(DEPENDENCY_FILES.includes("package.json"));
  assert.ok(DEPENDENCY_FILES.includes("package-lock.json"));
});

test("a Land that changes the manifest and lockfile runs npm ci in the target and records ok", (t) => {
  const root = project(t, { "package.json": "{}", "package-lock.json": "{}" });
  const snapshots = land(root, { "package.json": '{"dependencies":{"a":"1"}}', "package-lock.json": '{"a":1}' });
  const { calls, run } = recorder(0);
  const result = postLandInstall({ ...snapshots, workspace: root, pathExists: existsSync, run });
  assert.deepEqual(calls, [{ command: "npm ci", cwd: root }]);
  assert.equal(result.status, "ok");
  assert.equal(result.command, "npm ci");
  assert.equal(result.exitCode, 0);
});

test("the configured setup command really runs in the target workspace", (t) => {
  const root = project(t, { "package.json": "{}", "package-lock.json": "{}" });
  const snapshots = land(root, { "package-lock.json": '{"b":1}' });
  const result = postLandInstall({
    ...snapshots, sandbox: { setupCommand: "echo installed > marker" }, workspace: root, pathExists: existsSync,
    run: (command, cwd) => spawnSync("sh", ["-c", command], { cwd, encoding: "utf8" })
  });
  assert.equal(result.status, "ok");
  assert.equal(result.source, "configured");
  assert.equal(readFileSync(join(root, "marker"), "utf8").trim(), "installed");
});

test("a Land that leaves the manifest and lockfiles unchanged runs no install", (t) => {
  const root = project(t, { "package.json": "{}", "package-lock.json": "{}", "src.js": "" });
  const snapshots = land(root, { "src.js": "export {}" });
  const { calls, run } = recorder(0);
  assert.equal(postLandInstall({ ...snapshots, workspace: root, pathExists: existsSync, run }), null);
  assert.deepEqual(calls, []);
});

test("installDependencies false without a setup command runs no install", (t) => {
  const root = project(t, { "package.json": "{}", "package-lock.json": "{}" });
  const snapshots = land(root, { "package-lock.json": '{"c":1}' });
  const { calls, run } = recorder(0);
  assert.equal(postLandInstall({
    ...snapshots, sandbox: { installDependencies: false }, workspace: root, pathExists: existsSync, run
  }), null);
  assert.deepEqual(calls, []);
});

test("a failed install is recorded as failed with the command to run and leaves the Land files", (t) => {
  const root = project(t, { "package.json": "{}", "package-lock.json": "{}" });
  const snapshots = land(root, { "package-lock.json": '{"d":1}' });
  const { run } = recorder(1);
  const result = postLandInstall({ ...snapshots, workspace: root, pathExists: existsSync, run });
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 1);
  assert.equal(result.command, "npm ci");
  assert.equal(result.workspace, root);
  assert.match(result.detail, /E404/);
  assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), '{"d":1}');
});
