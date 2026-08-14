// Default-branch visibility at Land, and the doctor escalation for the
// unwired no-direct-main hook.
//
// The defect this pins: every land guard was commit-based, so both
// repositories of a consumer round landed directly on main with nothing
// saying so. The branch read is warnings-only — a failed read must never
// change what lands.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "..");

function project() {
  const root = mkdtempSync(join(tmpdir(), "branch-warning-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "openspec"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "harness"), join(root, ".claude", "harness"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "commands"), join(root, ".claude", "commands"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "hooks"), join(root, ".claude", "hooks"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "settings.json"), join(root, ".claude", "settings.json"));
  cpSync(join(SOURCE, "openspec", "schemas"), join(root, "openspec", "schemas"), { recursive: true });
  cpSync(join(SOURCE, "openspec", "config.yaml"), join(root, "openspec", "config.yaml"));
  writeFileSync(join(root, "app.txt"), "initial\n");
  const bin = join(root, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "openspec"), [
    "#!/usr/bin/env sh",
    'if [ "${1:-}" = "--version" ]; then echo "1.7.0"; exit 0; fi',
    "exit 0"
  ].join("\n"));
  chmodSync(join(bin, "openspec"), 0o755);
  return { root, bin };
}

function cli(projectValue, ...args) {
  return spawnSync("node", [join(projectValue.root, ".claude", "harness", "foundation.mjs"), ...args], {
    cwd: projectValue.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${projectValue.bin}:${process.env.PATH}`,
      FOUNDATION_CLAUDE_TRANSCRIPT_PATH: "",
      FOUNDATION_CLAUDE_SESSION_ID: "",
      FOUNDATION_RUN_ID: "",
      FOUNDATION_SESSION_ID: "",
      CODEX_THREAD_ID: "",
      CLAUDE_FOUNDATION_PROJECT: projectValue.root
    }
  });
}

const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Git fixture proven up to LAND READY, so land-check output is assertable.
function provenOn(branch) {
  const fixture = project();
  git(fixture.root, "init", "-q", "-b", branch);
  git(fixture.root, "config", "user.name", "Foundation Test");
  git(fixture.root, "config", "user.email", "foundation@example.invalid");
  git(fixture.root, "add", "-A");
  git(fixture.root, "commit", "-qm", "fixture");
  cli(fixture, "new", "Branch probe", "--rapid");
  cli(fixture, "resolve", "branch-probe", "--impact", "low", "--coupling", "isolated");
  cli(fixture, "sandbox", "create", "branch-probe");
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", "branch-probe.json"), "utf8"));
  const ledger = join(runtime.workspace.path, "openspec", "changes", "branch-probe", "tasks.md");
  writeFileSync(ledger, readFileSync(ledger, "utf8").replaceAll("- [ ]", "- [x]"));
  cli(fixture, "receipt", "branch-probe", "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", "app.txt");
  cli(fixture, "receipt", "branch-probe", "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", "app.txt");
  cli(fixture, "prove", "branch-probe");
  return fixture;
}

test("land check on main reports the branch line", () => {
  const fixture = provenOn("main");
  const result = cli(fixture, "land-check", "branch-probe");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LAND READY branch-probe/);
  assert.match(result.stdout, /branch: main \(default branch/);
});

test("land check on a feature branch stays silent", () => {
  const fixture = provenOn("feature-probe");
  const result = cli(fixture, "land-check", "branch-probe");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LAND READY branch-probe/);
  assert.doesNotMatch(result.stdout, /branch:/);
});

test("doctor warns while the no-direct-main hook is unwired", () => {
  const fixture = project();
  const result = cli(fixture, "doctor");
  assert.match(result.stdout, /WARN\s+no-direct-main: disabled \(opt-in policy\)/);
  assert.equal(result.status, 0,
    `warn must not change the doctor exit code: ${result.stdout}\n${result.stderr}`);
});
