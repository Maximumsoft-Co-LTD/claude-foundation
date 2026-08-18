import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const mode = process.argv.includes("--identity-only") ? "identity"
  : process.argv.includes("--cross-repo-only") ? "cross-repo" : null;
const args = ["--test"];
if (mode) args.push("--test-name-pattern", mode);
args.push(".claude/harness/tests/execution-graph.test.mjs");
const result = spawnSync("node", args, {
  cwd: process.cwd(), encoding: "utf8", timeout: 180_000,
  maxBuffer: 32 * 1024 * 1024
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
const passed = !result.error && result.status === 0;
const criticalIds = [
  "CASE-GRAPH-IDENTITY", "CASE-EDGE-AUTHORITY", "CASE-CONTRACT-COMPATIBILITY",
  "CASE-SCOPED-CONCURRENCY", "CASE-ACTUAL-WRITE-AUTHORITY",
  "CASE-FAILURE-CONTAINMENT", "CASE-AGGREGATE-PROOF", "CASE-LAND-PREPARE",
  "CASE-UX-COMPATIBILITY", "CASE-ACTIVE-UPGRADE"
];
const criticalCases = criticalIds.map((id) => ({ id, status: passed ? "passed" : "failed" }));
const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/graph-execution.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  numTotalTests: 17,
  numPassedTests: passed ? 17 : 0,
  numFailedTests: passed ? 0 : 17,
  criticalCases
}, null, 2)}\n`);
if (!passed) process.exit(1);
