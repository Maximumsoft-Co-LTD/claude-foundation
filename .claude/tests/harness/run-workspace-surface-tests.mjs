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
  existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync,
  rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_ONLY_EXCLUDED_DIRS, isChangePacketPath, isExcludedPath,
  sandboxCodePathspec, trackedPathSet
} from "../../harness/runtime/core/workspace-surface.mjs";
import { createStateRuntime } from "../../harness/runtime/core/state-runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let assertions = 0;
// A label makes one assertion countable by the TAP wrapper that carries change
// evidence; without one the assertion still runs and still fails the suite, it
// just is not individually named. Optional, so existing checks are unaffected.
const check = (fn, label) => {
  try {
    fn();
  } catch (error) {
    if (label) console.log(`FAIL: ${label}`);
    throw error;
  }
  assertions += 1;
  if (label) console.log(`PASS: ${label}`);
};

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

// The packet boundary. Three callers read it — the sandbox pathspec, the
// workspace walk, and the code hash an executable provider binds — so it is
// stated once and pinned here.
check(() => assert.equal(isChangePacketPath("openspec/changes/add-auth/design.md", "add-auth"), true),
  "a file inside the change packet is packet");
check(() => assert.equal(isChangePacketPath("openspec/changes/add-auth", "add-auth"), true),
  "the packet directory itself is packet");
check(() => assert.equal(isChangePacketPath("openspec/changes/add-auth-extra/design.md", "add-auth"), false),
  "a sibling change whose id shares a prefix is not this packet");
check(() => assert.equal(isChangePacketPath("openspec/specs/auth/spec.md", "add-auth"), false),
  "a landed spec is code surface, not packet");
check(() => assert.equal(isChangePacketPath("src/auth.ts", "add-auth"), false),
  "ordinary source is not packet");
// The sandbox pathspec excludes the same packet; a disagreement here is either
// work dropped at Land or evidence surviving an edit it should not.
check(() => assert.ok(
  sandboxCodePathspec("add-auth").includes(":(exclude)openspec/changes/add-auth/**")),
"the sandbox pathspec excludes the packet the code hash omits");

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

  // The manifests whose diff decides what apply projects must admit tracked
  // content under excluded-named directories, exactly as the snapshot and the
  // copy filter do. A name-only exclusion here passed proof (the hash saw the
  // edit) and then silently dropped the same edit at Land.
  const stateRuntime = createStateRuntime({
    root: project,
    runtime: join(project, ".foundation", "runtime"),
    changes: join(project, "openspec", "changes"),
    receipts: join(project, ".foundation", "receipts"),
    evidenceVault: join(project, ".foundation", "evidence"),
    snapshots: join(project, ".foundation", "snapshots"),
    excludedWorkspaceDirs: SURFACE,
    readJson: (path, fallback) => {
      try { return JSON.parse(readFileSync(path, "utf8")); }
      catch { if (fallback !== undefined) return fallback; throw new Error(`unreadable ${path}`); }
    },
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(value));
    },
    canonicalPath: (path) => (existsSync(resolve(path))
      ? realpathSync(resolve(path)) : resolve(path)),
    selectedRepositories: () => [],
    now: () => new Date().toISOString(),
    fail: (message) => { throw new Error(message); }
  });
  mkdirSync(join(project, "tests", "fixtures", "coverage"), { recursive: true });
  writeFileSync(join(project, "tests", "fixtures", "coverage", "expected.info"), "fixture\n");
  git(["add", "tests"]);
  git(["commit", "-qm", "fixture"]);
  mkdirSync(join(project, "coverage"), { recursive: true });
  writeFileSync(join(project, "coverage", "lcov.info"), "generated\n");
  const manifest = stateRuntime.workspaceManifest(
    realpathSync(project), "still-copies", true);
  check(() => assert.ok("tests/fixtures/coverage/expected.info" in manifest,
    "a committed fixture under an excluded name belongs in the apply manifest"));
  check(() => assert.ok(!("coverage/lcov.info" in manifest),
    "untracked build output stays out of the apply manifest"));

  // A recorded workspace that no longer exists must surface as an instruction,
  // not as a raw ENOENT from the directory walk.
  stateRuntime.saveRuntime({
    id: "gone-workspace", status: "building",
    workspace: { mode: "copy", path: join(fixture, "deleted-sandbox") }
  });
  check(() => assert.throws(
    () => stateRuntime.singleRelevantSnapshot("gone-workspace"),
    /no longer exists/,
    "a missing workspace names the exit instead of stack-tracing"));

  // ---- capability forecast from a declared surface -----------------------
  // Policy infers capabilities from the surface a change has *already* touched,
  // so at change time it is correctly empty and uselessly so: the author signs a
  // contract that policy widens the moment a `.tsx` file is written, expiring
  // both the collected evidence and the review signature bound to it. These pin
  // the forecast that closes the gap — and that it never becomes enforcement.
  // The fixture has no hooks installed, so doctor legitimately exits non-zero.
  // The checks it printed are still the subject under test, so read stdout
  // either way rather than making these assertions depend on fixture hygiene.
  const checksFor = (id) => {
    let out;
    try {
      out = fm(["doctor", "--stage", "change", "--change", id, "--json"], project);
    } catch (error) {
      out = error.stdout;
    }
    return JSON.parse(out).checks;
  };
  const row = (rows, name) => rows.find((entry) => entry.name === name);

  fm(["new", "forecast fixture"], project);
  const withoutSurface = checksFor("forecast-fixture");
  check(() => assert.equal(row(withoutSurface, "surface-forecast"), undefined,
    "a change that declares no surface emits no forecast row at all"), "a change that declares no surface emits no forecast row");
  check(() => assert.match(row(withoutSurface, "policy-capabilities").detail,
    /none inferred from changed surface/,
    "declaring nothing leaves the existing policy check exactly as it was"), "declaring nothing leaves the policy check unchanged");

  fm(["resolve", "forecast-fixture", "--impact", "low", "--coupling", "isolated",
    "--acceptance-not-required", "--surface", "web/app/page.tsx,package.json"], project);
  const forecast = checksFor("forecast-fixture");

  // `web/app/page.tsx` is never written by this fixture. That is the whole
  // point: the capability a `.tsx` file pulls has to be knowable before the file
  // exists, or the forecast arrives exactly as late as the thing it replaces.
  check(() => assert.ok(!existsSync(join(project, "web", "app", "page.tsx")),
    "the forecast subject must not exist, or this proves nothing"), "the forecast subject does not exist");
  check(() => assert.match(row(forecast, "surface-forecast").detail,
    /accessibility \(from web\/app\/page\.tsx\)/,
    "a .tsx path that does not exist yet still forecasts accessibility, and names itself"), "a .tsx path that does not exist yet forecasts accessibility and names itself");
  check(() => assert.match(row(forecast, "surface-forecast").detail,
    /dependency-supply-chain \(from package\.json\)/,
    "a lockfile-class path forecasts its capability and names itself"), "a lockfile-class path forecasts its capability and names itself");

  // A forecast that could reduce required evidence would be worse than none.
  check(() => assert.match(row(forecast, "policy-capabilities").detail,
    /none inferred from changed surface/,
    "declaring a surface must not feed enforcement; policy still reads real changed files"), "declaring a surface does not feed enforcement");

  // The gap is a warning, never a failure: making it fail would be routed
  // around by declaring nothing, which costs more than it saves.
  const undeclared = row(forecast, "surface-forecast-undeclared");
  check(() => assert.equal(undeclared.level, "warn",
    "an undeclared forecast capability warns rather than erroring"), "an undeclared forecast capability warns rather than erroring");
  check(() => assert.match(undeclared.detail, /accessibility/,
    "the warning names the capability that has no provider"), "the warning names the capability that has no provider");

  // The review signature is bound to the contract, so a late capability does
  // not merely add a provider — it expires a signature a person already gave.
  fm(["resolve", "forecast-fixture", "--surface", "db/migrations/001.sql"], project);
  const reviewForecast = row(checksFor("forecast-fixture"), "surface-forecast-review");
  check(() => assert.match(reviewForecast.detail, /independent review from data-migration/,
    "a review-forcing capability is announced before a signature is spent"), "a review-forcing capability is announced before a signature is spent");
  check(() => assert.match(reviewForecast.detail, /reviewer diversity from data-migration/,
    "diversity is announced with it, since it is the expensive half"), "reviewer diversity is announced with it");

  // A change's own packet is not part of its surface, in either direction.
  fm(["resolve", "forecast-fixture", "--surface", "openspec/changes/forecast-fixture/ui.tsx"], project);
  check(() => assert.match(
    row(checksFor("forecast-fixture"), "surface-forecast").detail,
    /no capability inferred/,
    "paths inside the change packet pull nothing, exactly as they do when changed"), "paths inside the change packet pull nothing");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`workspace surface: ALL PASS (${assertions}/${assertions} assertions)`);
