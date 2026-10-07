import assert from "node:assert/strict";
import test from "node:test";
import {
  SHARED_LINES, agentEdit, assertArchived, buildChange, cleanup, landTrail, proveChange,
  replaceLine, startChange, tookLandedSync, world
} from "./fixtures/concurrent-changes.mjs";

// Scenario 2: three changes edit different lines of the same file. Every later
// Land replays the earlier landed work into its sandbox through `advance`
// (harness-owned, no user command), proves again, and archives.
test("three changes on one file at different lines each sync onto the moved target", () => {
  const w = world();
  try {
    const labels = ["alpha", "bravo", "charlie"];
    const lines = { alpha: 3, bravo: 15, charlie: 27 };
    for (const label of labels) startChange(w, label, ["src/shared.txt"]);
    const sandboxes = Object.fromEntries(labels.map((label) => [label, buildChange(w, label)]));
    assert.equal(new Set(Object.values(sandboxes)).size, 3);
    for (const label of labels) {
      agentEdit(sandboxes[label], label,
        { "src/shared.txt": replaceLine(lines[label], `${label}-edit`) });
      proveChange(w, label);
    }
    const before = w.operations.count;
    for (const label of ["bravo", "alpha", "charlie"]) assertArchived(w, label, landTrail(w, label));
    assert.equal(tookLandedSync(w, "bravo"), false, "the first Land has nothing to sync");
    assert.equal(tookLandedSync(w, "alpha"), true, "the second Land replays bravo");
    assert.equal(tookLandedSync(w, "charlie"), true, "the third Land replays both");
    const final = w.read("src/shared.txt").split("\n");
    for (const label of labels) assert.equal(final[lines[label] - 1], `${label}-edit`);
    assert.equal(final.length, SHARED_LINES + 1, "no line was lost or duplicated");
    // Sync and re-proof are inside the one Land advance: still one per change.
    assert.equal(w.operations.count - before, 3);
    assert.equal(w.operations.count, 12, "operations stay linear in the number of changes");
  } finally { cleanup(w); }
});
