// cli.sh project-root resolution from inside a Build sandbox copy.
// Walking past a sandbox to the project that owns it is the ordinary Build
// case and must stay silent; a warning is reserved for a resolved root that is
// not the copy's owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = join(ROOT, "cli.sh");
const API = /EXPECTED_RUNTIME_API=(\d+)/.exec(readFileSync(CLI, "utf8"))[1];

function project(dir) {
  mkdirSync(join(dir, "openspec"), { recursive: true });
  mkdirSync(join(dir, ".claude", "harness"), { recursive: true });
  writeFileSync(join(dir, "openspec", "config.yaml"), "schema: rapid\n");
  writeFileSync(join(dir, ".claude", "harness", "foundation.mjs"),
    `if (process.argv[2] === "api-version") console.log("${API}");\n` +
    `else console.log("root=" + process.cwd());\n`);
}

function run(cwd) {
  const env = { ...process.env, FOUNDATION_UPDATE_CHECK: "0" };
  delete env.CLAUDE_FOUNDATION_PROJECT;
  return spawnSync("bash", [CLI, "changes"], { cwd, env, encoding: "utf8" });
}

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "cli-root-")));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

for (const kind of ["sandboxes", "repository-sandboxes"]) {
  test(`walking past an owned ${kind} copy resolves the owner silently`, () => {
    const owner = join(tmp, `owner-${kind}`);
    project(owner);
    const copy = join(owner, ".foundation", kind, "change-a");
    project(copy);
    mkdirSync(join(copy, "src"), { recursive: true });
    const result = run(join(copy, "src"));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `root=${owner}`);
    assert.doesNotMatch(result.stderr, /sandbox copy/);
  });
}

test("the real project root never mentions an existing sandbox copy", () => {
  const owner = join(tmp, "plain");
  project(owner);
  project(join(owner, ".foundation", "sandboxes", "change-b"));
  const result = run(owner);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `root=${owner}`);
  assert.equal(result.stderr, "");
});

test("a resolved root that does not own the copy still warns", () => {
  const outer = join(tmp, "outer");
  project(outer);
  // The copy's owner directory lacks project markers, so resolution lands on
  // an unrelated enclosing project: ambiguous, and worth saying so.
  const copy = join(outer, "detached", ".foundation", "sandboxes", "change-c");
  project(copy);
  const result = run(copy);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `root=${outer}`);
  assert.match(result.stderr, /ignoring sandbox copy at .*change-c; resolved project root .* is not its owner/);
});
