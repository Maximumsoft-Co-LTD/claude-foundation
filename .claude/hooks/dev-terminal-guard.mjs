#!/usr/bin/env node

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
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

const HOST_PERMISSION_DENIAL = /(?:user (?:has )?(?:denied|rejected|declined)|tool use (?:was )?(?:denied|rejected)|permission to [^.\n]+ (?:was )?(?:denied|rejected)|permission request (?:was )?(?:denied|rejected)|(?:denied|rejected) (?:the )?permission request)/i;

function toolResultText(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return ""; }
}

export function latestHostPermissionBoundary(transcript) {
  let boundary = null;
  for (const line of String(transcript || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === "last-prompt" && typeof row.lastPrompt === "string" &&
        /^\/dev(?:\s|$)/.test(row.lastPrompt.trim())) {
      boundary = null;
      continue;
    }
    const results = Array.isArray(row.message?.content)
      ? row.message.content.filter((block) => block?.type === "tool_result") : [];
    for (const result of results) {
      const detail = [toolResultText(result.content), toolResultText(row.toolUseResult)]
        .filter(Boolean).join(" ");
      // Only the latest tool result is authoritative. A later successful
      // operation proves that the agent recovered from an earlier denial.
      boundary = HOST_PERMISSION_DENIAL.test(detail) ? {
        kind: "host-permission-denied"
      } : null;
    }
  }
  return boundary;
}

function pendingTerminalBoundary(changeId, hostBoundary, nextActionFor) {
  if (hostBoundary?.kind === "host-permission-denied") return {
    applies: true,
    complete: false,
    stopAllowed: true,
    status: "BOUNDARY",
    blockerKind: "host-permission-boundary",
    changeId,
    phase: "prove",
    action: "ASK_USER",
    actor: "user",
    boundary: "host-authority",
    reason: "the host denied permission for the pending operation"
  };
  let nextAction = null;
  try { nextAction = nextActionFor(changeId); } catch { return null; }
  if (!["WAIT", "ASK_USER"].includes(nextAction?.action)) return null;
  return {
    applies: true,
    complete: false,
    stopAllowed: true,
    status: "BOUNDARY",
    blockerKind: nextAction.action === "ASK_USER"
      ? "user-decision-boundary" : "external-wait-boundary",
    changeId,
    phase: nextAction.legacyAction === "WAIT_RESOURCE" ? "build" : "prove",
    action: nextAction.action,
    actor: nextAction.actor || null,
    boundary: nextAction.boundary || null,
    reason: nextAction.reason || null
  };
}

export function evaluateDevTerminal({
  prompt, activeIds, proofFor, currentHash, auditProof,
  nextActionFor = () => null, hostBoundary = null
}) {
  if (!prompt) return { applies: false, complete: true };
  if (/\s--plan-only(?:\s|$)/.test(prompt))
    return { applies: true, complete: true, status: "PLAN_COMPLETE" };
  if (activeIds.length !== 1) return {
    applies: true, complete: false, status: "INCOMPLETE",
    blockerKind: activeIds.length ? "ambiguous-active-change" : "missing-active-change",
    changeId: null, phase: activeIds.length ? "unknown" : "change",
    resumeAction: "Agent: invoke /dev --resume <change> after selecting exactly one active change."
  };
  const changeId = activeIds[0];
  const proof = proofFor(changeId);
  if (!proof || proof.status !== "pass") {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, stopAllowed: false,
      status: "INCOMPLETE", blockerKind: "proof-not-passing",
      changeId, phase: "prove",
      resumeAction: `Agent: invoke /dev --resume ${changeId}; continue the pending automatic lifecycle action.`
    };
  }
  const audit = auditProof(changeId);
  if (!audit.valid) {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-audit-failed",
      changeId, phase: "prove", resumeAction: `Agent: repair proof audit for ${changeId}, then run one fresh proof.`,
      detail: audit.reason
    };
  }
  const hash = currentHash(changeId);
  if (!hash || hash !== proof.workspaceHash) {
    const boundary = pendingTerminalBoundary(changeId, hostBoundary, nextActionFor);
    if (boundary) return boundary;
    return {
      applies: true, complete: false, status: "INCOMPLETE", blockerKind: "proof-stale",
      changeId, phase: "prove", resumeAction: `Agent: workspace changed after Prove; run one fresh proof for ${changeId}.`
    };
  }
  return { applies: true, complete: true, status: "PROVEN", changeId, phase: "prove" };
}

function runCli(root, ...args) {
  return spawnSync(process.execPath,
    [join(root, ".claude", "harness", "foundation.mjs"), ...args], {
      cwd: root, encoding: "utf8", timeout: 25000,
      env: {
        ...process.env,
        FOUNDATION_GUARDRAIL_MODE: "off",
        FOUNDATION_UPDATE_CHECK: "0"
      }
    });
}

function nextAction(root, id) {
  const child = runCli(root, "advance", id);
  if (child.status !== 0) return null;
  try { return JSON.parse(String(child.stdout || "").trim()); }
  catch { return null; }
}

function record(root, event, result) {
  try {
    const dir = join(root, ".foundation", "logs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const row = terminalVerdict(event, result);
    appendFileSync(join(dir, "dev-terminal.jsonl"), `${JSON.stringify({
      version: 1, at: new Date().toISOString(), sessionId: event.session_id || null,
      ...result
    })}\n`, { mode: 0o600 });
    const verdictDir = join(dir, "dev-terminal");
    mkdirSync(verdictDir, { recursive: true, mode: 0o700 });
    const session = String(event.session_id || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
    writeFileSync(join(verdictDir, `${session}.json`), `${JSON.stringify(row, null, 2)}\n`,
      { mode: 0o600 });
    writeFileSync(join(verdictDir, "latest.json"), `${JSON.stringify(row, null, 2)}\n`,
      { mode: 0o600 });
  } catch { /* terminal truth must not depend on telemetry storage */ }
}

export function terminalVerdict(event, result, at = new Date().toISOString()) {
  return {
    protocol: "foundation-dev-terminal-v1",
    at,
    sessionId: event.session_id || null,
    terminal: result.complete ? "complete" : "incomplete",
    ...result
  };
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
    hostBoundary: latestHostPermissionBoundary(transcript),
    proofFor: (id) => {
      const path = join(root, ".foundation", "receipts", id, "proof.json");
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
    },
    auditProof: (id) => {
      const child = runCli(root, "proof-audit", id);
      return { valid: child.status === 0,
        reason: String(child.stderr || child.stdout || "proof audit failed").trim() };
    },
    nextActionFor: (id) => nextAction(root, id),
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
  if (result.complete || result.stopAllowed) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `DEV_TERMINAL ${JSON.stringify(result)}. /dev still has an automatic action available. Execute the recorded agent resumeAction yourself; stop and report only when proof passes or the coordinator returns WAIT/ASK_USER.`
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
