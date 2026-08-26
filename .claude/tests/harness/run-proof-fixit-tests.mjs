// The changed-surface blocker's recovery text.
//
// The defect this pins: readiness listed every undeclared path and then made
// the agent reconstruct the `[paths:]` annotation by hand — a consumer round
// hit that block ten times. The recovery must restate the same paths in the
// exact form `tasks.md` accepts, and stay silent when the surface is declared.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createProofReadinessRuntime,
  recoveryCommands,
  recoveryInstructions,
  recoveryLines,
  recoverySummaryLine
} from "../../harness/runtime/evidence/proof-readiness.mjs";

// A packet directory real enough for the readiness scan: only tasks.md is read.
const packet = mkdtempSync(join(tmpdir(), "proof-fixit-"));
mkdirSync(packet, { recursive: true });
writeFileSync(join(packet, "tasks.md"), "- [ ] **T001** work [repo:api] [paths:api/src/**]\n");

function runtimeWith({ changed, repositories = { root: {}, api: {} } }) {
  return createProofReadinessRuntime({
    evidence: () => ({ providers: {} }),
    loadRuntime: () => ({ repositories }),
    taskBlocks: () => [{ id: "T001" }],
    activeChangePath: () => packet,
    taskMetadata: () => ({ repository: "api", paths: ["api/src/**"] }),
    canonicalChangedSurface: () => changed,
    selectedRepositories: () => [{ id: "api", mode: "write" }],
    providerCapability: () => null,
    providerConfig: () => ({}),
    advisoryCapabilities: () => [],
    evidenceDetectionValue: () => ({}),
    validate: () => {},
    relevantHash: () => "hash",
    executionNodes: () => ({ unconfigured: [], unavailable: [] }),
    pendingTasks: () => [],
    activeChangeLeases: () => [],
    activeRepositoryConflicts: () => [],
    changePath: () => packet,
    proofPath: () => join(packet, "proof.json"),
    readJson: () => ({}),
    writeJson: () => {},
    saveRuntime: () => {},
    fail: (message) => { throw new Error(message); }
  });
}

test("an undeclared path raises the issue and collects fix-it details", () => {
  const runtime = runtimeWith({
    changed: [
      { repositoryId: "api", path: "api/src/index.js" },
      { repositoryId: "api", path: "api/test/new.spec.js" }
    ]
  });
  const details = [];
  const issues = runtime.changedSurfaceIssues("fixit-change", details);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /changed outside task paths: api\/test\/new\.spec\.js/);
  assert.deepEqual(details, [
    { repositoryId: "api", paths: ["api/test/new.spec.js"] }
  ]);
});

test("a fully declared surface stays silent and collects nothing", () => {
  const runtime = runtimeWith({
    changed: [{ repositoryId: "api", path: "api/src/deep/nested.js" }]
  });
  const details = [];
  assert.deepEqual(runtime.changedSurfaceIssues("fixit-change", details), []);
  assert.deepEqual(details, []);
});

test("a single-repository change still rejects writes outside task scope", () => {
  const runtime = runtimeWith({
    repositories: { api: {} },
    changed: [{ repositoryId: "api", path: "api/test/rogue.spec.js" }]
  });
  assert.match(runtime.changedSurfaceIssues("fixit-change")[0],
    /changed outside task paths: api\/test\/rogue\.spec\.js/);
});

test("configuration recovery leads with a paste-ready annotation", () => {
  const runtime = runtimeWith({ changed: [] });
  const recovery = runtime.configurationRecovery("fixit-change", ["issue"], [
    { repositoryId: "api", paths: ["api/test/new.spec.js", "api/fixtures/data.json"] }
  ]);
  assert.equal(recovery[0].kind, "declare-surface");
  assert.match(recovery[0].reason, /\[paths:\]/);
  assert.deepEqual(recovery[0].choices, [
    { instruction: "repository 'api': [paths:api/test/new.spec.js,api/fixtures/data.json]" }
  ]);
});

test("recovery without fix-its keeps its established shape", () => {
  const runtime = runtimeWith({ changed: [] });
  const recovery = runtime.configurationRecovery("fixit-change", ["issue"]);
  assert.equal(recovery[0].kind, "diagnose");
  assert.equal(recovery.length, 2);
});

test("the readiness value routes fix-its into the recovery entries", () => {
  const runtime = runtimeWith({
    changed: [{ repositoryId: "api", path: "api/test/new.spec.js" }]
  });
  const value = runtime.proofReadinessValue("fixit-change", "prove");
  assert.equal(value.status, "CONFIGURATION_ERROR");
  assert.equal(value.next[0].kind, "declare-surface");
  assert.match(value.next[0].choices[0].instruction,
    /repository 'api': \[paths:api\/test\/new\.spec\.js\]/);
});

test("recovery prose preserves summaries, commands, decisions and instructions", () => {
  const detailed = {
    provider: "browser",
    decision: {
      summary: "Choose how to continue",
      options: [{ outcome: "Use the recorded result" }, {}, null]
    },
    reason: "summary takes precedence",
    wiring: { command: "wire browser" },
    request: { command: "request browser", packet: "open packet" },
    verify: "verify browser",
    choices: [
      { command: "wire browser", instruction: "Run the browser check" },
      { verify: "verify fallback" },
      null
    ]
  };
  assert.equal(recoverySummaryLine(detailed),
    "  browser: Choose how to continue");
  assert.deepEqual(recoveryCommands(detailed), [
    "wire browser", "request browser", "open packet", "verify browser", "verify fallback"
  ]);
  assert.deepEqual(recoveryInstructions(detailed), [
    "Use the recorded result", "Run the browser check"
  ]);
  assert.deepEqual(recoveryLines([null, detailed, { reason: "Retry later" }, {}]), [
    "  browser: Choose how to continue",
    "    wire browser",
    "    request browser",
    "    open packet",
    "    verify browser",
    "    verify fallback",
    "    - Use the recorded result",
    "    - Run the browser check",
    "  Retry later"
  ]);
  assert.equal(recoverySummaryLine({}), null);
  assert.deepEqual(recoveryLines(), []);
});
