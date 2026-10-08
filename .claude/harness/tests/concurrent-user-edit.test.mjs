import assert from "node:assert/strict";
import test from "node:test";
import {
  agentEdit, assertAgentConflict, assertArchived, buildChange, cleanup, landTrail, proveChange,
  replaceLine, startChange, world
} from "./fixtures/concurrent-changes.mjs";

// Scenario 4: the user keeps editing the checkout (uncommitted) while changes
// are in flight. Edits on other lines are merged by the harness; an edit on
// the same line as a change goes to the agent. The user's bytes survive, and a
// careless agent merge that drops landed or user content is not taken.
test("a user's uncommitted edit survives parallel changes and a same-line conflict", () => {
  const w = world();
  try {
    const labels = ["alpha", "bravo", "charlie"];
    const lines = { alpha: 3, bravo: 15, charlie: 27 };
    for (const label of labels) startChange(w, label, ["src/shared.txt"]);
    const sandboxes = Object.fromEntries(labels.map((label) => [label, buildChange(w, label)]));
    for (const label of labels) {
      agentEdit(sandboxes[label], label,
        { "src/shared.txt": replaceLine(lines[label], `${label}-edit`) });
      proveChange(w, label);
    }
    // The user edits the checkout after the changes were proved.
    const userLines = w.read("src/shared.txt").split("\n");
    userLines[26] = "user-edit";
    userLines[8] = "user-edit-nine";
    w.write("src/shared.txt", userLines.join("\n"));
    for (const label of ["alpha", "bravo"]) assertArchived(w, label, landTrail(w, label));
    let target = w.read("src/shared.txt").split("\n");
    assert.equal(target[26], "user-edit", "the user's edit is kept");
    assert.equal(target[8], "user-edit-nine");
    assert.equal(target[2], "alpha-edit");
    assert.equal(target[14], "bravo-edit");
    // charlie edits the line the user changed: the agent gets it, nothing is overwritten.
    assertAgentConflict(landTrail(w, "charlie").at(-1), w, "charlie");
    assert.equal(w.read("src/shared.txt").split("\n")[26], "user-edit");
    // A careless agent resolves only its own line and drops everything landed
    // or edited elsewhere in the file. That is not a merge: the conflict stays
    // open and the target is untouched (regression: Land used to take any
    // sandbox edit after a conflict as the merge and lose alpha, bravo and the
    // user's other line).
    const before = w.read("src/shared.txt");
    agentEdit(sandboxes.charlie, "charlie",
      { "src/shared.txt": replaceLine(27, "user-edit charlie-edit") });
    assertAgentConflict(landTrail(w, "charlie").at(-1), w, "charlie");
    assert.equal(w.read("src/shared.txt"), before, "the dropped content is still in the target");
    // A careful agent merges onto the target bytes, keeping all of them.
    agentEdit(sandboxes.charlie, "charlie", {
      "src/shared.txt": () => before.split("\n").map((line, index) =>
        (index === 26 ? "user-edit charlie-edit" : line)).join("\n") });
    assertArchived(w, "charlie", landTrail(w, "charlie"));
    target = w.read("src/shared.txt").split("\n");
    assert.equal(target[26], "user-edit charlie-edit");
    assert.equal(target[8], "user-edit-nine");
    assert.equal(target[2], "alpha-edit");
    assert.equal(target[14], "bravo-edit");
    assert.equal(w.run("git", ["log", "--oneline"]).split("\n").length, 1, "Land never commits");
  } finally { cleanup(w); }
});
