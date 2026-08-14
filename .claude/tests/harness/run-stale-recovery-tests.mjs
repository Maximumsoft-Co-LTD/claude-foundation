// Staleness refusals carry their own recovery order.
//
// The defect this pins: "proof is stale" and "authority request is stale"
// stated the refusal and nothing else, so a consumer round replayed the
// edit→prove→attest loop four times in eight minutes. The refusal itself now
// names the order — content first, one fresh prove, attestations last — and
// the command that resumes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "..");

function project() {
  const root = mkdtempSync(join(tmpdir(), "stale-recovery-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "openspec"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "harness"), join(root, ".claude", "harness"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "commands"), join(root, ".claude", "commands"), { recursive: true });
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

function proven({ review = false } = {}) {
  const fixture = project();
  cli(fixture, "new", "Stale probe", "--rapid");
  cli(fixture, "resolve", "stale-probe", "--impact", "low", "--coupling", "isolated",
    ...(review ? ["--review"] : []));
  cli(fixture, "sandbox", "create", "stale-probe");
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", "stale-probe.json"), "utf8"));
  const ledger = join(runtime.workspace.path, "openspec", "changes", "stale-probe", "tasks.md");
  writeFileSync(ledger, readFileSync(ledger, "utf8").replaceAll("- [ ]", "- [x]"));
  cli(fixture, "receipt", "stale-probe", "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", "app.txt");
  cli(fixture, "receipt", "stale-probe", "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", "app.txt");
  cli(fixture, "prove", "stale-probe");
  return { fixture, workspacePath: runtime.workspace.path };
}

test("a fresh proof carries no recovery hint", () => {
  const { fixture } = proven();
  const result = cli(fixture, "land-check", "stale-probe");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LAND READY stale-probe/);
  assert.doesNotMatch(result.stdout + result.stderr, /finish contract and code edits/);
});

test("a stale proof names the recovery order and the prove command", () => {
  const { fixture, workspacePath } = proven();
  appendFileSync(join(workspacePath, "app.txt"), "post-prove edit\n");
  const result = cli(fixture, "land-check", "stale-probe");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /proof is stale \(/);
  assert.match(result.stderr,
    /finish contract and code edits first, sync, then run one fresh prove: claude-foundation proof run stale-probe/);
});

test("a stale authority request says attest last and how to re-request", () => {
  const { fixture, workspacePath } = proven({ review: true });
  const requested = cli(fixture, "authority-request", "stale-probe", "--type", "review");
  assert.equal(requested.status, 0, requested.stderr);
  const requestId = JSON.parse(requested.stdout).requestId;
  appendFileSync(join(workspacePath, "app.txt"), "post-request edit\n");
  const result = cli(fixture, "authority-record", "stale-probe",
    "--request", requestId, "--response", join(fixture.root, "missing-response.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`authority request '${requestId}' is stale`));
  assert.match(result.stderr,
    /request review and acceptance last, after the workspace stops changing, then re-request: claude-foundation authority request stale-probe --type review/);
});
