import assert from "node:assert/strict";
import test from "node:test";

import {
  devPrompt, evaluateDevTerminal, transcriptWallMs
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
  assert.equal(evaluateDevTerminal({ ...base, activeIds: [] }).blockerKind,
    "missing-active-change");
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
