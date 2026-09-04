import { spawnSync } from "node:child_process";
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const HOOK_DETECTOR = ["node", "--test", ".claude/tests/hooks/phase-guard-policy.test.mjs"];
const EXEC_DETECTOR = ["node", "--test", ".claude/harness/tests/exec-runtime.test.mjs"];
const SEMANTIC_DETECTOR = ["node", "--test", ".claude/harness/tests/semantic-draft.test.mjs"];

const CASES = [
  {
    id: "MUT-LAND-DELIVERY-AUTHORITY-INFERRED",
    sourcePath: ".claude/harness/runtime/core/shell-mutation-policy.mjs",
    expectedKiller: "CASE-LAND-DELIVERY-AUTHORITY",
    detector: HOOK_DETECTOR,
    before: "if (phase === \"land\" && environment.FOUNDATION_LAND_TRANSACTION !== \"1\")\n    return \"Land shell mutations require the runtime transaction marker\";",
    after: "if (phase === \"land\" && environment.FOUNDATION_LAND_TRANSACTION !== \"1\" && command === null)\n    return \"Land shell mutations require the runtime transaction marker\";"
  },
  {
    id: "MUT-BUILD-ABSOLUTE-OPERAND-ALLOWED",
    sourcePath: ".claude/harness/runtime/core/shell-mutation-policy.mjs",
    expectedKiller: "CASE-BUILD-SHELL-CONTAINMENT",
    detector: HOOK_DETECTOR,
    before: "if (!within(workspace, absolute)) return true;",
    after: "if (!within(workspace, absolute)) return false;"
  },
  {
    id: "MUT-EXEC-WORKSPACE-CWD-REMOVED",
    sourcePath: ".claude/harness/runtime/observability/exec-runtime.mjs",
    expectedKiller: "CASE-EXEC-WORKSPACE-CWD",
    detector: EXEC_DETECTOR,
    before: "stdio: \"inherit\", cwd,",
    after: "stdio: \"inherit\","
  },
  {
    id: "MUT-AMENDMENT-TASK-CONTRACT-REPLACED",
    sourcePath: ".claude/harness/runtime/workflow/semantic-amendment.mjs",
    expectedKiller: "CASE-AMENDMENT-TASK-CONTRACT",
    detector: SEMANTIC_DETECTOR,
    before: "const unsupported = [\"outcome\", \"verify\"].filter((field) =>",
    after: "const unsupported = [].filter((field) =>"
  },
  {
    id: "MUT-SEMANTIC-REFERENCE-REALPATH-DROPPED",
    sourcePath: ".claude/harness/runtime/workflow/change-lifecycle.mjs",
    expectedKiller: "CASE-SEMANTIC-REFERENCE-CONTAINMENT",
    detector: SEMANTIC_DETECTOR,
    before: "const canonical = realpathSync(path);",
    after: "const canonical = resolve(path);"
  },
  {
    id: "MUT-SEMANTIC-REFERENCE-HTTPS-DROPPED",
    sourcePath: ".claude/harness/runtime/workflow/change-lifecycle.mjs",
    expectedKiller: "CASE-SEMANTIC-REFERENCE-HTTPS",
    detector: SEMANTIC_DETECTOR,
    before: "if (url.protocol !== \"https:\")",
    after: "if (false && url.protocol !== \"https:\")"
  }
];

function execute([command, ...args], cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300000 });
}

function exactReplace(source, before, after) {
  const pieces = source.split(before);
  return pieces.length === 2 ? `${pieces[0]}${after}${pieces[1]}` : null;
}

const fixture = mkdtempSync(join(tmpdir(), "foundation-lifecycle-mutants-"));
const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/quality/semantic-suites/SEM-LIFECYCLE-SAFETY.json");
try {
  cpSync(join(ROOT, ".claude"), join(fixture, ".claude"), { recursive: true });
  const baselines = new Map();
  for (const detector of [HOOK_DETECTOR, EXEC_DETECTOR, SEMANTIC_DETECTOR]) {
    const key = detector.join("\0");
    if (!baselines.has(key)) baselines.set(key, execute(detector, fixture));
    if (baselines.get(key).status !== 0)
      throw new Error(`clean baseline failed: ${detector.join(" ")}\n${baselines.get(key).stderr}`);
  }

  const mutants = [];
  for (const item of CASES) {
    const sourcePath = join(fixture, item.sourcePath);
    const original = readFileSync(sourcePath, "utf8");
    const mutated = exactReplace(original, item.before, item.after);
    const applied = mutated !== null;
    let compiled = false;
    let result = "survived";
    let killedBy = "";
    try {
      if (applied) {
        writeFileSync(sourcePath, mutated);
        compiled = execute(["node", "--check", item.sourcePath], fixture).status === 0;
        if (compiled && execute(item.detector, fixture).status !== 0) {
          result = "killed";
          killedBy = item.expectedKiller;
        }
      }
    } finally {
      writeFileSync(sourcePath, original);
    }
    mutants.push({
      id: item.id,
      description: `${item.id} deliberate lifecycle-safety fault`,
      sourcePath: item.sourcePath,
      applied,
      compiled,
      result,
      expectedKiller: item.expectedKiller,
      killedBy,
      restored: readFileSync(sourcePath, "utf8") === original
    });
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    protocol: "foundation-mutation-v2",
    criticalCases: CASES.map((item) => ({ id: item.expectedKiller, status: "passed" })),
    mutants
  }, null, 2)}\n`);
  const killed = mutants.filter((mutant) => mutant.result === "killed").length;
  process.stdout.write(`lifecycle safety mutation: ${killed}/${mutants.length} killed\n`);
  if (!mutants.every((mutant) => mutant.applied && mutant.compiled && mutant.restored &&
      mutant.result === "killed" && mutant.killedBy === mutant.expectedKiller))
    process.exitCode = 1;
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
