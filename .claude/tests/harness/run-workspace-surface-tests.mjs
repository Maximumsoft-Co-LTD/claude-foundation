// What the sandbox copies, and what the hash sees, decided the same way.
//
// Three defects are pinned here, all of them reported from a real project and
// all of them silent. A committed fixture directory whose name collided with a
// build-output name vanished from both the copy and the hash; git inside the
// sandbox then reported files the change never touched as deleted. Relative
// symlinks were rewritten to absolute paths pointing back into the real
// project, so the sandbox was not isolated at all. And landing one change left
// its archive move uncommitted, which cost the *next* change its worktree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_ONLY_EXCLUDED_DIRS, isExcludedPath, trackedPathSet
} from "../../harness/runtime/core/workspace-surface.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let assertions = 0;
const check = (fn) => { fn(); assertions += 1; };

const SURFACE = new Set([
  ".git", ".foundation", ".workflow", "node_modules", "coverage",
  "test-results", "playwright-report", "__pycache__"
]);
const COPY = new Set([...SURFACE].filter((dir) => dir !== ".git"));
const excluded = (rel, tracked = false) =>
  isExcludedPath(rel, { excluded: SURFACE, tracked });

// The reported case: `.workflow` names the harness's legacy source at the root
// and nothing at all below it.
check(() => assert.equal(excluded(".workflow/legacy.md"), true));
check(() => assert.equal(excluded(".codex/hooks/tests/fixtures/.workflow/case.md"), false,
  "a nested directory only shares a name with the harness's own"));
check(() => assert.equal(excluded(".foundation/runtime/x.json"), true));
check(() => assert.equal(excluded("examples/app/.foundation/runtime/x.json"), false));
check(() => assert.deepEqual([...ROOT_ONLY_EXCLUDED_DIRS].sort(), [".foundation", ".workflow"]));

// Depth alone cannot decide it: every monorepo nests node_modules, and pulling
// one into the hash would be a worse failure than the one being fixed.
check(() => assert.equal(excluded("packages/api/node_modules/left-pad/index.js"), true));
check(() => assert.equal(excluded("apps/web/coverage/lcov.info"), true));
// ...unless git carries it, which is the axis that actually separates
// generated output from content.
check(() => assert.equal(excluded("tests/fixtures/coverage/expected.info", true), false,
  "a committed fixture is content whatever the directory is called"));
check(() => assert.equal(excluded("packages/api/node_modules/left-pad/index.js", true), false));
// Tracking never buys a path past the absolute exclusions.
check(() => assert.equal(excluded(".foundation/runtime/x.json", true), true));
check(() => assert.equal(excluded("vendor/pkg/.git/config", true), true));

// The copy set omits `.git` so the sandbox stays a git repository.
check(() => assert.equal(isExcludedPath(".git/HEAD", { excluded: COPY }), false));
check(() => assert.equal(excluded(".git/HEAD"), true));

check(() => assert.deepEqual([...trackedPathSet(["a/b/c.txt"])].sort(),
  ["a", "a/b", "a/b/c.txt"], "a directory filter must pass before the file does"));

// Everything above is a claim about behaviour the runtime only exhibits end to
// end, so the sandbox itself is exercised against a real repository.
const fixture = mkdtempSync(join(tmpdir(), "foundation-surface-"));
const fm = (args, cwd) => execFileSync("node",
  [join(cwd, ".claude", "harness", "foundation.mjs"), ...args],
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const project = join(fixture, "project");
  mkdirSync(join(project, ".claude", "harness"), { recursive: true });
  mkdirSync(join(project, "openspec"), { recursive: true });
  execFileSync("cp", ["-R", join(ROOT, ".claude", "harness") + "/.", join(project, ".claude", "harness")]);
  execFileSync("cp", ["-R", join(ROOT, "openspec", "schemas"), join(project, "openspec")]);
  execFileSync("cp", [join(ROOT, "openspec", "config.yaml"), join(project, "openspec")]);

  // A committed fixture named after the harness's own directory, and a
  // relative symlink — the two shapes the copy used to destroy.
  mkdirSync(join(project, "hooks", "fixtures", ".workflow"), { recursive: true });
  writeFileSync(join(project, "hooks", "fixtures", ".workflow", "case.md"), "fixture\n");
  mkdirSync(join(project, "skills"), { recursive: true });
  writeFileSync(join(project, "target.txt"), "v1\n");
  symlinkSync("../target.txt", join(project, "skills", "link.txt"));
  writeFileSync(join(project, "app.txt"), "v1\n");
  // Sandboxes carry `.git`, so committing one would embed a repository. Real
  // installs ignore all of `.foundation/`; this fixture ignores only the
  // sandboxes so that machine state under it still exercises the dirty-target
  // exemption below.
  writeFileSync(join(project, ".gitignore"), ".foundation/sandboxes/\n");
  const git = (args) => execFileSync("git", args, { cwd: project, encoding: "utf8" });
  git(["init", "-q", "."]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);

  fm(["new", "Surface case", "--rapid"], project);
  // Force the copy path: an untracked file the harness does not own, written
  // after the change exists. Dirt the tree already carried when the change
  // began no longer costs it a worktree, so writing this first would now
  // select the mode this fixture exists to avoid.
  writeFileSync(join(project, "unrelated.txt"), "dirty\n");
  fm(["resolve", "surface-case", "--impact", "low", "--coupling", "isolated"], project);
  const created = fm(["sandbox", "create", "surface-case"], project);
  check(() => assert.match(created, /mode: isolated-copy/,
    "an unrelated dirty file still earns the copy"));
  const sandbox = join(project, ".foundation", "sandboxes", "surface-case");

  check(() => assert.equal(readlinkSync(join(sandbox, "skills", "link.txt")), "../target.txt",
    "a relative symlink must not be rewritten to point back into the real project"));
  const status = execFileSync("git", ["status", "--porcelain"],
    { cwd: sandbox, encoding: "utf8" });
  check(() => assert.doesNotMatch(status, /\.workflow/,
    "a committed fixture must survive the copy instead of reading as a deletion"));
  // The defect this pins is not "git is noisy" — the copy legitimately carries
  // the untracked file that forced it, plus the change packet. It is that a
  // tracked file the change never touched showed up as deleted or modified,
  // which is what made it read as work outside the change's scope.
  const carriedOver = status.split("\n").filter(Boolean)
    .filter((line) => !/^\?\? /.test(line));
  check(() => assert.deepEqual(carriedOver, [],
    "no tracked file may read as changed in a copy of a clean tree"));

  // Landing a change leaves its archive move uncommitted. That dirt belongs to
  // the harness, and it used to cost the *next* change its worktree — pushing
  // every later change onto the lower-fidelity copy path for a reason the
  // operator never caused and could only fix by committing someone else's work.
  rmSync(join(project, "unrelated.txt"));
  fm(["new", "Worktree case", "--rapid"], project);
  fm(["resolve", "worktree-case", "--impact", "low", "--coupling", "isolated"], project);
  // Commit first so the only dirt left is the kind under test. Everything
  // else — another change's packet included — must still force the copy.
  git(["add", "-A"]);
  git(["commit", "-qm", "packets"]);
  mkdirSync(join(project, "openspec", "changes", "archive", "2026-01-01-prior"),
    { recursive: true });
  writeFileSync(
    join(project, "openspec", "changes", "archive", "2026-01-01-prior", "proposal.md"),
    "archived\n");
  writeFileSync(join(project, ".foundation", "stray.log"), "machine state\n");
  const second = fm(["sandbox", "create", "worktree-case"], project);
  check(() => assert.doesNotMatch(second, /isolated-copy/,
    "an uncommitted archive move is the harness's own output, not a dirty target"));

  // The trigger must stay conservative for everything else. The edit lands
  // after the change begins and changes the committed content, so it is this
  // change's dirt rather than something the tree was already carrying.
  fm(["new", "Still copies", "--rapid"], project);
  fm(["resolve", "still-copies", "--impact", "low", "--coupling", "isolated"], project);
  writeFileSync(join(project, "unrelated.txt"), "dirty again\n");
  check(() => assert.match(fm(["sandbox", "create", "still-copies"], project),
    /mode: isolated-copy/, "real uncommitted work still earns the copy"));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`workspace surface: ALL PASS (${assertions}/${assertions} assertions)`);
