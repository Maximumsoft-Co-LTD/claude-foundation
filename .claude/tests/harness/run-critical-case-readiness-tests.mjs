// Declared critical cases are checked before Prove, not after.
//
// The defect this pins: a critical case is only matched against test titles
// once the suite has run, so a Build that declared `criticalCases` in
// execution.yaml and never tagged the covering test handed Prove a change that
// looked ready — `pendingTasks` empty, every automated provider wired — and
// then failed evidence collection on `test:fail` every single time. A live
// 2026-08-23 loop lost a whole Prove session to it.
//
// The check must be a necessary condition only: the ID has to appear literally
// somewhere in the workspace for the title match to be possible, but a present
// ID may still fail at run time. It must never invent a blocker — not when the
// ID is present, not across repositories, and not when the search itself could
// not answer.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProofReadinessRuntime } from "../../harness/runtime/evidence/proof-readiness.mjs";

const packet = mkdtempSync(join(tmpdir(), "critical-case-"));
mkdirSync(packet, { recursive: true });
writeFileSync(join(packet, "tasks.md"), "- [ ] **T001** work [paths:src/**]\n");

const MISS = { status: 1, stdout: "", stderr: "" };
const HIT = { status: 0, stdout: "test/unit.test.mjs\n", stderr: "" };
const UNANSWERED = { status: 128, stdout: "", stderr: "not a git repository" };

// Each repository needs its own existing workspace, so the fake `git` can tell
// which one it was asked about from the cwd alone.
const workspaces = new Map();
function workspaceFor(id) {
  if (!workspaces.has(id)) {
    const path = join(packet, `workspace-${id}`);
    mkdirSync(path, { recursive: true });
    workspaces.set(id, path);
  }
  return workspaces.get(id);
}

// `providers` maps provider name to its execution.yaml config.
// `grep` answers per repository id; anything unlisted defaults to MISS.
function runtimeWith({ providers, grep = {}, repositories = ["root"] }) {
  const calls = [];
  return {
    calls,
    runtime: createProofReadinessRuntime({
      evidence: () => ({ providers }),
      loadRuntime: () => ({}),
      taskBlocks: () => [{ id: "T001" }],
      activeChangePath: () => packet,
      taskMetadata: () => ({ repository: "root", paths: ["src/**"] }),
      canonicalChangedSurface: () => [],
      selectedRepositories: () => repositories.map((id) => ({
        id, mode: "write", workspacePath: workspaceFor(id)
      })),
      providerCapability: () => null,
      providerConfig: (_id, provider) => providers[provider] || null,
      git: (args, cwd) => {
        calls.push({ args, cwd });
        const repository = repositories.find((id) => cwd.endsWith(id)) || repositories[0];
        return grep[repository] || grep.default || MISS;
      },
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
    })
  };
}

const testProvider = { test: { adapter: "test-discovery", criticalCases: ["boundary-inclusive"] } };

test("a declared critical case no file carries is reported with its tag form", () => {
  const { runtime } = runtimeWith({ providers: testProvider });
  const issues = runtime.criticalCaseIssues("change");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /critical case 'boundary-inclusive'/);
  assert.match(issues[0], /provider 'test'/);
  assert.match(issues[0], /\[boundary-inclusive\]/);
});

test("a critical case the workspace carries raises nothing", () => {
  const { runtime } = runtimeWith({ providers: testProvider, grep: { default: HIT } });
  assert.deepEqual(runtime.criticalCaseIssues("change"), []);
});

test("a search that could not answer never invents a blocker", () => {
  const { runtime } = runtimeWith({ providers: testProvider, grep: { default: UNANSWERED } });
  assert.deepEqual(runtime.criticalCaseIssues("change"), []);
});

test("a provider declaring no critical cases is not searched at all", () => {
  const { runtime, calls } = runtimeWith({ providers: { test: { adapter: "test-discovery" } } });
  assert.deepEqual(runtime.criticalCaseIssues("change"), []);
  assert.equal(calls.length, 0);
});

test("the change packet is excluded so a declaration cannot satisfy itself", () => {
  const { runtime, calls } = runtimeWith({ providers: testProvider });
  runtime.criticalCaseIssues("change");
  assert.ok(calls[0].args.includes(":(exclude)openspec/changes"),
    "execution.yaml and grounding.yaml both name the ID they declare");
  assert.ok(calls[0].args.includes(":(exclude).foundation"),
    "nested workspaces carry the same packet");
  assert.ok(calls[0].args.includes("--untracked"),
    "Build's new test file is not committed in the sandbox yet");
});

test("one repository carrying the ID satisfies a multi-repository provider", () => {
  const { runtime } = runtimeWith({
    providers: testProvider,
    repositories: ["root", "api"],
    grep: { root: MISS, api: HIT }
  });
  assert.deepEqual(runtime.criticalCaseIssues("change"), []);
});

test("a case missing from every repository names all of them once", () => {
  const { runtime } = runtimeWith({
    providers: testProvider,
    repositories: ["root", "api"],
    grep: { default: MISS }
  });
  const issues = runtime.criticalCaseIssues("change");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /'root', 'api'/);
});

test("two providers sharing one config report a single gap, not one each", () => {
  // `test-discovery` runs one command for the test and discovery providers off
  // the same config, so a per-provider loop double-reports every missing tag.
  const { runtime } = runtimeWith({
    providers: {
      test: { adapter: "test-discovery", criticalCases: ["boundary-inclusive"] },
      discovery: { adapter: "test-discovery", criticalCases: ["boundary-inclusive"] }
    }
  });
  const issues = runtime.criticalCaseIssues("change");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /'test', 'discovery'/);
});

test("readiness blocks at Prove instead of reporting the change ready", () => {
  const { runtime } = runtimeWith({ providers: testProvider });
  const value = runtime.proofReadinessValue("change", "prove");
  assert.equal(value.status, "CONFIGURATION_ERROR");
  assert.deepEqual(value.pendingTasks, []);
  assert.ok(value.issues.some((issue) => issue.includes("boundary-inclusive")));
});

test("Build's own readiness is not gated on a tag Build has not written yet", () => {
  const { runtime } = runtimeWith({ providers: testProvider });
  const value = runtime.proofReadinessValue("change", "build");
  assert.notEqual(value.status, "CONFIGURATION_ERROR");
});
