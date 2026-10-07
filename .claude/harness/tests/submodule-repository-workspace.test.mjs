import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { coordinatorAction, envelopeContextFiles } from "../runtime/workflow/advance-runtime.mjs";
import { createChangePolicy } from "../runtime/workflow/change-policy.mjs";
import { shellMutationViolation } from "../runtime/core/shell-mutation-policy.mjs";
import { reviewChangedSurface } from "../runtime/workflow/packet-runtime.mjs";
import {
  normalizeReviewFindingPaths, reviewFindingIssues
} from "../runtime/evidence/configured-reviewer.mjs";

// One location per task repository. A consumer keeps product code in a Git
// submodule declared as its own repository; the shared sandbox holds only an
// empty (or missing) submodule directory, and the repository's work lives in
// `.foundation/repository-sandboxes/<change>/<repository>`. Every surface that
// tells an agent where to write, and every surface that reads that work back,
// must name the same place.

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "../../hooks/phase-mutation-guard.mjs");
const SUBMODULE = "services/hook/svc";

function git(args, cwd) {
  const result = spawnSync("git", ["-c", "protocol.file.allow=always", ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "submodule-repository-")));
  const child = join(base, "svc");
  mkdirSync(child);
  git(["init", "-q"], child);
  writeFileSync(join(child, "main.go"), "package main\n\nfunc main() {}\n");
  git(["add", "."], child);
  git(["commit", "-qm", "svc"], child);
  const project = join(base, "project");
  mkdirSync(project);
  git(["init", "-q"], project);
  writeFileSync(join(project, "README.md"), "root\n");
  git(["submodule", "add", "-q", child, SUBMODULE], project);
  git(["add", "."], project);
  git(["commit", "-qm", "superproject"], project);
  const rootHead = git(["rev-parse", "HEAD"], project);
  const shared = join(project, ".foundation", "sandboxes", "demo");
  mkdirSync(dirname(shared), { recursive: true });
  git(["worktree", "add", "-q", "--detach", shared, "HEAD"], project);
  const target = join(project, SUBMODULE);
  const svcHead = git(["rev-parse", "HEAD"], target);
  const repositorySandbox = join(project, ".foundation", "repository-sandboxes", "demo", "svc");
  mkdirSync(dirname(repositorySandbox), { recursive: true });
  git(["worktree", "add", "-q", "--detach", repositorySandbox, svcHead], target);
  const state = {
    changeId: "demo", status: "building",
    workspace: { mode: "worktree", path: shared, targetPath: project, baseHead: rootHead },
    repositories: {
      root: { mode: "worktree", path: shared, targetPath: project, baseHead: rootHead,
        access: "write" },
      svc: { mode: "worktree", path: repositorySandbox, targetPath: target,
        baseHead: svcHead, access: "write", applied: false }
    }
  };
  const packetDir = join(project, "openspec", "changes", "demo");
  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "tasks.md"), "- [ ] **T001** Fix svc [repo:svc] [paths:main.go]\n");
  return {
    base, project, shared, target, repositorySandbox, packetDir, state, rootHead, svcHead,
    cleanup: () => rmSync(base, { recursive: true, force: true })
  };
}

test("Build EDIT advertises the task repository's sandbox, never the shared submodule mirror", () => {
  const f = fixture();
  try {
    const value = coordinatorAction({
      id: "demo", state: f.state, workspaceHash: "w", proofCursor: {},
      authorityRequests: [], stableHash: (v) => JSON.stringify(v),
      dispatch: { action: "run-in-session", task: { taskId: "T001" } },
      plan: { tasks: [{ id: "T001", text: "Fix svc", repository: "svc", paths: ["main.go"] }] }
    });
    assert.equal(value.action, "EDIT");
    assert.equal(value.workspace, f.repositorySandbox);
    assert.equal(value.tasks[0].workspace, f.repositorySandbox);
    assert.deepEqual(value.workspaces, { svc: f.repositorySandbox });

    // A group spanning root and the submodule keeps the shared workspace for
    // root and names each task's own location.
    const mixed = coordinatorAction({
      id: "demo", state: f.state, workspaceHash: "w", proofCursor: {},
      authorityRequests: [], stableHash: (v) => JSON.stringify(v),
      dispatch: { action: "run-in-session" },
      plan: { groups: [["T001", "T002"]], tasks: [
        { id: "T001", text: "Fix svc", repository: "svc", paths: ["main.go"] },
        { id: "T002", text: "Docs", repository: "root", paths: ["README.md"] }
      ] }
    });
    assert.equal(mixed.workspace, f.shared);
    assert.deepEqual(mixed.tasks.map((task) => task.workspace), [f.repositorySandbox, f.shared]);
    assert.deepEqual(mixed.workspaces, { svc: f.repositorySandbox, root: f.shared });

    const context = envelopeContextFiles({
      packetDir: f.packetDir, state: f.state,
      tasks: value.tasks,
      // Repair-graph paths are review identities: `<repository>/<path>`.
      paths: []
    });
    assert.ok(context.contextFiles.includes(join(f.repositorySandbox, "main.go")));
    assert.ok(!context.contextFiles.some((file) => file.startsWith(join(f.shared, "services"))));
    assert.deepEqual(context.newFiles, []);

    const repair = envelopeContextFiles({
      packetDir: f.packetDir, state: f.state, tasks: [],
      scopedPaths: ["svc/main.go", "root/README.md", "svc/new.go"]
    });
    assert.ok(repair.contextFiles.includes(join(f.repositorySandbox, "main.go")));
    assert.ok(repair.contextFiles.includes(join(f.shared, "README.md")));
    assert.deepEqual(repair.newFiles, [join(f.repositorySandbox, "new.go")]);
  } finally { f.cleanup(); }
});

function guard(f, event, env = {}) {
  mkdirSync(join(f.project, ".foundation", "runtime"), { recursive: true });
  mkdirSync(join(f.project, ".foundation", "logs", "demo"), { recursive: true });
  writeFileSync(join(f.project, ".foundation", "runtime", "demo.json"), JSON.stringify(f.state));
  writeFileSync(join(f.project, ".foundation", "logs", "demo", "phase-context.jsonl"),
    `${JSON.stringify({ timestamp: new Date().toISOString(), phase: "build", changeId: "demo" })}\n`);
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event), encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: f.project,
      FOUNDATION_GUARDRAIL_MODE: "block", FOUNDATION_SHELL_GUARD: "block", ...env }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("phase guard treats the change's repository sandboxes as in-workspace", () => {
  const f = fixture();
  try {
    const bash = (command, cwd = undefined) => guard(f,
      { tool_name: "Bash", ...(cwd ? { cwd } : {}), tool_input: { command } });
    assert.equal(bash(`cd ${f.repositorySandbox} && touch handler.go`), "");
    assert.equal(bash(`cd ${f.repositorySandbox} && go fmt ./... > fmt.log`), "");
    // The host-reported cwd is pinned the same way as in the shared sandbox.
    assert.equal(bash("touch handler.go", f.repositorySandbox), "");
    // Same strictness: escapes and other targets stay refused.
    assert.match(bash(`cd ${f.repositorySandbox} && cp main.go ${f.base}/outside.go`),
      /outside the isolated workspace/);
    assert.match(bash(`cd ${f.project} && touch x`), /must start inside/);
    // The shared sandbox's mirror of the submodule is not where its work lives.
    assert.match(bash(`cd ${join(f.shared, SUBMODULE)} && touch main.go`),
      /repository 'svc'.*repository-sandboxes\/demo\/svc/);

    const write = (path) => guard(f,
      { tool_name: "Write", tool_input: { file_path: path, content: "x" } });
    assert.equal(write(join(f.repositorySandbox, "handler.go")), "");
    assert.match(write(join(f.shared, SUBMODULE, "main.go")),
      /repository 'svc'.*repository-sandboxes\/demo\/svc/);
    // Auto mode moves the misplaced write to the repository's sandbox.
    const redirected = JSON.parse(guard(f,
      { tool_name: "Write", tool_input: { file_path: join(f.shared, SUBMODULE, "main.go"), content: "x" } },
      { FOUNDATION_GUARDRAIL_MODE: "auto" }));
    assert.equal(redirected.hookSpecificOutput.updatedInput.file_path,
      join(f.repositorySandbox, "main.go"));
  } finally { f.cleanup(); }
});

test("shell policy grants repository roots only from well-formed absolute declarations", () => {
  const environment = (rows) => ({ FOUNDATION_WORKSPACE_ROOT: "/w/shared",
    FOUNDATION_REPOSITORY_WORKSPACES_JSON: rows });
  const rows = JSON.stringify([{ repository: "svc", path: "/w/repo/svc", mirror: "/w/shared/svc" }]);
  assert.equal(shellMutationViolation("build", environment(rows), "cd /w/repo/svc && touch a"), null);
  assert.equal(shellMutationViolation("build", environment(rows),
    "cd /w/shared && cp a /w/repo/svc/a"), null);
  assert.match(shellMutationViolation("build", environment(rows),
    "cd /w/shared && cp a svc/a && touch /w/shared/svc/b"), /repository 'svc'/);
  for (const malformed of ["{", JSON.stringify([{ path: "relative" }]), JSON.stringify({})])
    assert.match(shellMutationViolation("build", environment(malformed),
      "cd /w/repo/svc && touch a"), /must start inside/);
});

test("a read-only repository sandbox is never a Build write root", () => {
  const f = fixture();
  try {
    f.state.repositories.svc.access = "read";
    assert.match(guard(f, { tool_name: "Bash",
      tool_input: { command: `cd ${f.repositorySandbox} && touch handler.go` } }),
    /must start inside/);
    assert.match(guard(f, { tool_name: "Write",
      tool_input: { file_path: join(f.repositorySandbox, "handler.go"), content: "x" } }),
    /repository 'svc' is read-only for this change/);
  } finally { f.cleanup(); }
});

test("review findings named through root bind to the submodule repository", () => {
  const f = fixture();
  try {
    const rows = [{ repositoryId: "svc", path: "main.go" }];
    const changedSurface = reviewChangedSurface({
      repositoryById: (_id, repositoryId) => repositoryId === "svc"
        ? { id: "svc", relativePath: SUBMODULE, workspacePath: f.repositorySandbox }
        : { id: "root", relativePath: ".", workspacePath: f.shared },
      stableHash: (value) => JSON.stringify(value),
      compactList: (value) => value
    }, "demo", f.state, rows);
    assert.equal(changedSurface.inspection[0].relativePath, SUBMODULE);
    changedSurface.inspection.push({ repositoryId: "root", workspacePath: f.shared, paths: [] });
    const packet = {
      reviewScope: { paths: ["svc/main.go"] },
      changedSurface: { ...changedSurface,
        manifest: [{ repositoryId: "svc", path: "main.go", identity: "x" }] }
    };
    for (const path of [`root/${SUBMODULE}/main.go`, `${SUBMODULE}/main.go`, "svc/main.go"]) {
      const review = { findings: [{ id: "F1", severity: "major", path, line: 3, message: "m" }] };
      assert.deepEqual(reviewFindingIssues(review, packet), [], path);
      assert.equal(normalizeReviewFindingPaths(review, packet).findings[0].path, "svc/main.go");
    }
    // A root path outside every declared repository still fails closed.
    assert.match(reviewFindingIssues({ findings: [{ id: "F2", severity: "major",
      path: "root/services/other/main.go", line: null, message: "m" }] }, packet)[0],
    /outside the dispatched review scope/);
  } finally { f.cleanup(); }
});

function policy(f, selected = ["root", "svc"]) {
  const records = (stdout) => String(stdout).split("\0").filter(Boolean)
    .map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }));
  const rows = {
    root: { id: "root", workspacePath: f.shared },
    svc: { id: "svc", type: "submodule", relativePath: SUBMODULE,
      workspacePath: f.repositorySandbox }
  };
  return createChangePolicy({
    root: f.project, excludedWorkspaceDirs: new Set([".foundation", ".git"]), providers: {},
    gitHead: (cwd) => { try { return git(["rev-parse", "HEAD"], cwd); } catch { return null; } },
    git: (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" }),
    porcelainStatusRecords: records, workspaceManifest: () => ({}),
    loadRuntime: () => f.state,
    selectedRepositories: () => selected.map((id) => rows[id]),
    declaredRepositoryPaths: () => [SUBMODULE],
    isCurrentChangePath: () => false, readJson: () => ({}), fileDigest: () => "",
    fail: (message) => { throw new Error(message); }
  });
}

test("a missing or moved submodule in the shared sandbox is not a root change", () => {
  const f = fixture();
  try {
    rmSync(join(f.shared, SUBMODULE), { recursive: true, force: true });
    writeFileSync(join(f.shared, "README.md"), "root changed\n");
    const surface = policy(f).canonicalChangedSurface("demo", f.state);
    assert.deepEqual(surface.map((row) => `${row.repositoryId}/${row.path}`), ["root/README.md"]);

    // A gitlink-only bump (staged or committed) is the submodule's own Land
    // pointer, never root task content — not even for a root-only change.
    git(["checkout", "-q", "--", "."], f.shared);
    writeFileSync(join(f.target, "next.go"), "package main\n");
    git(["add", "."], f.target);
    git(["commit", "-qm", "ahead"], f.target);
    const ahead = git(["rev-parse", "HEAD"], f.target);
    git(["update-index", "--cacheinfo", `160000,${ahead},${SUBMODULE}`], f.shared);
    assert.deepEqual(policy(f, ["root"]).canonicalChangedSurface("demo", f.state), []);
    git(["commit", "-qm", "bump"], f.shared);
    assert.deepEqual(policy(f, ["root"]).canonicalChangedSurface("demo", f.state), []);
  } finally { f.cleanup(); }
});
