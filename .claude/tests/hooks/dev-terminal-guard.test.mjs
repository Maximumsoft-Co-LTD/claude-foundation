import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  devPrompt, evaluateDevTerminal, latestHostPermissionBoundary,
  terminalVerdict, transcriptWallMs
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

test("terminal guard recognizes only the latest host permission result", () => {
  const prompt = JSON.stringify({ type: "last-prompt", lastPrompt: "/dev fix it" });
  const denied = JSON.stringify({
    type: "user",
    message: { content: [{
      type: "tool_result", is_error: true,
      content: "The user doesn't want to proceed with this tool use. The tool use was rejected."
    }] }
  });
  assert.deepEqual(latestHostPermissionBoundary(`${prompt}\n${denied}`), {
    kind: "host-permission-denied"
  }, "the boundary does not persist rejected tool content or the blocked command");
  const recovered = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", content: "completed" }] }
  });
  assert.equal(latestHostPermissionBoundary(`${prompt}\n${denied}\n${recovered}`), null,
    "a later successful tool result clears an earlier permission boundary");
  const ordinaryFailure = JSON.stringify({
    type: "user",
    message: { content: [{
      type: "tool_result", is_error: true,
      content: "tests failed: expected permission denied response"
    }] }
  });
  assert.equal(latestHostPermissionBoundary(`${prompt}\n${ordinaryFailure}`), null,
    "ordinary command output mentioning permission is not host authority");
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
  const automatic = evaluateDevTerminal({
    ...base,
    proofFor: () => null,
    nextActionFor: () => ({ action: "RUN_EXTERNAL", actor: "configured-reviewer" })
  });
  assert.equal(automatic.stopAllowed, false,
    "an available configured reviewer remains agent-owned work");
  const waiting = evaluateDevTerminal({
    ...base,
    proofFor: () => null,
    nextActionFor: () => ({
      action: "WAIT", legacyAction: "WAIT_EXTERNAL",
      actor: "external-authority", boundary: "external-authority",
      reason: "an external verdict is pending"
    })
  });
  assert.equal(waiting.status, "BOUNDARY");
  assert.equal(waiting.stopAllowed, true);
  assert.equal(waiting.complete, false,
    "a real wait may stop the session without claiming proof completion");
  const decision = evaluateDevTerminal({
    ...base,
    proofFor: () => null,
    nextActionFor: () => ({ action: "ASK_USER", boundary: "user-authority" })
  });
  assert.equal(decision.blockerKind, "user-decision-boundary");
  assert.equal(decision.stopAllowed, true);
  const denied = evaluateDevTerminal({
    ...base,
    proofFor: () => null,
    nextActionFor: () => ({ action: "REPAIR", actor: "agent" }),
    hostBoundary: { kind: "host-permission-denied" }
  });
  assert.equal(denied.blockerKind, "host-permission-boundary");
  assert.equal(denied.stopAllowed, true,
    "host authority must beat an otherwise automatic repair action");
  const staleDenied = evaluateDevTerminal({
    ...base,
    currentHash: () => "changed",
    nextActionFor: () => ({ action: "REPAIR", actor: "agent" }),
    hostBoundary: { kind: "host-permission-denied" }
  });
  assert.equal(staleDenied.blockerKind, "host-permission-boundary",
    "a stale passing receipt cannot hide the later permission stop");
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

test("Stop hook allows a real external review wait without marking proof complete", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-terminal-boundary-"));
  const transcript = join(root, "transcript.jsonl");
  try {
    mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
    mkdirSync(join(root, ".claude", "harness"), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({
      type: "last-prompt", lastPrompt: "/dev --resume demo"
    })}\n`);
    writeFileSync(join(root, ".claude", "harness", "foundation.mjs"),
      `if (process.argv[2] === "advance") process.stdout.write(JSON.stringify({\n` +
      `  action: "WAIT", legacyAction: "WAIT_EXTERNAL",\n` +
      `  actor: "external-authority", boundary: "external-authority",\n` +
      `  reason: "an external verdict is pending"\n` +
      `}));\n`);
    const hook = fileURLToPath(new URL("../../hooks/dev-terminal-guard.mjs", import.meta.url));
    const child = spawnSync(process.execPath, [hook], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "boundary-session", transcript_path: transcript }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, "",
      "a genuine WAIT boundary must not force the host to resume /dev");
    const verdict = JSON.parse(readFileSync(join(root, ".foundation", "logs",
      "dev-terminal", "boundary-session.json"), "utf8"));
    assert.equal(verdict.terminal, "incomplete");
    assert.equal(verdict.stopAllowed, true);
    assert.equal(verdict.blockerKind, "external-wait-boundary");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Stop hook allows a permission handoff instead of forcing another repair", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-terminal-permission-"));
  const transcript = join(root, "transcript.jsonl");
  try {
    mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
    mkdirSync(join(root, ".claude", "harness"), { recursive: true });
    writeFileSync(transcript, [
      JSON.stringify({ type: "last-prompt", lastPrompt: "/dev --resume demo" }),
      JSON.stringify({
        type: "user",
        message: { content: [{
          type: "tool_result", is_error: true,
          content: "The user doesn't want to proceed with this tool use. The tool use was rejected."
        }] }
      })
    ].join("\n"));
    writeFileSync(join(root, ".claude", "harness", "foundation.mjs"),
      `if (process.argv[2] === "advance") process.stdout.write(JSON.stringify({\n` +
      `  action: "REPAIR", actor: "agent", boundary: "resource",\n` +
      `  reason: "proof command needs permission"\n` +
      `}));\n`);
    const hook = fileURLToPath(new URL("../../hooks/dev-terminal-guard.mjs", import.meta.url));
    const child = spawnSync(process.execPath, [hook], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "permission-session", transcript_path: transcript }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, "",
      "a denied permission must not make the Stop hook retry the same command");
    const verdict = JSON.parse(readFileSync(join(root, ".foundation", "logs",
      "dev-terminal", "permission-session.json"), "utf8"));
    assert.equal(verdict.terminal, "incomplete");
    assert.equal(verdict.stopAllowed, true);
    assert.equal(verdict.blockerKind, "host-permission-boundary");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
