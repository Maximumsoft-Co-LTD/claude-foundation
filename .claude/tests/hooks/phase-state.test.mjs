import assert from "node:assert/strict";
import test from "node:test";

import { recordedPhase, recordedPhaseContext } from "../../hooks/phase-state.mjs";

const directory = (name, isDirectory = true) => ({
  name, isDirectory: () => isDirectory
});

function context(overrides = {}) {
  const rows = {
    "/repo/.foundation/logs/old/phase-context.jsonl":
      '{"timestamp":"2026-08-27T00:00:00Z","phase":"change"}\n',
    "/repo/.foundation/logs/new/phase-context.jsonl":
      'ignored\n{"timestamp":"2026-08-27T01:00:00Z","phase":"prove"}\n'
  };
  const active = new Set(["/repo/openspec/changes/old", "/repo/openspec/changes/new"]);
  return {
    projectRoot: "/repo",
    freshnessMs: 12 * 60 * 60 * 1000,
    pathExists: (path) =>
      path === "/repo/.foundation/logs" || path in rows || active.has(path),
    readDirectory: () => [directory("not-a-session", false), directory("old"), directory("new")],
    readText: (path) => rows[path],
    nowMs: () => Date.parse("2026-08-27T02:00:00Z"),
    ...overrides
  };
}

test("recorded phase selects the newest valid session row [active-row-still-governs]", () => {
  assert.equal(recordedPhase(context()), "prove");
  assert.equal(recordedPhaseContext(context()).changeId, "new");
});

test("recorded phase ignores missing, empty, malformed, and invalid rows", () => {
  assert.equal(recordedPhase(context({ pathExists: () => false })), "");
  for (const value of ["", "not-json\n", '{"timestamp":"invalid","phase":"build"}\n'])
    assert.equal(recordedPhase(context({
      readDirectory: () => [directory("new")],
      readText: () => value
    })), "");
  assert.equal(recordedPhase(context({
    readDirectory: () => [directory("missing")]
  })), "");
});

test("recorded phase expires stale state and contains filesystem failures", () => {
  assert.equal(recordedPhase(context({
    nowMs: () => Date.parse("2026-08-28T02:00:00Z")
  })), "");
  assert.equal(recordedPhase(context({
    readDirectory: () => { throw new Error("permission denied"); }
  })), "");
});

// A fixture change left a `building` row with no workspace behind in a real
// repository. Because it was the newest row, every session there was refused
// every mutation until the row aged out — for work that had nothing to do with
// it. Only an active OpenSpec change may govern.
test("recorded phase skips a row whose change is no longer active [orphan-row-ignored]", () => {
  const orphaned = context({
    pathExists: (path) => path === "/repo/.foundation/logs" ||
      path.endsWith("phase-context.jsonl") || path === "/repo/openspec/changes/old"
  });
  assert.equal(recordedPhase(orphaned), "change");
  assert.equal(recordedPhaseContext(orphaned).changeId, "old");
});

test("recorded phase establishes nothing when every fresh row is orphaned", () => {
  assert.equal(recordedPhase(context({
    pathExists: (path) => path === "/repo/.foundation/logs" ||
      path.endsWith("phase-context.jsonl")
  })), "");
});

test("recorded phase identifies a change by its row before its directory name", () => {
  const rows = {
    "/repo/.foundation/logs/legacy-directory/phase-context.jsonl":
      '{"timestamp":"2026-08-27T01:00:00Z","phase":"build","changeId":"renamed"}\n'
  };
  assert.equal(recordedPhaseContext({
    projectRoot: "/repo",
    freshnessMs: 12 * 60 * 60 * 1000,
    pathExists: (path) => path === "/repo/.foundation/logs" || path in rows ||
      path === "/repo/openspec/changes/renamed",
    readDirectory: () => [directory("legacy-directory")],
    readText: (path) => rows[path],
    nowMs: () => Date.parse("2026-08-27T02:00:00Z")
  }).changeId, "renamed");
});
