#!/usr/bin/env node

// A /dev Change is authored from generated artifacts and validator recovery.
// Reading managed implementation to rediscover that contract creates an
// unmetered pre-change loop, so deny those reads before they enter context.

import { existsSync, openSync, closeSync, readFileSync, readSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { devPrompt } from "./dev-terminal-guard.mjs";

const MANAGED_IMPLEMENTATION = /(?:^|[\\/\s'"=])\.claude[\\/](?:harness[\\/]runtime|hooks)(?:[\\/]|$)/i;

export function authoringSurfaceViolation(tool, input = {}) {
  if (tool === "Read") return MANAGED_IMPLEMENTATION.test(String(input.file_path || ""));
  if (tool === "Grep") return [input.path, input.glob]
    .some((value) => MANAGED_IMPLEMENTATION.test(String(value || "")));
  if (tool === "Bash") return MANAGED_IMPLEMENTATION.test(String(input.command || ""));
  return false;
}

export function transcriptStartsDev(path) {
  if (!path || !existsSync(path)) return false;
  let descriptor = null;
  try {
    const bytes = Math.min(statSync(path).size, 512 * 1024);
    const buffer = Buffer.alloc(bytes);
    descriptor = openSync(path, "r");
    const read = readSync(descriptor, buffer, 0, bytes, 0);
    return Boolean(devPrompt(buffer.subarray(0, read).toString("utf8")));
  } catch { return false; }
  finally { if (descriptor !== null) closeSync(descriptor); }
}

async function main() {
  let event = {};
  try { event = JSON.parse(readFileSync(0, "utf8")); } catch { return; }
  const transcript = String(event.transcript_path ||
    process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH || "");
  if (!transcriptStartsDev(transcript)) return;
  if (!authoringSurfaceViolation(String(event.tool_name || ""), event.tool_input || {})) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: "BLOCKED: /dev authoring uses generated openspec/changes artifacts, change validate recovery, and public operator references. Managed .claude/harness/runtime and .claude/hooks are implementation, not the authoring contract. No managed source was read. Create the Change early with `claude-foundation change new \"<intent>\"`; if generated artifacts or validation are insufficient, report a harness defect."
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
