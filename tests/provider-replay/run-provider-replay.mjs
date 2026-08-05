#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const requiredTags = [
  "roles", "system", "developer", "user-assistant-history", "unsupported-role-transform",
  "reasoning", "reasoning-signature", "redacted-reasoning", "missing-reasoning-resume",
  "one-tool", "parallel-tools", "interleaved-deltas", "partial-json", "empty-arguments", "malformed-arguments", "tool-error", "tool-result-text", "tool-result-file", "tool-result-image",
  "split-utf8", "unknown-optional-event", "duplicate-frame", "out-of-order-frame", "clean-end", "truncated-stream", "cancel-before-commit", "cancel-after-commit",
  "context-overflow", "maximum-output", "provider-truncation", "oversized-tool-result", "artifact-promotion",
  "cache-request", "cache-hit", "cache-write", "cache-read", "unsupported-cache", "accounting", "partial-usage", "quota-reset", "currency-source",
  "authentication", "permission", "invalid-request", "model-unavailable", "model-deprecated", "rate-limit", "timeout", "overload", "transport-failure", "provider-unknown",
  "multi-turn", "tool-replay", "reasoning-resume", "compaction-boundary", "interrupted-tool-terminal", "safe-precommit", "deny-after-output", "deny-after-mutation",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };

async function runOnce() {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json")));
  if (manifest.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.corpusVersion)) fail("unsupported manifest version");
  if (manifest.capturedAt !== null) fail("synthetic corpus must not claim a live capture time");
  if (manifest.liveDriftPolicy !== "scheduled-live-invariants-only") fail("recorded and live drift policy must remain separate");
  const ids = new Set();
  const coverage = new Map([["anthropic", new Set()], ["openai", new Set()]]);
  const equivalence = new Map();
  const transcript = [];
  for (const artifact of manifest.artifacts ?? []) {
    const bytes = await readFile(join(root, artifact.path));
    if (bytes.length !== artifact.byteCount || sha(bytes) !== artifact.sha256) fail(`artifact ${artifact.path}: content address mismatch`);
    transcript.push(artifact.path, artifact.sha256);
  }
  for (const entry of manifest.cases) {
    if (ids.has(entry.id)) fail(`duplicate case ${entry.id}`); ids.add(entry.id);
    if (entry.fixtureKind !== "synthetic") fail(`${entry.id}: recorded/live fixtures require the separate capture gate`);
    for (const [pathKey, hashKey] of [["requestPath", "requestSha256"], ["streamPath", "streamSha256"], ["expectedPath", "expectedSha256"]]) {
      const path = normalize(join(root, entry[pathKey]));
      if (!path.startsWith(`${normalize(root)}/`)) fail(`${entry.id}: path escapes corpus`);
      const bytes = await readFile(path);
      if (sha(bytes) !== entry[hashKey]) fail(`${entry.id}: ${pathKey} hash mismatch`);
      const text = bytes.toString("utf8");
      if (/(sk-[A-Za-z0-9]{16,}|Bearer\s+(?!<)|api[_-]?key["'=:\s]+[A-Za-z0-9]{12,})/i.test(text)) fail(`${entry.id}: possible secret`);
      transcript.push(entry.id, entry[hashKey]);
    }
    const request = JSON.parse(await readFile(join(root, entry.requestPath), "utf8"));
    if (JSON.stringify(request).toLowerCase().includes("authorization")) fail(`${entry.id}: authorization material persisted`);
    const lines = (await readFile(join(root, entry.streamPath), "utf8")).trim().split("\n").map(JSON.parse);
    lines.forEach((frame, index) => { if (frame.sequence !== index || typeof frame.wire !== "string") fail(`${entry.id}: invalid frame sequence`); });
    const expected = JSON.parse(await readFile(join(root, entry.expectedPath), "utf8"));
    if (expected.parser !== entry.provider || expected.terminal !== entry.expectedTerminalClassification || expected.equivalenceGroup !== entry.equivalenceGroup) fail(`${entry.id}: expectation metadata mismatch`);
    if (!Array.isArray(expected.exactEvents)) fail(`${entry.id}: exact normalized events absent`);
    entry.tags.forEach((tag) => coverage.get(entry.provider).add(tag));
    if (!equivalence.has(entry.equivalenceGroup)) equivalence.set(entry.equivalenceGroup, new Set());
    equivalence.get(entry.equivalenceGroup).add(entry.provider);
  }
  for (const [provider, tags] of coverage) for (const tag of requiredTags) if (!tags.has(tag)) fail(`${provider}: missing required tag ${tag}`);
  for (const [group, providers] of equivalence) if (providers.size !== 2) fail(`${group}: missing cross-provider equivalent`);
  return { digest: sha(transcript.join("\n")), cases: manifest.cases.length, groups: equivalence.size };
}

const first = await runOnce();
const second = await runOnce();
if (first.digest !== second.digest) fail("corpus replay is nondeterministic");
console.log(JSON.stringify({ status: "PASS", deterministicRuns: 2, ...first }));
