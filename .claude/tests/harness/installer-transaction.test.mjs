import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync, symlinkSync, readlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const path of [".claude", ".foundation", ".claude/harness/runtime",
  ".claude/settings.json", "CLAUDE.md", "openspec/schemas", ".claude/retired/file"])
test(`install preflight preserves external symlink and all prior files: ${path}`, (t) => {
  const temp = mkdtempSync(join(tmpdir(), "installer-containment-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const target = join(temp, "consumer"), external = join(temp, "external");
  mkdirSync(external); mkdirSync(target);
  writeFileSync(join(external, "sentinel"), "preserve\n");
  const file = path.endsWith(".json") || path.endsWith(".md");
  const referent = file ? join(external, "sentinel") : external;
  mkdirSync(dirname(join(target, path)), { recursive: true });
  symlinkSync(referent, join(target, path));
  if (path.startsWith(".claude/retired")) {
    mkdirSync(join(target, ".foundation"));
    writeFileSync(join(target, ".foundation/install-manifest.txt"), `${path}/sentinel\n`);
  }
  const result = spawnSync("bash", [join(source, "install.sh"), target, "--yes"], {
    encoding: "utf8", env: { ...process.env, FOUNDATION_UPDATE_CHECK: "0" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink.*install|install.*symlink/i);
  assert.equal(readlinkSync(join(target, path)), referent);
  assert.equal(readFileSync(join(external, "sentinel"), "utf8"), "preserve\n");
  assert.equal(existsSync(join(target, "WORKFLOW.md")), false, "no partial installation");
  assert.equal(existsSync(join(external, "harness")), false);
});

for (const [script, path] of [["install-codex.sh", ".agents"],
  ["install-codex.sh", "codex-home/prompts"], ["install-cursor.sh", ".cursor"],
  ["install-opencode.sh", ".opencode"]])
test(`adapter preflights before shared installation: ${script} ${path}`, (t) => {
  const temp = mkdtempSync(join(tmpdir(), "adapter-containment-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const target = join(temp, "consumer"), external = join(temp, "external");
  mkdirSync(target); mkdirSync(external);
  mkdirSync(dirname(join(target, path)), { recursive: true });
  symlinkSync(external, join(target, path));
  const result = spawnSync("bash", [join(source, script), target, "--yes"], {
    encoding: "utf8", env: { ...process.env, FOUNDATION_UPDATE_CHECK: "0",
      CODEX_HOME: join(target, "codex-home") }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink.*install|install.*symlink/i);
  assert.equal(existsSync(join(target, "WORKFLOW.md")), false);
  assert.equal(readlinkSync(join(target, path)), external);
});

test("failed doctor restores retired files and the previous ownership manifest", () => {
  const temp = mkdtempSync(join(tmpdir(), "installer-rollback-"));
  try {
    const bin = join(temp, "bin"), target = join(temp, "consumer");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), '#!/bin/sh\ncase "$1" in *foundation.mjs) exit 1;; *) exit 0;; esac\n');
    chmodSync(join(bin, "node"), 0o755);
    const originals = {
      ".claude/agents/pm.md": "legacy agent\n",
      ".workflow/_templates/user-note.md": "legacy template\n",
      ".claude/retired.txt": "old managed file\n",
      ".foundation/install-manifest.txt": ".claude/retired.txt\n"
    };
    for (const [path, content] of Object.entries(originals)) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), content);
    }
    const result = spawnSync("bash", [join(source, "install.sh"), target, "--yes"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FOUNDATION_UPDATE_CHECK: "0" }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /post-install doctor failed/);
    for (const [path, content] of Object.entries(originals))
      assert.equal(readFileSync(join(target, path), "utf8"), content, path);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("every installer dry-run leaves a nonexistent target absent", () => {
  const temp = mkdtempSync(join(tmpdir(), "installer-dry-"));
  try {
    for (const script of ["install.sh", "install-codex.sh", "install-cursor.sh", "install-opencode.sh"]) {
      const target = join(temp, script, "absent");
      const result = spawnSync("bash", [join(source, script), target, "--dry-run"], { encoding: "utf8" });
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
      assert.equal(existsSync(target), false, script);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
