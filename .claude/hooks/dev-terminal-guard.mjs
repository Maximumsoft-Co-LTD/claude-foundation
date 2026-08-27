#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export function devPrompt(transcript) {
  let prompt = "";
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.type === "last-prompt" && typeof row.lastPrompt === "string" &&
          /^\/dev(?:\s|$)/.test(row.lastPrompt.trim()))
        prompt = row.lastPrompt.trim();
    } catch { /* tolerate a partially flushed final line */ }
  }
  return prompt;
}

export function transcriptWallMs(transcript, nowMs = Date.now()) {
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const started = Date.parse(JSON.parse(line).timestamp || "");
      if (Number.isFinite(started)) return Math.max(0, nowMs - started);
    } catch { /* keep looking for the first timestamped row */ }
  }
  return null;
}

export function evaluateDevTerminal({ prompt, activeIds, proofFor, currentHash, auditProof }) {
  if (!prompt) return { applies: false, complete: true };
  if (/\s--plan-only(?:\s|$)/.test(prompt))
    return { applies: true, complete: true, status: "PLAN_COMPLETE" };
  if (activeIds.length !== 1) return {
    applies: true, complete: false, status: "INCOMPLETE",
    blockerKind: activeIds.length ? "ambiguous-active-change" : "missing-active-change",
    changeId: null, phase: activeIds.length ? "unknown" : "change",
    resumeAction: "Run /dev --resume <change> after selecting exactly one active change."
  };
  const changeId = activeIds[0];
  const proof = proofFor(changeId);
  if (!proof || proof.status !== "pass") return {
    applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-not-passing",
    changeId, phase: "prove", resumeAction: `Run /dev --resume ${changeId}; do not end while reviewer or evidence work is pending.`
  };
  const audit = auditProof(changeId);
  if (!audit.valid) return {
    applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-audit-failed",
    changeId, phase: "prove", resumeAction: `Repair proof audit for ${changeId}, then run one fresh proof.`,
    detail: audit.reason
  };
  const hash = currentHash(changeId);
  if (!hash || hash !== proof.workspaceHash) return {
    applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-stale",
    changeId, phase: "prove", resumeAction: `Workspace changed after Prove; run one fresh proof for ${changeId}.`
  };
  return { applies: true, complete: true, status: "PROVEN", changeId, phase: "prove" };
}

function runCli(root, ...args) {
  return spawnSync(process.execPath,
    [join(root, ".claude", "harness", "foundation.mjs"), ...args], {
      cwd: root, encoding: "utf8", timeout: 25000,
      env: { ...process.env, FOUNDATION_GUARDRAIL_MODE: "off" }
    });
}

function record(root, event, result) {
  try {
    const dir = join(root, ".foundation", "logs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "dev-terminal.jsonl"), `${JSON.stringify({
      version: 1, at: new Date().toISOString(), sessionId: event.session_id || null,
      ...result
    })}\n`, { mode: 0o600 });
  } catch { /* terminal truth must not depend on telemetry storage */ }
}

async function main() {
  let event = {};
  try { event = JSON.parse(readFileSync(0, "utf8")); } catch { return; }
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const transcriptPath = String(event.transcript_path || "");
  if (!transcriptPath || !existsSync(transcriptPath)) return;
  const transcript = readFileSync(transcriptPath, "utf8");
  const prompt = devPrompt(transcript);
  if (!prompt) return;
  const changes = join(root, "openspec", "changes");
  const activeIds = existsSync(changes) ? readdirSync(changes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name).sort() : [];
  const evaluated = evaluateDevTerminal({
    prompt,
    activeIds,
    proofFor: (id) => {
      const path = join(root, ".foundation", "receipts", id, "proof.json");
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
    },
    auditProof: (id) => {
      const child = runCli(root, "proof-audit", id);
      return { valid: child.status === 0,
        reason: String(child.stderr || child.stdout || "proof audit failed").trim() };
    },
    currentHash: (id) => {
      const child = runCli(root, "hash", id);
      return child.status === 0 ? String(child.stdout || "").trim().split("\n").at(-1) : "";
    }
  });
  const result = {
    ...evaluated,
    wallMs: transcriptWallMs(transcript),
    cost: null,
    costStatus: "provider-envelope-not-final-until-stop"
  };
  record(root, event, result);
  if (result.complete) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `DEV_TERMINAL ${JSON.stringify(result)}. /dev is incomplete regardless of model prose. Continue the recorded resumeAction and stop only after a fresh passing proof.`
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
