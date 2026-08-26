import assert from "node:assert/strict";
import test from "node:test";

import { recordedPhase } from "../../hooks/phase-state.mjs";

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
  return {
    projectRoot: "/repo",
    freshnessMs: 12 * 60 * 60 * 1000,
    pathExists: (path) => path === "/repo/.foundation/logs" || path in rows,
    readDirectory: () => [directory("not-a-session", false), directory("old"), directory("new")],
    readText: (path) => rows[path],
    nowMs: () => Date.parse("2026-08-27T02:00:00Z"),
    ...overrides
  };
}

test("recorded phase selects the newest valid session row", () => {
  assert.equal(recordedPhase(context()), "prove");
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
