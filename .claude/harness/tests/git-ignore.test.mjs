// Real-Git regression for the one helper every Land comparison asks before
// treating a filesystem path as change content: a git-ignored file (a counter a
// tool rewrites on every run) is no change's work, in the root repository and
// in each nested repository under that repository's own rules — while a file
// that is tracked yet matches an ignore pattern is still content.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { gitIgnoredPaths, withoutGitIgnored } from "../runtime/core/git-ignore.mjs";

function git(args, cwd) {
  const result = spawnSync("git", [
    "-c", "user.name=Foundation Test", "-c", "user.email=foundation@example.invalid",
    "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main",
    "-c", "commit.gpgsign=false", ...args
  ], { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function scratch(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "foundation-git-ignore-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function repository(path, ignore, files = {}) {
  mkdirSync(path, { recursive: true });
  git(["init", "-q"], path);
  write(join(path, ".gitignore"), ignore);
  for (const [rel, content] of Object.entries(files)) write(join(path, rel), content);
  git(["add", "-A"], path);
  git(["commit", "-qm", "base"], path);
}

test("ignored untracked paths are reported; tracked paths matching a pattern are not", (t) => {
  const root = join(scratch(t), "repo");
  repository(root, ".autoharness-counter\nbuild/\n", { "src/app.js": "app\n" });
  // Committed before it was ignored: tracked content stays content.
  write(join(root, "legacy.counter"), "0\n");
  git(["add", "-f", "legacy.counter"], root);
  git(["commit", "-qm", "legacy"], root);
  write(join(root, ".gitignore"), ".autoharness-counter\nbuild/\n*.counter\n");
  write(join(root, ".autoharness-counter"), "7\n");

  const paths = [".autoharness-counter", "build/out.js", "legacy.counter", "src/app.js",
    "src/new.js"];
  assert.deepEqual([...gitIgnoredPaths(root, paths)].sort(),
    [".autoharness-counter", "build/out.js"]);
  assert.deepEqual(withoutGitIgnored(root, paths), ["legacy.counter", "src/app.js", "src/new.js"]);
});

test("an unanswerable question keeps every path compared", (t) => {
  const base = scratch(t);
  const plain = join(base, "plain");
  mkdirSync(plain);
  assert.deepEqual(withoutGitIgnored(plain, ["a.counter"]), ["a.counter"]);
  assert.deepEqual(withoutGitIgnored(join(base, "missing"), ["a"]), ["a"]);
  assert.deepEqual(withoutGitIgnored(plain, []), []);
});

test("each nested repository answers with its own ignore rules", (t) => {
  const base = scratch(t);
  const upstream = join(base, "sub-upstream");
  repository(upstream, ".autoharness-counter\n", { "handler.go": "package hook\n" });
  const root = join(base, "parent");
  repository(root, "/.foundation/\n", { "README.md": "parent\n" });
  git(["submodule", "add", "-q", upstream, "services/sub"], root);
  git(["commit", "-qm", "submodule"], root);
  const sub = join(root, "services", "sub");

  // The superproject never ignores the submodule's counter, and asking it about
  // a path inside the submodule must not fail the rest of the batch.
  assert.deepEqual([...gitIgnoredPaths(root, ["services/sub/.autoharness-counter",
    ".foundation/x"])], [".foundation/x"]);
  assert.deepEqual([...gitIgnoredPaths(sub, [".autoharness-counter", "handler.go"],
    { ownRepository: true })], [".autoharness-counter"]);

  // An uninitialized submodule is an empty directory: its rules are unknown,
  // and the superproject's must not answer for it.
  const empty = join(root, "services", "empty");
  mkdirSync(empty, { recursive: true });
  write(join(root, ".gitignore"), "/.foundation/\n*.counter\n");
  assert.deepEqual([...gitIgnoredPaths(empty, ["a.counter"], { ownRepository: true })], []);
  assert.deepEqual([...gitIgnoredPaths(empty, ["a.counter"])], ["a.counter"]);
});
