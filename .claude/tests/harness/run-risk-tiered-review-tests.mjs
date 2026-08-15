import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cases = [
  {
    id: "CASE-GROUNDING-V2",
    command: ["node", ".claude/harness/tests/grounding-policy.test.mjs"]
  },
  {
    id: "CASE-RISK-ROUTES",
    command: ["node", ".claude/tests/harness/run-v33-policy-tests.mjs"]
  },
  {
    id: "CASE-CODEX-PROVENANCE",
    command: ["node", ".claude/tests/harness/run-v33-policy-tests.mjs"]
  },
  {
    id: "CASE-SAME-FAMILY-REVIEW",
    command: ["node", ".claude/harness/tests/configured-reviewer.test.mjs"]
  },
  {
    id: "CASE-CRITICAL-EVIDENCE",
    command: ["node", ".claude/tests/harness/run-v33-policy-tests.mjs"]
  },
  {
    id: "CASE-PROOF-ONE-SHOT",
    command: ["node", ".claude/harness/tests/proof-advance-process.test.mjs"]
  },
  {
    id: "CASE-UPGRADE-COMPAT",
    command: ["sh", ".claude/tests/harness/run-upgrade-compat-tests.sh"]
  },
  {
    id: "CASE-EXTERNAL-HANDOFF",
    command: ["node", ".claude/harness/tests/handoff-policy.test.mjs"]
  },
  {
    id: "CASE-REVIEW-REPAIR-CLOSURE",
    command: ["node", ".claude/harness/tests/review-repair-closure.test.mjs"]
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
  ".foundation/test-results/v33-risk-tiered-review.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  numTotalTests: rows.length,
  numPassedTests: rows.filter((row) => row.status === "passed").length,
  numFailedTests: rows.filter((row) => row.status === "failed").length,
  criticalCases: rows
}, null, 2)}\n`);
if (rows.some((row) => row.status !== "passed")) process.exit(1);
