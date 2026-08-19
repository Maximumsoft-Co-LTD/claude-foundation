import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const result = spawnSync("node", [
  "--test",
  ".claude/harness/tests/agent-dispatch.test.mjs",
  ".claude/harness/tests/execution-graph.test.mjs"
], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 300_000,
  maxBuffer: 32 * 1024 * 1024
});
const singleSource = spawnSync("node", [
  ".claude/tests/harness/run-single-source-tests.mjs"
], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 300_000,
  maxBuffer: 32 * 1024 * 1024
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.stdout.write(singleSource.stdout || "");
process.stderr.write(singleSource.stderr || "");
const nodeTestsPassed = !result.error && result.status === 0;
const singleSourcePassed = !singleSource.error && singleSource.status === 0;
const passed = nodeTestsPassed && singleSourcePassed;
const criticalCases = [
  "dispatch-parallel-bound",
  "dispatch-live-wait",
  "dispatch-acquire-before-packet"
].map((id) => ({ id, status: nodeTestsPassed ? "passed" : "failed" }));
criticalCases.push({
  id: "dispatch-command-single-source",
  status: singleSourcePassed ? "passed" : "failed"
});
const singleSourceTotal = Number(
  (singleSource.stdout || "").match(/ALL PASS \((\d+)\/\d+ assertions\)/)?.[1] || 0);
const total = 24 + singleSourceTotal;
const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/agent-dispatch.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  numTotalTests: total,
  numPassedTests: (nodeTestsPassed ? 24 : 0) +
    (singleSourcePassed ? singleSourceTotal : 0),
  numFailedTests: (nodeTestsPassed ? 0 : 24) +
    (singleSourcePassed ? 0 : singleSourceTotal || 1),
  criticalCases
}, null, 2)}\n`);
if (!passed) process.exit(1);
