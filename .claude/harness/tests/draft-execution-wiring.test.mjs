import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDraftFolder } from "../runtime/workflow/draft-folder.mjs";
import { atomicStartPreflight } from "../runtime/workflow/change-lifecycle.mjs";

const EXECUTION = {
  version: 1,
  providers: {
    browser: { adapter: "command", command: ["node", "scripts/screenshot.mjs"],
      inputMode: "browser-automation" },
    visual: { capability: "visual", screenshots: ["test-results/**"], dependsOn: ["browser"] }
  },
  services: {}
};

function folder(t, { change = {}, execution } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "draft-execution-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "change.json"), JSON.stringify({ version: 5, intent: "x", ...change }));
  writeFileSync(join(dir, "proposal.md"), "## Why\n\nBecause.\n");
  if (execution !== undefined)
    writeFileSync(join(dir, "execution.yaml"),
      typeof execution === "string" ? execution : JSON.stringify(execution));
  return dir;
}

test("a draft folder's execution.yaml becomes the draft's execution", (t) => {
  const { draft, issues } = loadDraftFolder(folder(t, { execution: EXECUTION }));
  assert.deepEqual(issues, []);
  assert.deepEqual(draft.execution, EXECUTION);
});

test("execution in both change.json and execution.yaml is an issue naming one home", (t) => {
  const { issues } = loadDraftFolder(folder(t, { change: { execution: EXECUTION }, execution: EXECUTION }));
  assert.ok(issues.some((issue) => /both change\.json and execution\.yaml; keep one/.test(issue)), issues.join("\n"));
});

test("an execution.yaml that is not JSON is an issue naming the file and the JSON form", (t) => {
  const { draft, issues } = loadDraftFolder(folder(t, { execution: "providers:\n  browser: {}\n" }));
  assert.ok(issues.some((issue) => /execution\.yaml must be JSON .*"version": 1, "providers"/.test(issue)),
    issues.join("\n"));
  assert.equal(draft.execution, undefined);
});

test("a draft without execution.yaml loads exactly as before", (t) => {
  const { draft, issues } = loadDraftFolder(folder(t));
  assert.deepEqual(issues, []);
  assert.equal(draft.execution, undefined);
});

test("draft execution without version names the required form", () => {
  const { issues } = atomicStartPreflight({
    version: 5, intent: "x", acceptance: { required: false, reason: null, claimIds: [] },
    execution: { providers: EXECUTION.providers }
  });
  assert.ok(issues.some((issue) =>
    /requires executable evidence wiring: execution must be \{"version": 1, "providers"/.test(issue)),
  issues.join("\n"));
});
