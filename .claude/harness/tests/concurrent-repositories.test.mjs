import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertArchived, cleanup, editRepositorySandbox, landTrail, repositoriesWorld, replaceLine,
  singleRepositoryChange, stackedPair, status
} from "./fixtures/concurrent-repositories.mjs";

// Stacked changes in a multi-repository consumer: the later change branched
// before the earlier one landed (uncommitted) in the same repository.
const line = (text, n) => text.split("\n")[n - 1];

test("edits on different lines of a repository file merge into the later sandbox and land", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "shared.txt": replaceLine(5, "alpha-edit") }, { "shared.txt": replaceLine(25, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.equal(synced.status, 0, synced.stderr || synced.stdout);
    assert.match(synced.stdout, new RegExp(`REPLAYED backend:shared\\.txt: merged the landed, uncommitted work of ${w.ids.alpha}`));
    const merged = readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8");
    assert.equal(line(merged, 5), "alpha-edit");
    assert.equal(line(merged, 25), "bravo-edit");
    assert.notEqual(status(w, "bravo"), "proven", "the replay invalidates bravo's proof");
    assertArchived(w, "bravo", landTrail(w, "bravo"));
    const landed = w.read("backend/shared.txt");
    assert.equal(line(landed, 5), "alpha-edit");
    assert.equal(line(landed, 25), "bravo-edit");
    assert.equal(w.run("git", ["rev-parse", "HEAD"], join(w.project, "backend")),
      w.run("git", ["rev-list", "--max-parents=0", "HEAD"], join(w.project, "backend")), "no HEAD moved");
  } finally { cleanup(w); }
});

test("edits on the same line are reported as a repository conflict and never written", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "shared.txt": replaceLine(10, "alpha-edit") }, { "shared.txt": replaceLine(10, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const before = readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8");
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.match(synced.stdout, new RegExp(`CONFLICT backend:shared\\.txt: .*${w.ids.alpha}`));
    assert.equal(readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8"), before, "a conflict never writes the sandbox");
  } finally { cleanup(w); }
});

test("an agent-resolved merge that keeps every landed edit lands", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "shared.txt": replaceLine(10, "alpha-edit") }, { "shared.txt": replaceLine(10, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    assert.match(w.cli("sandbox", "sync", "bravo").stdout, /CONFLICT backend:shared\.txt/);
    editRepositorySandbox(sandboxes.bravo, "bravo", { "shared.txt": replaceLine(10, "alpha-edit bravo-edit") });
    assertArchived(w, "bravo", landTrail(w, "bravo"));
    assert.equal(line(w.read("backend/shared.txt"), 10), "alpha-edit bravo-edit");
  } finally { cleanup(w); }
});

// alpha lands two edits: line 3 (nobody else touches it) and line 10 (bravo
// rewrites it too, so only line 10 conflicts).
const alphaEdits = { "shared.txt": (body) => replaceLine(10, "alpha-edit")(replaceLine(3, "alpha-three")(body)) };

test("the agent decides the lines both changes rewrote while the other landed edits stay", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend", alphaEdits, { "shared.txt": replaceLine(10, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.match(synced.stdout, /CONFLICT backend:shared\.txt/);
    // bravo's version of line 10 wins; alpha's line 3 is carried unchanged.
    assert.equal(line(readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8"), 3), "shared line 3",
      "a conflicted replay never writes the sandbox");
    editRepositorySandbox(sandboxes.bravo, "bravo",
      { "shared.txt": replaceLine(3, "alpha-three") });
    assertArchived(w, "bravo", landTrail(w, "bravo"));
    const landed = w.read("backend/shared.txt");
    assert.equal(line(landed, 3), "alpha-three");
    assert.equal(line(landed, 10), "bravo-edit");
  } finally { cleanup(w); }
});

test("a merge that drops a landed edit outside the conflicting lines stops Land and keeps the landed bytes", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend", alphaEdits, { "shared.txt": replaceLine(10, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const landed = w.read("backend/shared.txt");
    assert.match(w.cli("sandbox", "sync", "bravo").stdout, /CONFLICT backend:shared\.txt/);
    // The agent decides line 10 but leaves alpha's line 3 at its base text.
    editRepositorySandbox(sandboxes.bravo, "bravo", { "shared.txt": replaceLine(10, "bravo-edit only") });
    const stop = landTrail(w, "bravo").at(-1);
    assert.notEqual(stop.action, "DONE", JSON.stringify(stop));
    assert.equal(stop.actor, "agent");
    assert.equal(stop.boundary, "conflict");
    assert.deepEqual(stop.details.conflicts.map((row) => [row.repository, row.path, row.landedBy]),
      [["backend", "shared.txt", w.ids.alpha]], "the stop names the repository, the path and the landed change");
    assert.equal(stop.resumeCommand, `claude-foundation advance ${w.ids.bravo} --through archived`);
    assert.equal(w.read("backend/shared.txt"), landed, "the landed bytes are untouched");
    assert.notEqual(status(w, "bravo"), "archived");
  } finally { cleanup(w); }
});

test("two changes that create the same new file end in a stop or a landing, never a loop", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "fresh.txt": () => "alpha fresh\n" }, { "fresh.txt": () => "bravo fresh\n" }, ["fresh.txt"]);
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.match(synced.stdout, /CONFLICT backend:fresh\.txt/);
    // Unresolved, the sync has already run against these bytes, so Land stops
    // with the repository and path named instead of syncing again forever.
    const trail = landTrail(w, "bravo", { limit: 6 });
    const stop = trail.at(-1);
    assert.notEqual(stop.action, "DONE", JSON.stringify(stop));
    assert.ok(trail.length < 6, "the stop ends the trail, not the attempt limit");
    assert.match(stop.reason, /overwrite an uncommitted target path in 'backend': fresh\.txt/);
    assert.equal(w.read("backend/fresh.txt"), "alpha fresh\n", "the landed file is untouched");
    // Resolved by the agent, the next landing archives with the merged file.
    editRepositorySandbox(sandboxes.bravo, "bravo", { "fresh.txt": () => "alpha fresh\nbravo fresh\n" });
    assertArchived(w, "bravo", landTrail(w, "bravo", { limit: 6 }));
    assert.equal(w.read("backend/fresh.txt"), "alpha fresh\nbravo fresh\n");
  } finally { cleanup(w); }
});

test("a recorded resolution does not survive a change to the target file", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "shared.txt": replaceLine(10, "alpha-edit") }, { "shared.txt": replaceLine(10, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    assert.match(w.cli("sandbox", "sync", "bravo").stdout, /CONFLICT backend:shared\.txt/);
    editRepositorySandbox(sandboxes.bravo, "bravo", { "shared.txt": replaceLine(10, "alpha-edit bravo-edit") });
    // The sync that follows the agent's edit records the resolution.
    assert.doesNotMatch(w.cli("sandbox", "sync", "bravo").stdout, /CONFLICT backend:shared\.txt/);
    // Someone then edits the target file: the recorded resolution no longer applies.
    writeFileSync(join(w.project, "backend/shared.txt"), replaceLine(20, "user-edit")(w.read("backend/shared.txt")));
    const stop = landTrail(w, "bravo").at(-1);
    assert.notEqual(stop.action, "DONE", JSON.stringify(stop));
    assert.match(stop.reason, /overwrite an uncommitted target edit in 'backend': shared\.txt/);
    assert.equal(line(w.read("backend/shared.txt"), 20), "user-edit", "the user's bytes are kept");
  } finally { cleanup(w); }
});

test("a user's uncommitted edit on the same lines still stops Land", () => {
  const w = repositoriesWorld();
  try {
    singleRepositoryChange(w, "alpha", "backend", { "shared.txt": replaceLine(10, "alpha-edit") });
    writeFileSync(join(w.project, "backend/shared.txt"), replaceLine(10, "user-edit")(w.read("backend/shared.txt")));
    const stop = landTrail(w, "alpha").at(-1);
    assert.notEqual(stop.action, "DONE", JSON.stringify(stop));
    assert.match(stop.reason, /overwrite an uncommitted target edit in 'backend': shared\.txt/);
    assert.equal(line(w.read("backend/shared.txt"), 10), "user-edit", "the user's bytes are kept");
  } finally { cleanup(w); }
});

test("a file edited after the landing is not replayed into the later sandbox", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "shared.txt": replaceLine(5, "alpha-edit") }, { "shared.txt": replaceLine(25, "bravo-edit") });
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    writeFileSync(join(w.project, "backend/shared.txt"), replaceLine(7, "user-edit")(w.read("backend/shared.txt")));
    const before = readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8");
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.doesNotMatch(synced.stdout, /REPLAYED backend:shared\.txt/);
    assert.equal(readFileSync(join(sandboxes.bravo, "shared.txt"), "utf8"), before);
  } finally { cleanup(w); }
});

test("a landed file the later sandbox did not edit is left alone", () => {
  const w = repositoriesWorld();
  try {
    const sandboxes = stackedPair(w, "backend",
      { "other.txt": (body) => `${body}alpha-edit\n` }, { "shared.txt": replaceLine(25, "bravo-edit") }, ["other.txt", "shared.txt"]);
    assertArchived(w, "alpha", landTrail(w, "alpha"));
    const synced = w.cli("sandbox", "sync", "bravo");
    assert.doesNotMatch(synced.stdout, /REPLAYED backend:other\.txt/);
    assert.equal(readFileSync(join(sandboxes.bravo, "other.txt"), "utf8"), "other base\n");
  } finally { cleanup(w); }
});
