import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const harness = join(dirname(fileURLToPath(import.meta.url)), "..");

// The shipped plugin is installed as a .js file; load a .mjs copy so Node
// treats it as ESM without a package.json.
async function loadPlugin(directory) {
  const copy = join(directory, "plugin.mjs");
  copyFileSync(join(harness, "adapters", "opencode-plugin.js"), copy);
  const { FoundationGuard } = await import(pathToFileURL(copy).href);
  return FoundationGuard({ directory, worktree: directory });
}

test("opencode plugin exports the session id to shell commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-plugin-"));
  try {
    const hooks = await loadPlugin(directory);
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "ses_abc", callID: "c1" },
      { args: { command: "true" } });
    const output = { env: {} };
    await hooks["shell.env"]({ cwd: directory, sessionID: "ses_abc" }, output);
    assert.equal(output.env.FOUNDATION_SESSION_ID, "ses_abc");
    const noSession = { env: {} };
    await hooks["shell.env"]({ cwd: directory }, noSession);
    assert.equal(noSession.env.FOUNDATION_SESSION_ID, "ses_abc",
      "falls back to the last session seen by a tool call");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opencode plugin leaves the environment alone without a session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-plugin-"));
  try {
    const hooks = await loadPlugin(directory);
    const output = { env: {} };
    await hooks["shell.env"]({ cwd: directory }, output);
    assert.equal("FOUNDATION_SESSION_ID" in output.env, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
