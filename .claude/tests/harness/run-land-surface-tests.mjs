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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createStateRuntime } from "../../harness/runtime/core/state-runtime.mjs";
import {
  declaredPathMatcher
} from "../../harness/runtime/core/workspace-surface.mjs";
import {
  createApplyRecovery, projectionCounts, undeclaredDeletions
} from "../../harness/runtime/workflow/apply-recovery.mjs";

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
function workspace({ declaredSurface = [], taskPaths = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-surface-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  write(root, "src/app.mjs", "export const app = 1;\n");
  write(root, ".gitignore", "/.foundation/\n");
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
    declaredSurface
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
