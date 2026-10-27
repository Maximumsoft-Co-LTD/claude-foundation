import assert from "node:assert/strict";
import test from "node:test";
import {
  SHARED_LINES, agentEdit, assertArchived, buildChange, cleanup, landTrail, proveChange,
  replaceLine, runtimeText, startChange, tookLandedSync, world
} from "./fixtures/concurrent-changes.mjs";

// Sync leaves, for each landed file the root sandbox edited, the target and
// sandbox bytes it merged against, so the review diff can compare the file with
// the landed bytes instead of the base.
test("the root sync records the bytes it left behind for a file merged with landed work", () => {
  const w = world();
  try {
    for (const label of ["alpha", "bravo"]) startChange(w, label, ["src/shared.txt"]);
    const sandboxes = {};
    for (const [label, line] of [["alpha", 3], ["bravo", 15]]) {
      sandboxes[label] = buildChange(w, label);
      agentEdit(sandboxes[label], label, { "src/shared.txt": replaceLine(line, `${label}-edit`) });
      proveChange(w, label);
    }
    assertArchived(w, "bravo", landTrail(w, "bravo"));
    const synced = w.cli("sandbox", "sync", "alpha");
    assert.equal(synced.status, 0, synced.stderr || synced.stdout);
    const record = JSON.parse(runtimeText(w, "alpha")).workspace.landedSynced;
    assert.ok(record && Object.hasOwn(record, "src/shared.txt"), JSON.stringify(record));
    assert.match(record["src/shared.txt"].target, /^[0-9a-f]{64}$/);
    assert.match(record["src/shared.txt"].sandbox, /^[0-9a-f]{64}$/);
    assert.notEqual(record["src/shared.txt"].target, record["src/shared.txt"].sandbox,
      "the merged sandbox file holds alpha's own edit too");
  } finally { cleanup(w); }
});

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
