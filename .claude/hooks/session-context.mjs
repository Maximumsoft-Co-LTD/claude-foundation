#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile || !input.session_id || !input.transcript_path) process.exit(0);
  appendFileSync(envFile,
    `export FOUNDATION_CLAUDE_SESSION_ID=${shellQuote(input.session_id)}\n` +
    `export FOUNDATION_CLAUDE_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}\n`);
} catch {
  // Telemetry context is best-effort and must never block a Claude session.
}
