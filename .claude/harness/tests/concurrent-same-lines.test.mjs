import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  agentEdit, assertAgentConflict, assertArchived, buildChange, cleanup, landTrail, proveChange,
  replaceLine, startChange, world
} from "./fixtures/concurrent-changes.mjs";

// Scenario 3: two changes rewrite the same line. The later one gets an
// agent-owned conflict with a resume route, never a silent overwrite and never
// a question for the user; once the agent merges both in its sandbox it lands.
test("two changes editing the same lines route the later one to the agent", () => {
  const w = world();
  try {
    const labels = ["alpha", "bravo"];
    for (const label of labels) startChange(w, label, ["src/shared.txt"]);
    const sandboxes = Object.fromEntries(labels.map((label) => [label, buildChange(w, label)]));
    for (const label of labels) {
      agentEdit(sandboxes[label], label, { "src/shared.txt": replaceLine(10, `${label}-edit`) });
      proveChange(w, label);
    }
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const landedBytes = w.read("src/shared.txt");
    const stop = landTrail(w, "bravo").at(-1);
    assertAgentConflict(stop, w, "bravo");
    assert.deepEqual(stop.details.conflicts.map((row) => [row.path, row.landedBy]),
      [["src/shared.txt", w.ids.alpha]]);
    assert.equal(w.read("src/shared.txt"), landedBytes, "the landed bytes are untouched");
    assert.equal(readFileSync(join(sandboxes.bravo, "src/shared.txt"), "utf8").split("\n")[9],
      "bravo-edit", "a conflicted replay never writes the sandbox");
    // The scripted agent merges in its sandbox, keeping the landed content.
    agentEdit(sandboxes.bravo, "bravo",
      { "src/shared.txt": replaceLine(10, "alpha-edit bravo-edit") });
    assertArchived(w, "bravo", landTrail(w, "bravo"));
    assert.equal(w.read("src/shared.txt").split("\n")[9], "alpha-edit bravo-edit");
  } finally { cleanup(w); }
});
