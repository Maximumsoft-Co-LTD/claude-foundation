import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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
