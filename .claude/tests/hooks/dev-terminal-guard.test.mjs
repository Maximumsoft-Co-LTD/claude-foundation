import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  devPrompt, evaluateDevTerminal, terminalVerdict, transcriptWallMs
} from "../../hooks/dev-terminal-guard.mjs";

const promptRows = (value) => [
  JSON.stringify({ type: "last-prompt", lastPrompt: value }),
  "{partial"
].join("\n");

test("terminal guard recognizes only the active dev command", () => {
  assert.equal(devPrompt(promptRows("/dev --yes build it")), "/dev --yes build it");
  assert.equal(devPrompt(promptRows("explain /dev")), "");
  assert.equal(devPrompt([
    JSON.stringify({ type: "last-prompt", lastPrompt: "/dev --yes build it" }),
    JSON.stringify({ type: "last-prompt", lastPrompt: "are you done?" })
  ].join("\n")), "/dev --yes build it");
});

test("terminal status measures wall time from the first transcript timestamp", () => {
  assert.equal(transcriptWallMs([
    "{partial",
    JSON.stringify({ timestamp: "2026-08-27T10:00:00.000Z" })
  ].join("\n"), Date.parse("2026-08-27T10:00:01.250Z")), 1250);
  assert.equal(transcriptWallMs("{}", 1), null);
});

test("dev cannot complete without exactly one passing fresh audited proof", () => {
  const base = {
    prompt: "/dev --yes build it", activeIds: ["demo"],
    proofFor: () => ({ status: "pass", workspaceHash: "same" }),
    currentHash: () => "same", auditProof: () => ({ valid: true })
  };
  assert.equal(evaluateDevTerminal(base).status, "PROVEN");
  const missing = evaluateDevTerminal({ ...base, activeIds: [] });
  assert.equal(missing.blockerKind, "missing-active-change");
  assert.match(missing.resumeAction, /^Agent: invoke \/dev --resume/);
  assert.equal(evaluateDevTerminal({ ...base, proofFor: () => null }).blockerKind,
    "proof-not-passing");
  assert.equal(evaluateDevTerminal({ ...base,
    auditProof: () => ({ valid: false, reason: "bad" }) }).blockerKind,
  "proof-audit-failed");
  assert.equal(evaluateDevTerminal({ ...base, currentHash: () => "changed" }).blockerKind,
    "proof-stale");
  assert.equal(evaluateDevTerminal({ ...base,
    prompt: "/dev --plan-only sketch it" }).status, "PLAN_COMPLETE");
});

test("terminal verdict remains canonical when the host later returns a success envelope", () => {
  const row = terminalVerdict({ session_id: "session-1" }, {
    applies: true, complete: false, status: "INCOMPLETE",
    blockerKind: "proof-not-passing", changeId: "demo"
  }, "2026-08-28T00:00:00.000Z");
  assert.equal(row.protocol, "foundation-dev-terminal-v1");
  assert.equal(row.terminal, "incomplete");
  assert.equal(row.sessionId, "session-1");
});

test("Stop hook persists an incomplete verdict before asking the host to continue", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-terminal-guard-"));
  const transcript = join(root, "transcript.jsonl");
  try {
    mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({
      type: "last-prompt", lastPrompt: "/dev --yes build it"
    })}\n`);
    const hook = fileURLToPath(new URL("../../hooks/dev-terminal-guard.mjs", import.meta.url));
    const child = spawnSync(process.execPath, [hook], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "live-session", transcript_path: transcript }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(child.status, 0);
    assert.match(child.stdout, /"decision":"block"/);
    assert.match(child.stdout, /Execute the recorded agent resumeAction yourself/);
    assert.doesNotMatch(child.stdout, /Run \/dev/);
    const verdict = JSON.parse(readFileSync(join(root, ".foundation", "logs",
      "dev-terminal", "live-session.json"), "utf8"));
    assert.equal(verdict.protocol, "foundation-dev-terminal-v1");
    assert.equal(verdict.terminal, "incomplete");
    assert.equal(verdict.blockerKind, "proof-not-passing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
