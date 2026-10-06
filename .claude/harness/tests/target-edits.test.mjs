import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isGeneratedArtifactPath, landAppliedOutput, landedChangeSyncStop, landedTargetPaths,
  otherLandedOutput, parseRestoreTargetPaths, replayLandedEdit, restorableTargetPaths,
  shellAuditCount, targetConflictStop, targetEditCarried, targetEditDigest, targetEditIssues,
  targetEditPaths
} from "../runtime/workflow/target-edits.mjs";
import { advanceFailureAction } from "../runtime/workflow/advance-runtime.mjs";

function project(t, rows = []) {
  const root = mkdtempSync(join(tmpdir(), "target-edits-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".foundation", "logs"), { recursive: true });
  writeFileSync(join(root, ".foundation", "logs", "guardrail-audit.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return root;
}

const isolated = (extra = {}) => ({
  id: "demo", workspace: { mode: "worktree", path: "/sandbox", targetDirty: { "keep.md": "a" } },
  ...extra
});

test("only target files changed since isolation count, never machine state or packets", () => {
  assert.deepEqual(targetEditPaths({ "keep.md": "a", "edit.js": "a" }, {
    "keep.md": "a", "edit.js": "b", "new.js": "c", ".foundation/x": "d",
    "openspec/changes/demo/tasks.md": "e", "openspec/investigations/n.md": "f"
  }), ["edit.js", "new.js"]);
});

test("audit rows are counted per change", (t) => {
  const root = project(t, [
    { outcome: "shell-audit", changeId: "demo" },
    { outcome: "shell-audit", changeId: "other" },
    { outcome: "blocked", changeId: "demo" }
  ]);
  assert.equal(shellAuditCount(root, "demo"), 1);
  assert.equal(shellAuditCount(join(root, "missing"), "demo"), 0);
});

// Build shell mutations are audited, not blocked, so an unanchored command can
// land in the main checkout; Prove and Land must stop until the agent moves it.
test("target edits block only after unverified shell mutations", (t) => {
  const dirtyNow = { "keep.md": "a", "src/leak.js": "x" };
  const quiet = targetEditIssues({ root: project(t), state: isolated(), dirtyNow });
  assert.deepEqual(quiet.issues, []);
  assert.match(quiet.notices[0], /no unverified shell mutation recorded\): src\/leak\.js/);

  const root = project(t, [{ outcome: "shell-audit", changeId: "demo" }]);
  const blocked = targetEditIssues({ root, state: isolated(), dirtyNow });
  assert.match(blocked.issues[0], /^TARGET_EDITED_OUTSIDE_SANDBOX: 1 unverified/);
  assert.match(blocked.issues[0], /into \/sandbox and restore/);
  assert.match(blocked.issues[0], /change resolve demo --accept-target-edits/);

  const accepted = targetEditIssues({ root, dirtyNow, state: isolated({
    targetEditsAccepted: { digest: targetEditDigest(["src/leak.js"], dirtyNow) } }) });
  assert.deepEqual(accepted.issues, []);
  assert.match(accepted.notices[0], /accepted by user decision/);
  // A later edit is a new question.
  assert.equal(targetEditIssues({ root, dirtyNow: { ...dirtyNow, "src/leak.js": "y" },
    state: isolated({ targetEditsAccepted: { digest: targetEditDigest(["src/leak.js"], dirtyNow) } })
  }).issues.length, 1);
  assert.deepEqual(targetEditIssues({ root, dirtyNow,
    state: { id: "demo", workspace: { mode: "current" } } }), { issues: [], notices: [] });
});

// Land's own Apply writes the proven files into the target. Re-checking
// readiness after that Apply must see them as Land output, not as edits made
// outside the sandbox, while any other content still blocks.
test("target files equal to this change's applied Land output are not outside edits", (t) => {
  const root = project(t, [{ outcome: "shell-audit", changeId: "demo" }]);
  const journals = [
    { status: "verified", entries: [
      { path: "src/app.js", after: "proven" },
      { path: "openspec/changes/demo", after: "directory:abc" }
    ] },
    { status: "rolled-back", entries: [{ path: "src/old.js", after: "old" }] }
  ];
  const landOutput = landAppliedOutput(journals);
  assert.deepEqual(landOutput, { "src/app.js": "proven" });
  const applied = targetEditIssues({ root, state: isolated(), landOutput,
    dirtyNow: { "keep.md": "a", "src/app.js": "proven" } });
  assert.deepEqual(applied, { issues: [], notices: [] });
  const divergent = targetEditIssues({ root, state: isolated(), landOutput,
    dirtyNow: { "keep.md": "a", "src/app.js": "edited", "src/old.js": "old" } });
  assert.match(divergent.issues[0], /outside the sandbox at: src\/app\.js, src\/old\.js\./);
});

test("generated artifacts are recognized and restorable only when clean at isolation", () => {
  for (const path of ["__pycache__/a.cpython-312.pyc", "pkg/__pycache__/b.pyc", "x.pyo",
    "build/A.class", "node_modules/.cache/v/x", "coverage/lcov.info", ".pytest_cache/v/x"])
    assert.ok(isGeneratedArtifactPath(path), path);
  for (const path of ["src/app.py", "coverage.md", "lib/classic.js", "node_modules/pkg/index.js"])
    assert.equal(isGeneratedArtifactPath(path), false, path);
  assert.deepEqual(restorableTargetPaths(["a.pyc", "b.pyc", "src/app.py"], { "b.pyc": "h" }), ["a.pyc"]);
  assert.deepEqual(parseRestoreTargetPaths(" b.pyc, a.pyc ,,a.pyc"), ["a.pyc", "b.pyc"]);
});

test("a conflict only on clean-at-isolation artifacts is an agent REPAIR with the harness restore command", () => {
  const stop = targetConflictStop({ changeId: "demo", paths: ["__pycache__/a.pyc"],
    snapshot: {}, cause: "sandbox diff conflicts with target" });
  assert.equal(stop.decision, undefined);
  assert.equal(stop.details.owner, "agent");
  assert.doesNotMatch(stop.message, /git checkout/);
  const action = advanceFailureAction("demo", Object.assign(new Error(stop.message), stop.details),
    { stage: "land", through: "archived" });
  assert.equal(action.action, "REPAIR");
  assert.equal(action.actor, "agent");
  assert.equal(action.command,
    "claude-foundation advance demo --through archived --restore-target __pycache__/a.pyc");
});

// Keeping target edits loses nothing, so it is the automatic route: the agent
// carries them into the sandbox. No option asks anyone to commit.
test("a conflict on user work keeps the target edits and hands reconciliation to the agent", () => {
  const user = targetConflictStop({ changeId: "demo", paths: ["src/app.py", "a.pyc"],
    snapshot: {}, cause: "apply would overwrite uncommitted target edits" });
  assert.equal(user.decision.kind, "target-edit-conflict");
  assert.deepEqual(user.decision.paths, ["src/app.py", "a.pyc"]);
  assert.match(user.decision.summary, /src\/app\.py, a\.pyc/);
  assert.equal(user.decision.recommended, "keep-target");
  assert.equal(user.decision.automaticRecovery, "keep-target");
  assert.deepEqual(user.decision.options.map((option) => option.id),
    ["keep-target", "restore-target", "pause"]);
  for (const option of user.decision.options)
    assert.doesNotMatch(`${user.decision.summary} ${option.outcome}`, /\bcommit\b/i);
  assert.match(user.decision.options[1].outcome,
    /--restore-target src\/app\.py,a\.pyc --decision-ref <user-decision>/);
  const action = advanceFailureAction("demo",
    Object.assign(new Error(user.decision.summary), { decision: user.decision }),
    { stage: "land", through: "archived" });
  assert.equal(action.action, "REPAIR");
  assert.equal(action.actor, "agent");
  assert.equal(action.legacyAction, "RECONCILE_TARGET_EDITS");
  assert.deepEqual(action.paths, ["src/app.py", "a.pyc"]);
  assert.equal(action.command, "claude-foundation advance demo --through archived");

  const preexisting = targetConflictStop({ changeId: "demo", paths: ["a.pyc"],
    snapshot: { "a.pyc": "dirty" }, cause: "sandbox diff conflicts with target" });
  assert.equal(preexisting.decision.recommended, "keep-target");
});

test("a target edit already merged into the sandbox copy is carried, a divergent one is not", (t) => {
  const root = mkdtempSync(join(tmpdir(), "target-carried-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const sandbox = join(root, "sandbox");
  mkdirSync(target);
  mkdirSync(sandbox);
  const base = Buffer.from("one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(target, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(sandbox, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  const carried = () => targetEditCarried({ root: target, sandboxPath: sandbox, path: "a.txt", baseBytes: base });
  assert.equal(carried(), false, "the sandbox lacks the target's first-line edit");
  writeFileSync(join(sandbox, "a.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n");
  assert.equal(carried(), true, "the merged sandbox copy carries the target edit");
  assert.equal(targetEditCarried({ root: target, sandboxPath: sandbox, path: "missing.txt",
    baseBytes: base }), false);
});

test("a blocking target edit outside the Land projection is reported, not a stop", (t) => {
  const root = project(t, [{ outcome: "shell-audit", changeId: "demo" }]);
  const dirtyNow = { "keep.md": "a", "src/app.js": "x", "notes/todo.md": "y" };
  const narrowed = targetEditIssues({ root, state: isolated(), dirtyNow,
    projectionPaths: () => new Set(["src/app.js"]) });
  assert.equal(narrowed.issues.length, 1);
  assert.match(narrowed.issues[0], /outside the sandbox at: src\/app\.js\./);
  assert.match(narrowed.notices[0], /outside this change's Land projection .*notes\/todo\.md/);
  const unrelated = targetEditIssues({ root, state: isolated(), dirtyNow,
    projectionPaths: () => new Set(["src/other.js"]) });
  assert.deepEqual(unrelated.issues, []);
  assert.equal(unrelated.notices.length, 1);
  // An unresolvable projection stays fail-closed.
  const unknown = targetEditIssues({ root, state: isolated(), dirtyNow,
    projectionPaths: () => { throw new Error("surface unavailable"); } });
  assert.match(unknown.issues[0], /notes\/todo\.md, src\/app\.js/);
});

// Stacked Land: another change's landed, uncommitted bytes are part of the
// target. They are read from that change's verified journal and still count
// only while the target holds exactly those bytes.
test("other changes' landed output is read from verified journals, newest last", (t) => {
  const transactions = mkdtempSync(join(tmpdir(), "target-landed-"));
  t.after(() => rmSync(transactions, { recursive: true, force: true }));
  const journal = (owner, run, value) => {
    mkdirSync(join(transactions, owner, run), { recursive: true });
    writeFileSync(join(transactions, owner, run, "journal.json"), JSON.stringify(value));
  };
  journal("first", "apply-1", { changeId: "first", status: "committed", verifiedAt: "2026-01-01",
    entries: [{ path: "a.txt", role: "code", after: "aaa" },
      { path: "openspec/changes/first", role: "change-artifacts", after: "directory:x" }] });
  journal("later", "apply-1", { changeId: "later", status: "verified", verifiedAt: "2026-01-02",
    entries: [{ path: "a.txt", role: "code", after: "bbb" }] });
  journal("rolled", "apply-1", { changeId: "rolled", status: "rolled-back",
    entries: [{ path: "b.txt", role: "code", after: "ccc" }] });
  journal("self", "apply-1", { changeId: "self", status: "verified",
    entries: [{ path: "c.txt", role: "code", after: "ddd" }] });
  const readJson = (path, fallback) => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
  };
  const landed = otherLandedOutput({ transactions, changeId: "self", readJson });
  assert.deepEqual(landed, { "a.txt": { changeId: "later", after: "bbb" } });
  assert.deepEqual(otherLandedOutput({ transactions: join(transactions, "none"), changeId: "x",
    readJson }), {});
  const identity = (path) => path.endsWith("a.txt") ? "bbb" : "zzz";
  assert.deepEqual(landedTargetPaths({ root: "/t", paths: ["a.txt"], landed, identity }),
    { "a.txt": "later" });
  assert.deepEqual(landedTargetPaths({ root: "/t", paths: ["a.txt"], landed,
    identity: () => "edited-after-land" }), {}, "a later edit is somebody's work, not Land's");
});

test("a landed edit replays into the sandbox copy cleanly or reports a conflict", (t) => {
  const root = mkdtempSync(join(tmpdir(), "target-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const sandbox = join(root, "sandbox");
  mkdirSync(target);
  mkdirSync(sandbox);
  const base = Buffer.from("one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(target, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(sandbox, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  const replay = () => replayLandedEdit({ root: target, sandboxPath: sandbox, path: "a.txt",
    baseBytes: base });
  const merged = replay();
  assert.equal(merged.status, "merged");
  assert.equal(merged.bytes.toString(), "ONE\ntwo\nthree\nfour\nFIVE\n");
  writeFileSync(join(sandbox, "a.txt"), merged.bytes);
  assert.equal(replay().status, "carried");
  writeFileSync(join(sandbox, "a.txt"), "uno\ntwo\nthree\nfour\nfive\n");
  assert.equal(replay().status, "conflict");
  assert.equal(readFileSync(join(sandbox, "a.txt"), "utf8"), "uno\ntwo\nthree\nfour\nfive\n");
});

test("landed paths sync automatically and are never offered for discard", () => {
  const sync = landedChangeSyncStop({ changeId: "later", landedBy: { "a.txt": "first" } });
  assert.equal(sync.decision.kind, "landed-change-sync");
  assert.equal(sync.decision.automaticRecovery, "sync");
  assert.doesNotMatch(JSON.stringify(sync), /\bcommit\b|restore-target/i);
  const action = advanceFailureAction("later",
    Object.assign(new Error(sync.decision.summary), { decision: sync.decision }),
    { stage: "land", through: "archived" });
  assert.equal(action.action, "REPAIR");
  assert.equal(action.actor, "harness");
  assert.equal(action.automaticRecovery.kind, "sandbox-sync");

  const mixed = targetConflictStop({ changeId: "later", paths: ["a.txt", "b.txt"],
    snapshot: {}, cause: "apply would overwrite uncommitted target edits",
    landedBy: { "a.txt": "first" } });
  assert.match(mixed.decision.summary, /Landed work of first is preserved/);
  assert.match(mixed.decision.options.find((option) => option.id === "restore-target").outcome,
    /--restore-target b\.txt --decision-ref/);
  const landedOnly = targetConflictStop({ changeId: "later", paths: ["a.pyc"], snapshot: {},
    cause: "sandbox diff conflicts with target", landedBy: { "a.pyc": "first" } });
  assert.deepEqual(landedOnly.decision.options.map((option) => option.id), ["keep-target", "pause"]);
});
