// The change surface, the apply projection, and what `land check` is allowed to
// do to the working tree.
//
// The defect these pin: a manifest that admitted every untracked path made an
// unrelated directory part of the change, so the proof hash expired on edits the
// change never made and the apply projection read that directory's absence from
// the sandbox as an instruction to delete it from the target. `land check` then
// settled the interrupted transaction without anyone authorizing it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createStateRuntime } from "../../harness/runtime/core/state-runtime.mjs";
import {
  declaredPathMatcher, nestedRepositoryPathMatcher, sandboxCodePathspec
} from "../../harness/runtime/core/workspace-surface.mjs";
import {
  createApplyRecovery, projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "../../harness/runtime/workflow/apply-recovery.mjs";
import {
  createBlockedDecision
} from "../../harness/runtime/core/blocked-decision.mjs";
import {
  outOfBandDeliveryDriftValue
} from "../../harness/runtime/core/authority-policy.mjs";
import { createLandJournal } from "../../harness/runtime/workflow/land-journal.mjs";
import {
  recordedDeliveryReferences, targetProjectionObservationValue
} from "../../harness/runtime/workflow/land-runtime.mjs";
import {
  shouldReportOutOfBandDelivery
} from "../../harness/runtime/core/diagnostics-runtime.mjs";
import { createApplyRuntime } from "../../harness/runtime/workflow/apply-runtime.mjs";
import { targetEditPaths } from "../../harness/runtime/workflow/target-edits.mjs";
import { automaticRecoveryAction } from "../../harness/runtime/workflow/advance-recovery.mjs";

const EXCLUDED = new Set([".git", ".foundation", ".workflow", "node_modules"]);

const write = (root, rel, body) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
};

const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

// A workspace that looks like a real project: a git repository with tracked
// content, an active change packet, and the runtime state that names its
// declared surface.
function workspace({
  declaredSurface = [], taskPaths = [], surfaceAdditions, repositories, workspaceState,
  gitFile = false, ignore = "/.foundation/\n"
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-surface-"));
  // `gitFile`: the checkout's `.git` is a file (a linked worktree or submodule
  // checkout), so a copy sandbox cannot carry it.
  if (gitFile) git(root, "init", "-q", "--separate-git-dir", `${root}.gitdir`);
  else git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  write(root, "src/app.mjs", "export const app = 1;\n");
  write(root, ".gitignore", ignore);
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "base");

  const id = "confine-surface";
  const changeRel = `openspec/changes/${id}`;
  write(root, `${changeRel}/proposal.md`, "# Change\n");
  write(root, `${changeRel}/tasks.md`, taskPaths.length
    ? `# Tasks\n\n- [ ] **T001** Work — verify: \`true\` [paths:${taskPaths.join(",")}]\n`
    : "# Tasks\n\n- [ ] **T001** Work — verify: `true`\n");

  const runtime = join(root, ".foundation", "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, `${id}.json`), JSON.stringify({
    version: 2, id, status: "building", schema: "foundation-standard",
    declaredSurface, ...(surfaceAdditions ? { surfaceAdditions } : {}),
    ...(repositories ? { repositories } : {}),
    ...(workspaceState ? { workspace: workspaceState(root, id) } : {})
  }));

  const state = createStateRuntime({
    root,
    runtime,
    changes: join(root, "openspec", "changes"),
    receipts: join(root, ".foundation", "receipts"),
    evidenceVault: join(root, ".foundation", "evidence"),
    snapshots: join(root, ".foundation", "snapshots"),
    excludedWorkspaceDirs: EXCLUDED,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: () => {},
    canonicalPath: (path) => path,
    now: () => "2026-01-01T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  return { root, id, state };
}

test("an undeclared untracked tree is not change surface", () => {
  const { root, id, state } = workspace({ declaredSurface: ["src/**"] });
  const before = state.workspaceManifest(root, id, true);
  const beforeHash = state.singleRelevantSnapshot(id, root, true).workspaceHash;

  // A whole repository somebody cloned into the working tree, tracked by
  // nobody and declared by nothing.
  write(root, "vendor-cli/packages/core/tool.ts", "export const x = 1;\n");
  write(root, "vendor-cli/package.json", "{}\n");

  const after = state.workspaceManifest(root, id, true);
  const afterHash = state.singleRelevantSnapshot(id, root, true).workspaceHash;

  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.equal(afterHash, beforeHash,
    "an undeclared untracked tree must not expire collected evidence");
});

test("a file the change declares is surface even before it is tracked", () => {
  const { root, id, state } = workspace({ taskPaths: ["src/**"] });
  const before = state.singleRelevantSnapshot(id, root, true).workspaceHash;
  write(root, "src/new-module.mjs", "export const added = 1;\n");
  const manifest = state.workspaceManifest(root, id, true);
  const after = state.singleRelevantSnapshot(id, root, true).workspaceHash;

  assert.ok(Object.hasOwn(manifest, "src/new-module.mjs"),
    "a declared path the change created must reach the projection");
  assert.notEqual(after, before,
    "a declared new file must bind the evidence it was proven against");
});

test("a new file Prove recorded outside task paths reaches the projection", () => {
  const { root, id, state } = workspace({
    taskPaths: ["src/**"], surfaceAdditions: ["docs/guide.md"]
  });
  write(root, "docs/guide.md", "# Guide\n");
  const manifest = state.workspaceManifest(root, id, true);
  assert.ok(Object.hasOwn(manifest, "docs/guide.md"),
    "a recorded surface addition must land, not be silently dropped");
  assert.equal(state.declaredSurfaceMatcher(id, state.loadRuntime(id))("docs/guide.md"), true);
});

test("a surface addition widens only the repository it was recorded for", () => {
  const app = mkdtempSync(join(tmpdir(), "foundation-land-surface-app-"));
  git(app, "init", "-q");
  const { root, id, state } = workspace({
    taskPaths: ["src/**"],
    // Legacy bare strings mean the root workspace.
    surfaceAdditions: ["docs/guide.md", { repositoryId: "app", path: "notes.md" }],
    repositories: { app: { mode: "worktree", path: app, targetPath: app } }
  });
  for (const dir of [root, app]) {
    write(dir, "docs/guide.md", "# Guide\n");
    write(dir, "notes.md", "notes\n");
  }
  const runtime = state.loadRuntime(id);
  const rootMatcher = state.declaredSurfaceMatcher(id, runtime);
  const appMatcher = state.declaredSurfaceMatcher(id, runtime, "app");
  assert.equal(rootMatcher("docs/guide.md"), true);
  assert.equal(rootMatcher("notes.md"), false,
    "an addition recorded for 'app' must not widen the root surface");
  assert.equal(appMatcher("notes.md"), true);
  assert.equal(appMatcher("docs/guide.md"), false);
  const rootManifest = state.workspaceManifest(root, id, true);
  const appManifest = state.workspaceManifest(app, id, true);
  assert.ok(Object.hasOwn(rootManifest, "docs/guide.md"));
  assert.ok(!Object.hasOwn(rootManifest, "notes.md"));
  assert.ok(Object.hasOwn(appManifest, "notes.md"));
  assert.ok(!Object.hasOwn(appManifest, "docs/guide.md"));
  const appHash = state.singleRelevantSnapshot(id, app, true).workspaceHash;
  write(app, "docs/guide.md", "# Changed\n");
  assert.equal(state.singleRelevantSnapshot(id, app, true).workspaceHash, appHash,
    "a root addition must not bind the child repository's hash");
  rmSync(app, { recursive: true, force: true });
});

// A tool rewrote a git-ignored counter on every run. In a copy sandbox that
// could not carry the target's `.git` (a file there), Git inside the sandbox
// answered for the enclosing target, under which the whole sandbox is ignored,
// so the counter entered the sandbox manifest and the copy-mode Land
// projection as a create. The target's own rules decide instead.
test("a git-ignored file never enters a copy sandbox manifest without its own .git", () => {
  const sandboxOf = (root, id) => join(root, ".foundation", "sandboxes", id);
  const { root, id, state } = workspace({
    gitFile: true, ignore: "/.foundation/\n.autoharness-counter\n*.counter\n",
    workspaceState: (root, id) => ({ mode: "copy", git: "absent", path: sandboxOf(root, id) })
  });
  // Tracked before it was ignored: content, whatever its name matches.
  write(root, "legacy.counter", "0\n");
  git(root, "add", "-f", "legacy.counter");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "legacy");
  const sandbox = sandboxOf(root, id);
  for (const rel of ["src/app.mjs", ".gitignore", "legacy.counter"])
    write(sandbox, rel, readFileSync(join(root, rel)));
  write(root, ".autoharness-counter", "1\n");
  write(sandbox, ".autoharness-counter", "2\n");
  write(sandbox, "cache/run.counter", "2\n");

  const target = state.workspaceManifest(root, id, true);
  const copy = state.workspaceManifest(sandbox, id, true);
  assert.ok(!Object.hasOwn(target, ".autoharness-counter"));
  assert.ok(!Object.hasOwn(copy, ".autoharness-counter"),
    "an ignored file the sandbox rewrote must not be projected by Land");
  assert.ok(!Object.hasOwn(copy, "cache/run.counter"));
  assert.ok(Object.hasOwn(copy, "src/app.mjs"));
  assert.ok(Object.hasOwn(copy, "legacy.counter"),
    "a tracked file that matches an ignore pattern is still compared");
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}.gitdir`, { recursive: true, force: true });
});

// The same sandbox hashed through the enclosing target's Git view: every path
// in it read as ignored, so a code edit left the proof and review hash
// unchanged and stale evidence passed. The hash reads the sandbox's own files
// under the target's tracked set, declared surface, and ignore rules.
test("a copy sandbox without its own .git binds its proof hash to its own files", () => {
  const sandboxOf = (root, id) => join(root, ".foundation", "sandboxes", id);
  const { root, id, state } = workspace({
    gitFile: true, taskPaths: ["src/**"], ignore: "/.foundation/\n*.counter\n",
    workspaceState: (root, id) => ({ mode: "copy", git: "absent", path: sandboxOf(root, id) })
  });
  write(root, "docs/guide.md", "# Guide\n");
  git(root, "add", "docs/guide.md");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "docs");
  const sandbox = sandboxOf(root, id);
  for (const rel of ["src/app.mjs", ".gitignore", "docs/guide.md",
    `openspec/changes/${id}/proposal.md`, `openspec/changes/${id}/tasks.md`])
    write(sandbox, rel, readFileSync(join(root, rel)));
  write(sandbox, "scratch/undeclared.txt", "nobody declared this\n");
  const hash = () => state.singleRelevantSnapshot(id, sandbox, true);

  const base = hash();
  write(sandbox, "src/app.mjs", "export const app = 2;\n");
  const code = hash();
  assert.notEqual(code.workspaceHash, base.workspaceHash, "a code edit must expire evidence");
  assert.notEqual(code.codeHash, base.codeHash);
  assert.notEqual(code.reviewHash, base.reviewHash);
  write(sandbox, "docs/guide.md", "# Edited tracked file outside the task paths\n");
  assert.notEqual(hash().codeHash, code.codeHash, "tracked content is bound wherever it lives");
  const tracked = hash();
  write(sandbox, "run.counter", "1\n");
  write(sandbox, "scratch/undeclared.txt", "still nobody's\n");
  assert.equal(hash().workspaceHash, tracked.workspaceHash,
    "ignored output and undeclared untracked files do not expire evidence");
  write(sandbox, "src/new.mjs", "export const added = 1;\n");
  assert.notEqual(hash().workspaceHash, tracked.workspaceHash, "a declared new file is bound");

  const manifest = state.workspaceManifest(sandbox, id, true);
  assert.ok(Object.hasOwn(manifest, "docs/guide.md"),
    "a tracked edit outside the task paths still reaches the copy projection");
  assert.ok(Object.hasOwn(manifest, "src/new.mjs"));
  assert.ok(!Object.hasOwn(manifest, "scratch/undeclared.txt"));
  assert.ok(!Object.hasOwn(manifest, "run.counter"));
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}.gitdir`, { recursive: true, force: true });
});

// Target drift and target-edit-sync judge the target's dirty files. A tool
// rewriting an ignored counter in the target is not an edit outside the
// sandbox; a tracked file matching an ignore pattern still is.
test("target edits never include git-ignored files, but tracked ones still count", () => {
  const { root, state } = workspace({ ignore: "/.foundation/\n*.counter\n" });
  write(root, "legacy.counter", "0\n");
  git(root, "add", "-f", "legacy.counter");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "legacy");
  write(root, ".autoharness.counter", "1\n");
  const snapshot = state.preexistingDirty(root);
  write(root, ".autoharness.counter", "2\n");
  write(root, "legacy.counter", "1\n");
  const dirtyNow = state.preexistingDirty(root);
  assert.ok(!Object.hasOwn(dirtyNow, ".autoharness.counter"));
  assert.deepEqual(targetEditPaths(snapshot, dirtyNow), ["legacy.counter"]);
  rmSync(root, { recursive: true, force: true });
});

test("review identity ignores progress and handoff tracking but binds semantics", () => {
  const { root, id, state } = workspace({ declaredSurface: ["src/**"] });
  const changeRel = `openspec/changes/${id}`;
  const before = state.singleRelevantSnapshot(id, root, true);
  assert.notEqual(before.workspaceHash, before.codeHash,
    "executable evidence excludes the active change packet");
  write(root, `${changeRel}/tasks.md`,
    "# Tasks\n\n- [x] **T001** Work — verify: `true`\n");
  write(root, `${changeRel}/handoffs.yaml`, "version: 1\noperations: []\n");
  const progress = state.singleRelevantSnapshot(id, root, true);
  assert.notEqual(progress.workspaceHash, before.workspaceHash);
  assert.equal(progress.reviewHash, before.reviewHash,
    "controller progress and delivery tracking do not invalidate review");
  assert.equal(progress.codeHash, before.codeHash,
    "a tasks.md tick does not invalidate executable provider receipts");
  write(root, `${changeRel}/tasks.md`,
    "# Tasks\n\n- [x] **T001** Changed scope — verify: `true` [paths:src/**]\n");
  const taskSemantics = state.singleRelevantSnapshot(id, root, true);
  assert.notEqual(taskSemantics.reviewHash, progress.reviewHash,
    "task instructions and scope remain part of review identity");
  write(root, `${changeRel}/proposal.md`, "# Changed semantic intent\n");
  const semantic = state.singleRelevantSnapshot(id, root, true);
  assert.notEqual(semantic.reviewHash, taskSemantics.reviewHash,
    "semantic contract changes still invalidate review");
  write(root, "src/app.mjs", "export const app = 2;\n");
  assert.notEqual(state.singleRelevantSnapshot(id, root, true).reviewHash,
    semantic.reviewHash, "reviewed code bytes still invalidate review");
});

test("the manifest and the snapshot react to the same paths", () => {
  const { root, id, state } = workspace({ declaredSurface: ["src/**"] });
  const baseFiles = state.singleRelevantSnapshot(id, root, true).fileCount;
  const baseManifest = Object.keys(state.workspaceManifest(root, id, true)).length;

  write(root, "vendor-cli/tool.ts", "export const x = 1;\n");
  assert.equal(state.singleRelevantSnapshot(id, root, true).fileCount, baseFiles);
  assert.equal(Object.keys(state.workspaceManifest(root, id, true)).length,
    baseManifest, "an undeclared path must reach neither reader");

  write(root, "src/second.mjs", "export const second = 2;\n");
  assert.equal(state.singleRelevantSnapshot(id, root, true).fileCount,
    baseFiles + 1);
  assert.equal(Object.keys(state.workspaceManifest(root, id, true)).length,
    baseManifest + 1, "a declared path must reach both readers");
});

test("a change that declares nothing keeps the unconfined surface", () => {
  const { root, id, state } = workspace();
  const before = state.singleRelevantSnapshot(id, root, true).workspaceHash;
  write(root, "scratch/note.txt", "untracked and undeclared\n");
  const after = state.singleRelevantSnapshot(id, root, true).workspaceHash;
  const manifest = state.workspaceManifest(root, id, true);

  assert.notEqual(after, before,
    "confinement is what declaring a surface buys; silence confines nothing");
  assert.ok(Object.hasOwn(manifest, "scratch/note.txt"));
});

test("a declared path matcher reads the glob vocabulary tasks already use", () => {
  const matcher = declaredPathMatcher([
    "src/**", ".claude/tests/run-all.sh", "docs/"
  ]);
  assert.equal(matcher("src/app.mjs"), true);
  assert.equal(matcher("src"), true);
  assert.equal(matcher(".claude/tests/run-all.sh"), true);
  assert.equal(matcher("docs/adr/1.md"), true);
  assert.equal(matcher("vendor-cli/tool.ts"), false);
  assert.equal(matcher("srcx/app.mjs"), false);
  assert.equal(declaredPathMatcher(["*"])("anything/at/all"), true);
  assert.equal(declaredPathMatcher([])("anything"), false);
});

test("a deletion outside the declared surface is refused", () => {
  const declared = declaredPathMatcher(["src/**"]);
  const undeclared = undeclaredDeletions([
    { path: "src/gone.mjs", role: "code", before: "x", after: null },
    { path: "vendor-cli/one.ts", role: "code", before: "x", after: null },
    { path: "vendor-cli/two.ts", role: "code", before: "x", after: null },
    { path: "src/kept.mjs", role: "code", before: "x", after: "y" }
  ], declared);

  assert.deepEqual(undeclared.map((entry) => entry.path),
    ["vendor-cli/one.ts", "vendor-cli/two.ts"]);
});

test("a declared deletion still lands", () => {
  const declared = declaredPathMatcher(["src/**"]);
  assert.deepEqual(undeclaredDeletions([
    { path: "src/gone.mjs", role: "code", before: "x", after: null }
  ], declared), []);
});

test("the change packet is never treated as an undeclared deletion", () => {
  const declared = declaredPathMatcher(["src/**"]);
  assert.deepEqual(undeclaredDeletions([
    {
      path: "openspec/changes/confine-surface",
      role: "change-artifacts", before: "x", after: null
    }
  ], declared), []);
});

test("a projection is counted as update, create and delete", () => {
  const counts = projectionCounts([
    { path: "a", before: "x", after: "y" },
    { path: "b", before: null, after: "y" },
    { path: "c", before: "x", after: null },
    { path: "d", before: "x", after: null }
  ]);
  assert.deepEqual(counts, { update: 1, create: 1, delete: 2 });
});

// The read-only half of the land-check split: a pending transaction has to be
// reportable without being settled.
function recovery(root) {
  const transactions = join(root, ".foundation", "transactions");
  return {
    transactions,
    runtime: createApplyRecovery({
      transactions,
      transactionJournalPath: (id, transactionId) =>
        join(transactions, id, transactionId, "journal.json"),
      readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
      verifyAppliedProjection: () => ({ valid: true }),
      saveApplyJournal: () => {},
      rollbackApplyTransaction: () => {
        throw new Error("rollback must not run while only reporting");
      },
      settleApplyTransaction: () => {
        throw new Error("settlement must not run while only reporting");
      },
      saveRuntime: () => {},
      clearSnapshotCache: () => {},
      now: () => "2026-01-01T00:00:00.000Z",
      blockWithDecision: () => {
        throw new Error("blocking must not run while only reporting");
      },
      fail: (message) => { throw new Error(message); }
    })
  };
}

const journal = (root, id, transactionId, body) =>
  write(root, `.foundation/transactions/${id}/${transactionId}/journal.json`,
    JSON.stringify(body));

test("a pending apply is reported with its counts and never settled", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-pending-"));
  const id = "confine-surface";
  journal(root, id, "apply-1", {
    changeId: id, transactionId: "apply-1", status: "applying",
    appliedPaths: ["a"],
    entries: [
      { path: "a", before: "x", after: "y" },
      { path: "vendor/one", before: "x", after: null },
      { path: "vendor/two", before: "x", after: null }
    ]
  });
  const { runtime } = recovery(root);

  const pending = runtime.pendingApplyTransactions(id);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].transactionId, "apply-1");
  assert.equal(pending[0].status, "applying");
  assert.equal(pending[0].appliedPaths, 1);
  assert.deepEqual(pending[0].counts, { update: 1, create: 0, delete: 2 });
});

test("a settled transaction is not reported as pending", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-settled-"));
  const id = "confine-surface";
  journal(root, id, "apply-1", {
    changeId: id, transactionId: "apply-1", status: "committed",
    appliedPaths: [], entries: [{ path: "a", before: "x", after: "y" }]
  });
  const { runtime } = recovery(root);

  assert.deepEqual(runtime.pendingApplyTransactions(id), []);
});

test("a change with no transactions has nothing pending", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-empty-"));
  const { runtime } = recovery(root);
  assert.deepEqual(runtime.pendingApplyTransactions("confine-surface"), []);
});

// --- The moved-target stop, and the pathspec two callers have to agree on. ---
// A worktree sandbox is pinned to the commit it branched from. The refusal was
// bare, so it read as permanent; three call sites now state the same exits.

test("a moved target offers replaying, and recommends it", () => {
  const decision = targetHeadMovedDecision({
    changeId: "confine-surface", recordedBase: "aaa", currentHead: "bbb"
  });

  assert.equal(decision.kind, "control-head-moved");
  assert.equal(decision.recommended, "sync");
  assert.equal(decision.automaticRecovery, "sync");
  assert.equal(decision.recordedBase, "aaa");
  assert.equal(decision.currentHead, "bbb");
  const ids = decision.options.map((option) => option.id);
  assert.deepEqual(ids, ["sync", "inspect", "pause"]);
  assert.match(decision.options[0].outcome, /sandbox sync confine-surface/);
});

test("an external target move remains non-authoritative while Build is active", () => {
  const drift = outOfBandDeliveryDriftValue({
    changeId: "confine-surface",
    state: { status: "building" },
    recordedHead: "aaa",
    currentHead: "bbb",
    baseDecision: targetHeadMovedDecision({
      changeId: "confine-surface", recordedBase: "aaa", currentHead: "bbb"
    })
  });
  assert.equal(drift.kind, "out-of-band-delivery-drift");
  assert.equal(drift.lifecycleStatus, "building");
  assert.equal(drift.authoritative, false);
  assert.equal(drift.proofStatus, "unchanged");
  assert.match(drift.summary, /not Change Loop proof or lifecycle completion/);
  assert.match(drift.recoveryCommand, /sandbox sync confine-surface/);
  // WORKFLOW: sync, re-prove when invalidated, and continue to archived.
  assert.equal(drift.automaticRecovery, "sync");
  assert.equal(automaticRecoveryAction("confine-surface", drift)?.kind, "sandbox-sync",
    "observed out-of-band delivery still syncs automatically instead of asking");
});

test("delivery drift is reported only when target bytes match the change projection", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-delivery-observation-"));
  const workspace = join(root, "sandbox");
  mkdirSync(workspace);
  writeFileSync(join(root, "changed.txt"), "delivered\n");
  writeFileSync(join(workspace, "changed.txt"), "delivered\n");
  const state = { workspace: { mode: "worktree", path: workspace, baseHead: "base" } };
  const git = (args) => args[0] === "diff"
    ? { status: 0, stdout: "changed.txt\0" }
    : { status: 0, stdout: "" };
  const matching = targetProjectionObservationValue({
    root, state, git, fileDigest: (path) => readFileSync(path, "utf8")
  });
  assert.equal(matching.observed, true);
  writeFileSync(join(root, "changed.txt"), "unrelated\n");
  const unrelated = targetProjectionObservationValue({
    root, state, git, fileDigest: (path) => readFileSync(path, "utf8")
  });
  assert.equal(unrelated.observed, false);
  assert.equal(unrelated.reason, "target-does-not-match-change-projection");
});

test("doctor excludes journaled apply and authorized Land records from delivery drift", () => {
  const observed = { observed: true, references: [] };
  assert.equal(shouldReportOutOfBandDelivery({
    status: "building", workspace: { applied: false }
  }, observed), true);
  assert.equal(shouldReportOutOfBandDelivery({
    status: "applied", workspace: { applied: true }
  }, observed), false);
  assert.equal(shouldReportOutOfBandDelivery({
    status: "proven", workspace: { applied: true }
  }, observed), false);
  assert.deepEqual(recordedDeliveryReferences({ repositories: {
    child: { land: { commit: "abc", authority: { kind: "host-user-decision" } } }
  } }), []);
  assert.deepEqual(recordedDeliveryReferences({
    deliveryReferences: [{ kind: "pull-request", reference: "pr-1" }]
  }), [{ kind: "pull-request", reference: "pr-1" }]);
});

test("a multi-repository sandbox offers the conflict-atomic replay", () => {
  const decision = targetHeadMovedDecision({
    changeId: "confine-surface", recordedBase: "aaa", currentHead: "bbb",
    multiRepository: true
  });

  assert.equal(decision.recommended, "sync");
  assert.equal(decision.automaticRecovery, "sync");
  assert.deepEqual(decision.options.map((option) => option.id),
    ["sync", "inspect", "pause"]);
  assert.match(decision.options[0].outcome, /every moved repository sandbox/);
});

// Enforced centrally rather than reviewed per call site, so a stop that offers
// no real choice cannot ship.
test("the moved-target stop satisfies the blocked-decision contract", () => {
  const { blockedDecisionValue } = createBlockedDecision({
    fail: (message) => { throw new Error(message); }
  });
  for (const multiRepository of [false, true])
    assert.doesNotThrow(() => blockedDecisionValue("c", "control-head-moved",
      targetHeadMovedDecision({
        changeId: "c", recordedBase: "a", currentHead: "b", multiRepository
      })));
});

// Apply projects the sandbox through this pathspec and the worktree replay
// replays it through the same one. A path one includes and the other excludes
// is either work dropped at Land or a teammate's file replayed as this change's.
test("the sandbox code pathspec excludes what the change does not own", () => {
  const pathspec = sandboxCodePathspec("confine-surface", ["vendor/api"]);

  assert.equal(pathspec[0], ".");
  for (const excluded of [
    ":(exclude)openspec/changes/confine-surface/**",
    ":(exclude)coverage/**",
    ":(exclude)test-results/**",
    ":(exclude)playwright-report/**",
    ":(exclude).foundation/**",
    ":(exclude)vendor/api"
  ]) assert.ok(pathspec.includes(excluded), `missing ${excluded}`);
});

test("the pathspec needs no submodules to be well formed", () => {
  assert.deepEqual(sandboxCodePathspec("x"), sandboxCodePathspec("x", []));
});

test("nested repository paths include the root and every descendant", () => {
  const nested = nestedRepositoryPathMatcher(["repos/api/", "services/web"]);
  assert.equal(nested("repos/api"), true);
  assert.equal(nested("repos/api/.git"), true);
  assert.equal(nested("services/web/src/app.ts"), true);
  assert.equal(nested("repos/api-client"), false);
  assert.equal(nested("src/app.ts"), false);
});

test("copy apply entries never cross into a selected child repository", () => {
  const root = "/target";
  const sandbox = "/sandbox";
  const state = {
    workspace: {
      path: sandbox,
      mode: "copy",
      baseline: {
        "src/app.ts": "before",
        "repos/api/.git": "git-before",
        "repos/api/server.ts": "api-before"
      }
    }
  };
  const runtime = createApplyRuntime({
    root,
    selectedRepositories: () => [
      { id: "root", type: "root", relativePath: "." },
      { id: "api", type: "git", relativePath: "repos/api" }
    ],
    workspaceManifest: (path) => path === sandbox ? {
      "src/app.ts": "after",
      "repos/api/.git": "git-after",
      "repos/api/server.ts": "api-after"
    } : state.workspace.baseline,
    safeRootPath: (path) => join(root, path),
    pathIdentity: (path) => path,
    pathMode: () => 0o644,
    currentChangeRelativePath: (id) => `openspec/changes/${id}`,
    changePath: (id) => join(root, "openspec", "changes", id)
  });

  assert.deepEqual(runtime.buildApplyEntries("safe-copy", state).map((entry) => entry.path), [
    "src/app.ts", "openspec/changes/safe-copy"
  ]);
});

function recoveryJournal(root) {
  const transactions = join(root, ".foundation", "transactions");
  return createLandJournal({
    root,
    transactions,
    fileDigest: (path) => readFileSync(path, "utf8"),
    directoryHash: (path) => `directory:${path}`,
    pathInside: (parent, path) => path.startsWith(`${parent}/`),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => "2026-01-01T00:00:00.000Z"
  });
}

function manualJournal(root, transactionId) {
  const transactionRoot = join(root, ".foundation", "transactions", "recover", transactionId);
  write(root, "app.txt", "divergent\n");
  write(transactionRoot, "backup/0", "before\n");
  return {
    version: 1,
    changeId: "recover",
    transactionId,
    status: "manual-recovery",
    entries: [{
      path: "app.txt", role: "code", before: "before\n", after: "after\n", backup: "backup/0"
    }],
    appliedPaths: ["app.txt"],
    inFlightPaths: []
  };
}

test("restore-backup settles manual recovery and verifies the original content", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-restore-backup-"));
  const runtime = recoveryJournal(root);
  const value = manualJournal(root, "apply-restore");

  runtime.settle(value, "restore-backup", "decision-1");

  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "before\n");
  assert.equal(value.status, "rolled-back");
  assert.equal(value.recovery.decisionRef, "decision-1");
});

test("restore-backup verifies every backup before moving the current target", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-bad-backup-"));
  const runtime = recoveryJournal(root);
  const value = manualJournal(root, "apply-bad-backup");
  write(root, ".foundation/transactions/recover/apply-bad-backup/backup/0", "corrupt\n");

  assert.throws(() => runtime.settle(value, "restore-backup", "decision-3"),
    /backup verification failed/);

  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "divergent\n");
  assert.equal(value.status, "recovering-backup");
});

test("keep-current closes the journal only after runtime requires a sync", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-keep-current-"));
  const journalRuntime = recoveryJournal(root);
  const value = manualJournal(root, "apply-keep");
  journalRuntime.save(value);
  const state = { id: "recover", status: "proven", workspace: { applied: true } };
  const runtime = createApplyRecovery({
    transactions: join(root, ".foundation", "transactions"),
    transactionJournalPath: (id, transactionId) =>
      join(root, ".foundation", "transactions", id, transactionId, "journal.json"),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    verifyAppliedProjection: () => ({ valid: false }),
    saveApplyJournal: journalRuntime.save,
    rollbackApplyTransaction: journalRuntime.rollback,
    settleApplyTransaction: journalRuntime.settle,
    saveRuntime: () => {},
    clearSnapshotCache: () => {},
    now: () => "2026-01-01T00:00:00.000Z",
    blockWithDecision: () => { throw new Error("unexpected decision block"); },
    fail: (message) => { throw new Error(message); }
  });

  runtime.recoverPendingApply("recover", state, {
    resolution: "keep-current", decisionRef: "decision-2"
  });

  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "divergent\n");
  assert.equal(state.workspace.recovery.requiresSync, true);
  assert.equal(runtime.pendingApplyTransactions("recover").length, 0);
  assert.equal(JSON.parse(readFileSync(
    join(root, ".foundation", "transactions", "recover", "apply-keep", "journal.json"),
    "utf8")).status, "settled-current");
});
