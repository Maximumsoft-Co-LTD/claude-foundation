import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  SHARED_LINES, agentEdit, assertArchived, buildChange, cleanup, landTrail, proveChange,
  replaceLine, runtimeText, startChange, world
} from "./fixtures/concurrent-changes.mjs";

const SHARED = "src/shared.txt";
const workspaceOf = (w, label) => JSON.parse(runtimeText(w, label)).workspace;
const sync = (w, label) => w.cli("sandbox", "sync", label);

// Lands `label` from a sandbox built now, editing `line` of the shared file.
function landEdit(w, label, line) {
  const sandbox = buildChange(w, label);
  agentEdit(sandbox, label, { [SHARED]: replaceLine(line, `${label}-edit`) });
  proveChange(w, label);
  assertArchived(w, label, landTrail(w, label));
}

// A sandbox created after another change landed starts from the landed bytes.
// The change's edit next to the landed lines is its own work: no sync replays
// the landed edit into it again, and Land accepts the path.
test("a carried landed file edited on adjacent lines syncs without conflict and lands", () => {
  const w = world();
  try {
    startChange(w, "bravo", [SHARED]);
    landEdit(w, "bravo", 3);
    // Started after bravo landed: the landed file is pre-existing dirt, so
    // alpha still gets a worktree and the carry copies bravo's bytes into it.
    startChange(w, "alpha", [SHARED]);
    const sandbox = buildChange(w, "alpha");
    assert.equal(workspaceOf(w, "alpha").mode, "worktree");
    assert.equal(workspaceOf(w, "alpha").landedCarriedFrom?.[SHARED]?.changeId, w.ids.bravo,
      "the carry records where the sandbox copy started");
    agentEdit(sandbox, "alpha", { [SHARED]: replaceLine(4, "alpha-edit") });
    const edited = readFileSync(join(sandbox, SHARED), "utf8");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const synced = sync(w, "alpha");
      assert.equal(synced.status, 0, synced.stderr || synced.stdout);
      assert.doesNotMatch(synced.stdout, /CONFLICT/, synced.stdout);
      assert.equal(readFileSync(join(sandbox, SHARED), "utf8"), edited,
        "the sandbox bytes are never rewritten");
    }
    const workspace = workspaceOf(w, "alpha");
    assert.equal(workspace.landedConflicts?.[SHARED], undefined);
    assert.ok(workspace.landedResolved?.[SHARED], JSON.stringify(workspace));
    assert.equal(workspace.landedCarriedFrom?.[SHARED]?.changeId, w.ids.bravo,
      "the carry origin survives the change's own edit");
    proveChange(w, "alpha");
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const final = w.read(SHARED).split("\n");
    assert.equal(final[2], "bravo-edit");
    assert.equal(final[3], "alpha-edit");
    assert.equal(final.length, SHARED_LINES + 1, "no line was lost or duplicated");
  } finally { cleanup(w); }
});

// Once the target moves past the carried bytes, the carry no longer vouches
// for the sandbox copy: the replay merges the new landed edit as before and an
// overlap is a conflict.
test("a target that moved after the carry is replayed again and conflicts on overlap", () => {
  const w = world();
  try {
    for (const label of ["bravo", "charlie"]) startChange(w, label, [SHARED]);
    // Charlie's sandbox predates bravo's Land; it edits line 20 only.
    const charlie = buildChange(w, "charlie");
    agentEdit(charlie, "charlie", { [SHARED]: replaceLine(20, "charlie-edit") });
    proveChange(w, "charlie");
    landEdit(w, "bravo", 3);
    startChange(w, "alpha", [SHARED]);
    const sandbox = buildChange(w, "alpha");
    assert.ok(workspaceOf(w, "alpha").landedCarriedFrom?.[SHARED]);
    agentEdit(sandbox, "alpha", { [SHARED]: replaceLine(20, "alpha-edit") });
    assert.equal(sync(w, "alpha").status, 0);
    assert.equal(workspaceOf(w, "alpha").landedConflicts?.[SHARED], undefined);
    assertArchived(w, "charlie", landTrail(w, "charlie"));
    const synced = sync(w, "alpha");
    assert.match(synced.stdout + synced.stderr, /CONFLICT|conflict/, synced.stdout);
    const workspace = workspaceOf(w, "alpha");
    assert.ok(workspace.landedConflicts?.[SHARED], JSON.stringify(workspace));
    assert.equal(workspace.landedResolved?.[SHARED], undefined);
    assert.equal(workspace.landedCarriedFrom?.[SHARED], undefined,
      "a moved target drops the carry origin");
  } finally { cleanup(w); }
});

// A sandbox that never carried the landed bytes keeps the 3-way replay: the
// same line edited by both changes is a conflict.
test("a never-carried sandbox editing the landed lines still conflicts", () => {
  const w = world();
  try {
    for (const label of ["alpha", "bravo"]) startChange(w, label, [SHARED]);
    const sandbox = buildChange(w, "alpha");
    agentEdit(sandbox, "alpha", { [SHARED]: replaceLine(3, "alpha-edit") });
    proveChange(w, "alpha");
    landEdit(w, "bravo", 3);
    const synced = sync(w, "alpha");
    assert.match(synced.stdout + synced.stderr, /CONFLICT|conflict/, synced.stdout);
    const workspace = workspaceOf(w, "alpha");
    assert.equal(workspace.landedCarriedFrom?.[SHARED], undefined);
    assert.ok(workspace.landedConflicts?.[SHARED], JSON.stringify(workspace));
    assert.equal(workspace.landedResolved?.[SHARED], undefined);
  } finally { cleanup(w); }
});
