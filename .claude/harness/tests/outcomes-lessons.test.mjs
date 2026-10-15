import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createOutcomesRuntime } from "../runtime/observability/outcomes-runtime.mjs";
import {
  createLessonsRuntime, minChangesValue, suggestedCheck
} from "../runtime/observability/lessons-runtime.mjs";

const FOUNDATION = fileURLToPath(new URL("../foundation.mjs", import.meta.url));
// Directories every runtime invocation ensures exist; a real store has them.
const STORE_DIRECTORIES = ["runtime", "receipts", "logs", "evidence", "snapshots",
  "transactions", "plans", "leases", "attestations", "authority", "handoffs",
  "instruction-manifests"];

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : `${JSON.stringify(content)}\n`);
}

// A project whose .foundation store the test fills directly.
function project(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-outcomes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  write(join(root, ".claude", "harness", "foundation.mjs"), "// project marker\n");
  mkdirSync(join(root, "openspec", "changes"), { recursive: true });
  for (const name of STORE_DIRECTORIES) mkdirSync(join(root, ".foundation", name), { recursive: true });
  const store = join(root, ".foundation");
  const change = (id, state, { proofRuns = null, attempts = [], events = null,
    operations = null, workType = "feature", runPrefix = "proof-" } = {}) => {
    const archivedChangePath = `openspec/changes/archive/2026-10-01-${id}`;
    write(join(root, archivedChangePath, "design.md"), `# Design\n\n## Work type\n\n${workType}\n`);
    write(join(store, "runtime", `${id}.json`), {
      version: 2, id, status: "archived", impact: "medium", archivedChangePath, ...state
    });
    if (proofRuns !== null) {
      mkdirSync(join(store, "evidence", id), { recursive: true });
      for (let run = 1; run <= proofRuns; run += 1)
        mkdirSync(join(store, "evidence", id, `${runPrefix}${run}`), { recursive: true });
    }
    attempts.forEach((attempt, index) => write(join(store, "evidence", id, "review-attempts",
      `${String(index + 1).padStart(4, "0")}-attempt.json`), { changeId: id, attempt: index + 1, ...attempt }));
    if (events) write(join(store, "logs", id, "events.jsonl"),
      events.map((row) => JSON.stringify(row)).join("\n") + "\n");
    if (operations) write(join(store, "logs", id, "operations.jsonl"),
      operations.map((row) => JSON.stringify(row)).join("\n") + "\n");
  };
  return { root, store, change };
}

function attemptRecords(store) {
  return (id) => {
    const dir = join(store, "evidence", id, "review-attempts");
    try {
      return readdirSync(dir).sort().map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
    } catch { return []; }
  };
}

function outcomes(fixture) {
  return createOutcomesRuntime({
    runtimeDir: join(fixture.store, "runtime"), evidenceDir: join(fixture.store, "evidence"),
    logsDir: join(fixture.store, "logs"),
    changeWorkTypes: (_id, state) => state.testWorkTypes || ["feature"],
    reviewAttemptRecords: attemptRecords(fixture.store)
  }).outcomesValue();
}

function lessons(fixture, minChanges) {
  return createLessonsRuntime({
    runtimeDir: join(fixture.store, "runtime"), evidenceDir: join(fixture.store, "evidence"),
    logsDir: join(fixture.store, "logs"), reviewAttemptRecords: attemptRecords(fixture.store),
    fail: (message) => { throw new Error(message); }
  }).lessonsValue(minChanges);
}

function run(fixture, ...args) {
  return spawnSync(process.execPath, [FOUNDATION, ...args], {
    cwd: fixture.root, encoding: "utf8",
    env: { ...process.env, CLAUDE_FOUNDATION_PROJECT: fixture.root, FOUNDATION_TELEMETRY: "1" }
  });
}

// Every path and file byte under .foundation.
function storeDigest(store) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      hash.update(`${relative(store, path)}\0`);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  walk(store);
  return hash.digest("hex");
}

test("outcomes counts advance collect-* proof runs like proof-* runs", (t) => {
  const fixture = project(t);
  fixture.change("once", {}, { proofRuns: 1, runPrefix: "collect-" });
  fixture.change("twice", {}, { proofRuns: 2, runPrefix: "collect-" });
  const [once, twice] = outcomes(fixture).changes;
  assert.deepEqual([once.proofRuns, once.firstProofPass], [1, true]);
  assert.deepEqual([twice.proofRuns, twice.firstProofPass], [2, false]);
});

test("outcomes summarizes archived changes and a cohort rate over known values", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1, attempts: [{ status: "completed", resultStatus: "pass" }],
    events: [{ cost: 0.25 }, { cost: "0.5" }, { cost: null }] });
  fixture.change("b", {}, { proofRuns: 2, events: [{ cost: 1 }] });
  fixture.change("c", { status: "building" }, { proofRuns: 1 });
  const value = outcomes(fixture);
  assert.deepEqual(value.changes.map((row) => row.id), ["a", "b"], "only archived changes count");
  const [a, b] = value.changes;
  assert.equal(a.firstProofPass, true);
  assert.equal(a.proofRuns, 1);
  assert.equal(a.reviewRepairRounds, 0);
  assert.equal(a.cost, 0.75);
  assert.equal(b.firstProofPass, false);
  assert.equal(value.cohorts.length, 1);
  assert.equal(value.cohorts[0].key, "feature|medium|none");
  assert.deepEqual(value.cohorts[0].firstProofPass, { rate: 0.5, denominator: 2, unknownCount: 0 });
});

test("a review repair round prevents a first-proof pass", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1, attempts: [
    { status: "completed", resultStatus: "fail" }, { status: "completed", resultStatus: "pass" }] });
  const [row] = outcomes(fixture).changes;
  assert.equal(row.reviewRepairRounds, 1);
  assert.equal(row.firstProofPass, false);
});

test("unknown values stay null and count as unknown, never as 0", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1, events: [{ cost: 2 }] });
  fixture.change("b", {}, { proofRuns: 1 });
  fixture.change("c", {});
  const value = outcomes(fixture);
  const byId = Object.fromEntries(value.changes.map((row) => [row.id, row]));
  assert.equal(byId.b.cost, null, "no events.jsonl means unknown cost");
  assert.equal(byId.c.firstProofPass, null, "no evidence directory means unknown");
  assert.equal(byId.c.proofRuns, null);
  const [cohort] = value.cohorts;
  assert.deepEqual(cohort.cost, { total: 2, mean: 2, denominator: 1, unknownCount: 2 });
  assert.deepEqual(cohort.firstProofPass, { rate: 1, denominator: 2, unknownCount: 1 });
});

test("escaped defects come from later changes that declared fixes", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1 });
  fixture.change("b", { fixes: ["a"] }, { proofRuns: 1 });
  const value = outcomes(fixture);
  const byId = Object.fromEntries(value.changes.map((row) => [row.id, row]));
  assert.equal(byId.a.escapedDefects, 1);
  assert.deepEqual(byId.a.fixedBy, ["b"]);
  assert.equal(byId.b.escapedDefects, 0);
  assert.equal(value.availability.escapedDefects, "declared-only");
});

test("user decisions count recorded answers, waivers, and grounding reopens", (t) => {
  const fixture = project(t);
  fixture.change("a", {
    advanceRecovery: { answers: [{ choice: "retry" }], attempts: [{ action: "REPAIR" }] },
    waivers: [{ capability: "review" }],
    groundingReopens: [{ reason: "x" }, { reason: "y" }],
    amendments: [{ revision: 1 }],
    riskSignals: ["security", "data"], impact: "high",
    testWorkTypes: ["feature", "api"]
  }, { proofRuns: 1 });
  const [row] = outcomes(fixture).changes;
  assert.equal(row.userDecisions, 4);
  assert.equal(row.amendments, 1);
  assert.equal(row.cohort, "api+feature|high|data+security");
});

test("an unparseable runtime state is skipped with a reason", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1 });
  write(join(fixture.store, "runtime", "broken.json"), "{not json");
  const value = outcomes(fixture);
  assert.deepEqual(value.skipped, [{ id: "broken", reason: "runtime-state-unparseable" }]);
  assert.deepEqual(value.changes.map((row) => row.id), ["a"]);
});

test("outcomes with no history exits 0 with empty lists and writes nothing", (t) => {
  const fixture = project(t);
  const before = storeDigest(fixture.store);
  const result = run(fixture, "outcomes");
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value.changes, []);
  assert.deepEqual(value.cohorts, []);
  assert.equal(storeDigest(fixture.store), before);
});

test("outcomes and lessons leave the store digest unchanged", (t) => {
  const fixture = project(t);
  fixture.change("a", {}, { proofRuns: 1, events: [{ cost: 1 }],
    operations: [{ status: "blocked", blocker: { code: "contract-invalid", reason: "r" } }] });
  fixture.change("b", { fixes: ["a"] }, { proofRuns: 2,
    attempts: [{ status: "completed", resultStatus: "fail", findings: [{ id: "F", code: "missing-authz" }] }] });
  write(join(fixture.store, "runtime", "broken.json"), "{not json");
  const before = storeDigest(fixture.store);
  for (const args of [["outcomes"], ["outcomes", "--pretty"], ["lessons"],
    ["lessons", "--pretty", "--min-changes", "2"]]) {
    const result = run(fixture, ...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.equal(storeDigest(fixture.store), before, `${args.join(" ")} changed the store`);
  }
  const pretty = run(fixture, "outcomes", "--pretty").stdout;
  assert.match(pretty, /Outcomes: 2 archived change\(s\)/);
  assert.match(pretty, /broken \(runtime-state-unparseable\)/);
  const json = JSON.parse(run(fixture, "outcomes").stdout);
  assert.equal(json.changes.find((row) => row.id === "a").cohort, "feature|medium|none",
    "the composition root reads the archived design's work type");
});

test("a blocker code recurring across three changes becomes a lesson", (t) => {
  const fixture = project(t);
  for (const id of ["a", "b", "c"])
    fixture.change(id, {}, { operations: [
      { status: "blocked", blocker: { code: "contract-invalid", reason: "secret /tmp/path detail" } },
      { status: "completed", blocker: null }
    ] });
  const value = lessons(fixture, 3);
  assert.equal(value.lessons.length, 1);
  assert.deepEqual(value.lessons[0], {
    code: "contract-invalid", source: "blocker", changeCount: 3, changes: ["a", "b", "c"],
    occurrences: 3, suggestedCheck: "contract-compatibility-check", route: "/change"
  });
  assert.doesNotMatch(JSON.stringify(value), /secret|\/tmp\/path/,
    "free-text reasons are never exported");
});

test("a code below the threshold is not a lesson", (t) => {
  const fixture = project(t);
  for (const id of ["a", "b"])
    fixture.change(id, {}, { proofRuns: 1, attempts: [{ status: "completed",
      resultStatus: "fail", findings: [{ id: "F1", severity: "major", code: "missing-authz",
        message: "private reviewer prose" }] }] });
  assert.deepEqual(lessons(fixture, 3).lessons, []);
  const lowered = lessons(fixture, 2).lessons;
  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].source, "review");
  assert.equal(lowered[0].suggestedCheck, "authorization-test");
  assert.doesNotMatch(JSON.stringify(lowered), /private reviewer prose/);
});

test("uncoded findings and untyped blockers are reported apart from lessons", (t) => {
  const fixture = project(t);
  const findings = Array.from({ length: 33 }, (_, index) =>
    ({ id: `F${index}`, severity: "minor", message: "m" }));
  for (const id of ["a", "b", "c"])
    fixture.change(id, {}, { proofRuns: 1,
      attempts: [{ status: "completed", resultStatus: "fail", findings }],
      operations: [{ status: "blocked", blocker: { code: "untyped" } },
        { status: "blocked", blocker: null },
        { status: "blocked", blocker: { code: "Not A Code" } }] });
  const value = lessons(fixture, 3);
  assert.equal(value.uncoded.review, 99);
  assert.equal(value.uncoded.blocker, 9);
  assert.deepEqual(value.lessons, []);
});

test("min-changes must be an integer of at least 2", (t) => {
  assert.equal(minChangesValue(undefined), 3);
  assert.equal(minChangesValue("2"), 2);
  for (const raw of ["0", "1", "2.5", "-3", "x", true]) assert.equal(minChangesValue(raw), null);
  const fixture = project(t);
  const result = run(fixture, "lessons", "--min-changes", "0");
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /min-changes must be an integer of at least 2/);
  const empty = run(fixture, "lessons");
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout),
    { version: 1, minChanges: 3, lessons: [], uncoded: { blocker: 0, review: 0 } });
  assert.notEqual(run(fixture, "outcomes", "some-change").status, 0,
    "outcomes takes no change id");
});

test("the code to check mapping is fixed", () => {
  assert.equal(suggestedCheck("authority-required"), "authorization-test");
  assert.equal(suggestedCheck("permission-denied"), "authorization-test");
  assert.equal(suggestedCheck("missing-authz"), "authorization-test");
  assert.equal(suggestedCheck("contract-invalid"), "contract-compatibility-check");
  assert.equal(suggestedCheck("workspace-boundary"), "dependency-rule");
  assert.equal(suggestedCheck("idempotency-missing"), "idempotency-test");
  assert.equal(suggestedCheck("resource-conflict"), "investigate");
});
