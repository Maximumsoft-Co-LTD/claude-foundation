#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: analyze-results.mjs <run-root>");
const resultsRoot = join(root, "results");
const ids = readdirSync(resultsRoot).filter((name) =>
  statSync(join(resultsRoot, name)).isDirectory()).sort();

function text(path, fallback = "") {
  try { return readFileSync(path, "utf8"); } catch { return fallback; }
}
function finalEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.at(-1) || {} : parsed;
  } catch { return {}; }
}
function claimedVerdict(result) {
  const match = String(result || "").match(
    /(?:^|\n)(?:#+\s*)?VERDICT(?:\s*:\s*|\s*\n+\s*)(?:\*\*)?(PASS|FAIL_FIXED|FAIL_UNFIXED|INCONCLUSIVE)\b/i);
  return match?.[1]?.toUpperCase() || "UNPARSED";
}

let totalCost = 0;
const rows = ids.map((id) => {
  const dir = join(resultsRoot, id);
  const envelope = finalEnvelope(text(join(dir, "claude.json")));
  const cost = Number(envelope.total_cost_usd || 0);
  totalCost += cost;
  const rc = Number(text(join(dir, "exit-code.txt"), "-1").trim());
  const patchBytes = text(join(dir, "sandbox.patch")).length;
  const status = envelope.subtype || (envelope.is_error ? "error" : "unknown");
  const verdict = claimedVerdict(envelope.result);
  const evidence = rc === 0 && status === "success" && verdict !== "UNPARSED"
    ? verdict : "INCONCLUSIVE";
  return { id, status, rc, cost, duration: Number(envelope.duration_ms || 0), verdict, evidence, patchBytes };
});

const lines = [
  "# Claude diagnostic probe summary",
  "",
  `- Source: ${text(join(root, "source-head.txt")).trim()}`,
  `- Claude: ${text(join(root, "claude-version.txt")).trim()}`,
  `- Sessions: ${rows.length}`,
  `- Total cost: $${totalCost.toFixed(2)}`,
  "",
  "Model verdicts below are triage only. A defect becomes confirmed only after its reproduction is rerun independently against the source checkout.",
  "",
  "| Scenario | CLI | rc | Cost | Duration | Claimed | Triage | Patch |",
  "|---|---:|---:|---:|---:|---|---|---:|",
  ...rows.map((row) => `| ${row.id} | ${row.status} | ${row.rc} | $${row.cost.toFixed(2)} | ${(row.duration / 1000).toFixed(1)}s | ${row.verdict} | ${row.evidence} | ${row.patchBytes} B |`),
  ""
];
writeFileSync(join(root, "summary.md"), `${lines.join("\n")}\n`);
process.stdout.write(`${lines.join("\n")}\n`);
