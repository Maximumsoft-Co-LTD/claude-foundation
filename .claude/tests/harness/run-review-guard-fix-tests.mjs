// Evidence runner for the Model Router V1 harness-defect fixes. Each critical
// case maps to the deterministic suite that pins its defect; identical
// commands execute once.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cases = [
  {
    id: "CASE-RECEIPT-RECONCILE",
    command: ["node", ".claude/harness/tests/review-guard-reconciliation.test.mjs"]
  },
  {
    id: "CASE-SCHEMA-PORTABLE",
    command: ["node", ".claude/harness/tests/configured-reviewer.test.mjs"]
  },
  {
    id: "CASE-INFRA-RESET",
    command: ["node", ".claude/harness/tests/review-guard-reconciliation.test.mjs"]
  },
  {
    id: "CASE-APPLY-REFRESH",
    command: ["node", ".claude/tests/harness/run-guard-fix-cli-tests.mjs"]
  },
  {
    id: "CASE-VALIDATE-SPEC-LINT",
    command: ["node", ".claude/tests/harness/run-guard-fix-cli-tests.mjs"]
  },
  {
    id: "CASE-GROUNDING-PORTABILITY",
    command: ["node", ".claude/harness/tests/sandbox-grounding-portability.test.mjs"]
  }
];

const executions = new Map();
const rows = [];
for (const testCase of cases) {
  const key = JSON.stringify(testCase.command);
  if (!executions.has(key)) {
    const [command, ...args] = testCase.command;
    executions.set(key, spawnSync(command, args, {
      cwd: process.cwd(), encoding: "utf8", timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024
    }));
  }
  const result = executions.get(key);
  const status = !result.error && result.status === 0 ? "passed" : "failed";
  rows.push({ id: testCase.id, status });
  process.stdout.write(`${status === "passed" ? "PASS" : "FAIL"}: ${testCase.id}\n`);
  if (status === "failed")
    process.stderr.write(String(result.stderr || result.stdout || result.error?.message || "failed"));
}

const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/review-guard-fix.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  numTotalTests: rows.length,
  numPassedTests: rows.filter((row) => row.status === "passed").length,
  numFailedTests: rows.filter((row) => row.status === "failed").length,
  criticalCases: rows
}, null, 2)}\n`);
if (rows.some((row) => row.status !== "passed")) process.exit(1);
