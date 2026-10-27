import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  amendmentPrompt, describeLandRoute, landPrompt, midBuildTrigger, midLandTrigger, runLifecycle, stackedPrompt
} from "../openspec-native/lifecycle.mjs";
import {
  backendLandArgs, changeLoopAuthority, hostSessionRecords, lifecycleOutcome,
  mergeHostExecutions, oracleRepairPrompt, remainingTimeoutMs
} from "../openspec-native/run.mjs";
import { buildScorecard, lifecycleSummary } from "../openspec-native/scorecard.mjs";

const PHASES = fileURLToPath(new URL("../tasks/25-order-inventory-lifecycle/phases", import.meta.url));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const json = (path, value) => write(path, `${JSON.stringify(value)}\n`);
const state = (project, id) => JSON.parse(readFileSync(join(project, ".foundation/runtime", `${id}.json`), "utf8"));

// A stand-in for `foundation.mjs advance <id> --through archived`: it moves a
// proven change through applied-uncommitted and applied to archived with
// pauses long enough for the driver to crash it in between, and resumes from
// wherever a crashed run left the state.
const STUB_HARNESS = `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [, , command, id] = process.argv;
const file = join(process.cwd(), '.foundation/runtime', id + '.json');
const load = () => JSON.parse(readFileSync(file, 'utf8'));
const save = (value) => writeFileSync(file, JSON.stringify(value));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
if (command !== 'advance') process.exit(0);
let value = load();
if (value.status === 'proven') {
  value.repositories = { backend: { delivery: { status: 'applied-uncommitted' } } };
  save(value); await pause(300);
  value.status = 'applied'; save(value); await pause(300);
}
if (value.status === 'applied') {
  const packet = join(process.cwd(), 'openspec/changes/archive/2026-10-26-' + id);
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, 'proposal.md'), '# Change\\n\\n## Appendix: Amendment history\\n');
  writeFileSync(join(packet, 'tasks.md'), '- [x] **T001** done\\n');
  value.status = 'archived'; value.archivedAt = new Date().toISOString();
  value.archivedChangePath = 'openspec/changes/archive/2026-10-26-' + id;
  save(value);
}
`;

function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

function fakeProject(t) {
  const project = mkdtempSync(join(tmpdir(), "lifecycle-driver-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const id of ["backend", "sdk", "web"]) {
    write(join(project, id, "server.mjs"), "export const base = true;\n");
    git(project, "init", "-q", id);
    git(join(project, id), "add", "-A");
    git(join(project, id), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  }
  write(join(project, ".claude/harness/foundation.mjs"), STUB_HARNESS);
  mkdirSync(join(project, ".foundation/runtime"), { recursive: true });
  return project;
}

const envelope = (cost) => `${JSON.stringify({ type: "result", subtype: "success", is_error: false,
  total_cost_usd: cost, usage: { input_tokens: 1, output_tokens: 1 } })}\n`;
const stopwatch = () => ({ wallMs: 10, startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(), startedEpochMs: Date.now() });

// Behaves like the host for each lifecycle phase, keyed by the prompt.
function fakeHost(project, { interruptBuild = true } = {}) {
  const calls = [];
  const runClaude = async (options) => {
    calls.push(options.prompt.split("\n")[0].slice(0, 60));
    const base = { exitCode: 0, timedOut: false, budgetExhausted: null, decisionBoundary: null,
      terminalReached: null, interrupted: null, stdout: "", stderr: "", observedModelRequests: 4,
      observedToolCalls: 6, stopwatch: stopwatch() };
    if (options.prompt.includes("implement ORDER-INVENTORY.md")) {
      json(join(project, ".foundation/runtime/change-a.json"), { id: "change-a", status: "build" });
      if (!interruptBuild) {
        json(join(project, ".foundation/runtime/change-a.json"), { id: "change-a", status: "proven" });
        return { ...base, stdout: envelope(1), terminalReached: { changeId: "change-a", status: "proven" } };
      }
      write(join(project, ".foundation/repository-sandboxes/change-a/backend/server.mjs"), "export const work = 1;\n");
      for (let tick = 0; tick < 100; tick += 1) {
        if (options.killWhen({ project })) return { ...base, exitCode: 1,
          interrupted: { observedAt: new Date().toISOString(), wallMs: 5, requests: 3, toolCalls: 5 } };
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("the mid-Build trigger never fired");
    }
    if (options.prompt.includes("requirement update 1")) {
      assert.ok(existsSync(join(project, "AMENDMENT-1.md")), "the update is delivered before the session");
      json(join(project, ".foundation/runtime/change-a.json"),
        { id: "change-a", status: "proven", amendments: [{ version: 1, reason: "requirement update 1" }] });
      return { ...base, stdout: envelope(2), terminalReached: { changeId: "change-a", status: "proven" } };
    }
    if (options.prompt.includes("CATALOGUE-PAGING.md")) {
      assert.equal(state(project, "change-a").status, "proven", "B branches while A is unlanded");
      json(join(project, ".foundation/runtime/change-b.json"), { id: "change-b", status: "proven" });
      return { ...base, stdout: envelope(3), terminalReached: { changeId: "change-b", status: "proven" } };
    }
    throw new Error(`unexpected session: ${options.prompt.slice(0, 80)}`);
  };
  return { runClaude, calls };
}

const passOracle = () => ({ configured: true, measurement: "measured", verdict: "pass", score: 3, max: 3,
  results: { CASE_A: "pass", CASE_B: "pass", CASE_C: "pass" }, reason: null, source: "fake" });

async function lifecycle(project, host, overrides = {}) {
  const calls = [];
  const result = await runLifecycle({
    project,
    args: { prompt: "/dev implement ORDER-INVENTORY.md", oracle: "/fake/oracle.sh", "timeout-ms": "600000",
      "max-cost-usd": "60", "claude-arg": [], "test-self-review": "true", "test-land": "true",
      "final-envelope-grace-ms": "0" },
    config: { phases_dir: PHASES, amendment: { file: "AMENDMENT-1.md" }, stacked: { file: "CATALOGUE-PAGING.md" },
      interrupted_session_budget_usd: 8, max_oracle_repairs: 1, max_merge_sessions: 1 },
    deps: { runClaude: host.runClaude, runBenchmarkOracle: (call) => { calls.push(process.env.ORDER_ORACLE_SCOPE);
      return overrides.oracle ? overrides.oracle(call) : passOracle(); },
    mergeHostExecutions, remainingTimeoutMs, oracleRepairPrompt, changeLoopAuthority, backendLandArgs,
    hostSessionRecords }
  });
  return { ...result, scopes: calls };
}

test("mid-Build and mid-Land triggers observe project state without writing", (t) => {
  const project = fakeProject(t);
  assert.equal(midBuildTrigger(project), false);
  write(join(project, ".foundation/repository-sandboxes/c/backend/server.mjs"), "export const base = true;\n");
  assert.equal(midBuildTrigger(project), false, "an untouched sandbox is not work");
  write(join(project, ".foundation/repository-sandboxes/c/backend/server.mjs"), "export const work = 1;\n");
  assert.equal(midBuildTrigger(project), true);

  json(join(project, ".foundation/runtime/c.json"), { status: "proven" });
  assert.equal(midLandTrigger(project, "c"), false);
  json(join(project, ".foundation/runtime/c.json"),
    { status: "proven", repositories: { backend: { delivery: { status: "applied-uncommitted" } } } });
  assert.equal(midLandTrigger(project, "c"), true);
  json(join(project, ".foundation/runtime/c.json"), { status: "applied" });
  assert.equal(midLandTrigger(project, "c"), true);
  json(join(project, ".foundation/runtime/c.json"), { status: "archived",
    repositories: { backend: { delivery: { status: "applied-uncommitted" } } } });
  assert.equal(midLandTrigger(project, "c"), false, "an archived change is past the crash window");
});

test("phase prompts name the change, the delivered file and the boundaries", () => {
  const amend = amendmentPrompt("c1", "AMENDMENT-1.md");
  assert.match(amend, /Resume existing change c1/);
  assert.match(amend, /requirement update 1, written in AMENDMENT-1\.md/);
  assert.match(amend, /change amend/);
  assert.match(amend, /advance c1 --through proven/);
  assert.match(amend, /Do not Land/);
  const stacked = stackedPrompt("CATALOGUE-PAGING.md", "c1");
  assert.match(stacked, /implement CATALOGUE-PAGING\.md as a new, separate change/);
  assert.match(stacked, /do not modify, amend, abandon or Land it/);
  const route = describeLandRoute(JSON.stringify({ action: "REPAIR", errorCode: "REPOSITORY_DELIVERY_FAILED",
    reason: "Land would overwrite an uncommitted target edit in 'backend': server.mjs",
    instruction: "apply the named fix", resumeCommand: "claude-foundation advance c2 --through archived", noise: 1 }));
  assert.match(route, /error REPOSITORY_DELIVERY_FAILED; reason: Land would overwrite/);
  assert.doesNotMatch(route, /noise/);
  assert.equal(describeLandRoute("plain failure text"), "plain failure text");
  assert.equal(describeLandRoute(""), "no output");
  const land = landPrompt("c2", "c1", route);
  assert.match(land, /Land existing change c2\. Change c1 has already landed/);
  assert.match(land, /advance c2 --through archived\. A previous attempt returned: action REPAIR/);
  assert.match(land, /Do not modify, undo or re-land c1/);
  for (const file of ["AMENDMENT-1.md", "CATALOGUE-PAGING.md"])
    assert.ok(existsSync(join(PHASES, file)), file);
});

test("the lane runs amendment, two crashes and a stacked Land in order", async (t) => {
  const project = fakeProject(t);
  const host = fakeHost(project);
  const run = await lifecycle(project, host);
  assert.deepEqual(host.calls.map((line) => line.slice(0, 22)), [
    "/dev implement ORDER-I", "Resume existing change", "/dev implement CATALOG"]);
  assert.equal(run.changeIds.a, "change-a");
  assert.equal(run.changeIds.b, "change-b");
  assert.equal(run.summary.strict, true, JSON.stringify(run.summary.checks));
  assert.deepEqual(run.summary.landOrder, ["change-a", "change-b"]);
  assert.deepEqual(run.summary.interruptions.map((row) => row.phase), ["a-build", "a-land"]);
  assert.ok(run.summary.interruptions[1].repositories.backend, "the crash records the partial Land");
  assert.equal(state(project, "change-a").status, "archived");
  assert.equal(state(project, "change-b").status, "archived");
  assert.deepEqual(run.scopes, ["a", "b", "full"], "A gates alone, B gates alone, the landed tree grades full");
  for (const row of Object.values(run.summary.checks)) assert.equal(row.status, "pass");
  // The killed session has no envelope: its cost is charged at its allowance
  // and stays unmeasured rather than becoming zero.
  const sessions = hostSessionRecords(run.execution);
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].unmeasuredChargeUsd, 8);
  assert.equal(Number.isFinite(sessions[0].cost.value), false);
  assert.ok(run.execution.stopwatch.wallMs > 0);
  const card = lifecycleSummary(run.summary);
  assert.equal(card.strict, true);
  assert.equal(card.checks["land-order"].status, "pass");
});

test("a host that finishes before the crash trigger cannot pass the lane", async (t) => {
  const project = fakeProject(t);
  const run = await lifecycle(project, fakeHost(project, { interruptBuild: false }));
  assert.equal(run.summary.strict, false);
  assert.equal(run.summary.checks["interrupt-mid-build-injected"].status, "fail");
  const outcome = lifecycleOutcome({ status: "completed", failureClass: null }, run);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.failureClass, "lifecycle-check-failed");
});

test("a failing final oracle fails the lane even though both changes archived", async (t) => {
  const project = fakeProject(t);
  const failing = { ...passOracle(), verdict: "fail", score: 2, results: { CASE_A: "pass", CASE_B: "pass", CASE_C: "fail" } };
  let scopeCalls = 0;
  const run = await lifecycle(project, fakeHost(project), {
    oracle: () => (process.env.ORDER_ORACLE_SCOPE === "full" && ++scopeCalls ? failing : passOracle())
  });
  assert.equal(run.summary.landOrder.length, 2);
  assert.equal(run.summary.checks["final-oracle"].status, "fail");
  assert.equal(run.summary.strict, false);
});

test("an exhausted cost allowance stops the lane and keeps unknown cost unknown", async (t) => {
  const project = fakeProject(t);
  const host = fakeHost(project);
  const result = await runLifecycle({
    project,
    args: { prompt: "/dev implement ORDER-INVENTORY.md", oracle: "/fake/oracle.sh", "timeout-ms": "600000",
      "max-cost-usd": "8", "claude-arg": [], "test-self-review": "true", "test-land": "true" },
    config: { phases_dir: PHASES, amendment: { file: "AMENDMENT-1.md" }, stacked: { file: "CATALOGUE-PAGING.md" },
      interrupted_session_budget_usd: 8 },
    deps: { runClaude: host.runClaude, runBenchmarkOracle: passOracle, mergeHostExecutions, remainingTimeoutMs,
      oracleRepairPrompt, changeLoopAuthority, backendLandArgs, hostSessionRecords }
  });
  assert.equal(result.stop.kind, "budget");
  assert.equal(host.calls.length, 1, "no session runs after the crashed one used the whole allowance");
  assert.equal(result.summary.strict, false);
  assert.ok(result.summary.phases.some((phase) => phase.status === "not-run"));
});

test("lifecycle outcome and summary keep gaps visible", () => {
  assert.deepEqual(lifecycleOutcome({ status: "completed" }, { summary: { strict: true } }), { status: "completed" });
  assert.equal(lifecycleOutcome({ status: "incomplete" }, { summary: { strict: false }, stop: { kind: "budget" } })
    .failureClass, "budget-exhausted-budget");
  const summary = lifecycleSummary({ protocol: "p", checks: { x: { status: "weird" }, y: { status: "pass", detail: 1 } } });
  assert.equal(summary.strict, false);
  assert.equal(summary.checks.x.status, "unavailable");
  assert.equal(summary.checks.y.detail, 1);
  const card = buildScorecard({ scenario: "s", arm: "change-loop", repeat: 1, runId: "r", lifecycle: summary,
    config: {}, envelope: {}, metrics: {}, quality: null, operationRows: [], hostTelemetry: {}, hostUsage: {},
    stopwatch: {}, outcome: { status: "failed", failureClass: "x", changeId: null, workflowStatus: null,
      pendingTasks: null, requiredEvidencePassed: null, proofStatus: null, landStatus: null },
    oracle: null, provenance: {} });
  assert.equal(card.lifecycle.checks.y.status, "pass");
});
