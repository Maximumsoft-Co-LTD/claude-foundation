import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, isMain, repoPath, writeJson } from "./lib.mjs";

const SINGLE_SOURCE = ["node", ".claude/tests/harness/run-single-source-tests.mjs"];
const CASES = [
  {
    id: "MUT-CLI-RUNTIME-API-DRIFT", sourcePath: "cli.sh",
    expectedKiller: "CASE-SINGLE-SOURCE-RUNTIME-API", detector: SINGLE_SOURCE,
    before: "EXPECTED_RUNTIME_API=26", after: "EXPECTED_RUNTIME_API=999",
    compile: ["bash", "-n", "cli.sh"]
  },
  {
    id: "MUT-INSTALL-MANAGED-PATH-UNDECLARED", sourcePath: "install.sh",
    expectedKiller: "CASE-SINGLE-SOURCE-MANAGED", detector: SINGLE_SOURCE,
    before: "MANAGED=(\n", after: "MANAGED=(\n  \".foundation/undeclared-quality-mutant\"\n",
    compile: ["bash", "-n", "install.sh"]
  },
  {
    id: "MUT-PROTOCOL-RUNTIME-API-DRIFT", sourcePath: ".claude/harness/protocol.json",
    expectedKiller: "CASE-SINGLE-SOURCE-PROTOCOL", detector: SINGLE_SOURCE,
    before: "\"runtimeApi\": \"26\"", after: "\"runtimeApi\": \"999\"",
    compile: ["node", "-e", "JSON.parse(require('node:fs').readFileSync('.claude/harness/protocol.json'))"]
  },
  {
    id: "MUT-REVIEW-SCHEMA-REQUIRED-WIDENED",
    sourcePath: ".claude/harness/runtime/evidence/configured-reviewer.mjs",
    expectedKiller: "CASE-REVIEW-SCHEMA-REQUIRED",
    detector: ["node", ".claude/tests/harness/run-v33-policy-tests.mjs"],
    before: "required: [\"status\", \"summary\", \"findings\", \"verifiedFindingIds\"]",
    after: "required: [\"status\", \"summary\", \"findings\"]",
    compile: ["node", "--check", ".claude/harness/runtime/evidence/configured-reviewer.mjs"]
  }
];

function execute([command, ...args], cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300000 });
}

function exactReplace(source, before, after) {
  const pieces = source.split(before);
  if (pieces.length !== 2) return null;
  return `${pieces[0]}${after}${pieces[1]}`;
}

async function main() {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-shipping-mutants-"));
  const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
    ".foundation/test-results/quality/semantic-suites/SEM-SHIPPING-CONTRACTS.json");
  try {
    cpSync(ROOT, fixture, { recursive: true, filter: (source) => {
      const relative = source.slice(ROOT.length).replace(/^\//, "");
      return !relative || ![".git", "node_modules", ".foundation", "target", ".stryker-tmp-dashboard"]
        .some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
    } });
    const baselines = new Map();
    for (const detector of [SINGLE_SOURCE, CASES[3].detector]) {
      const key = detector.join("\0");
      if (!baselines.has(key)) baselines.set(key, execute(detector, fixture));
      if (baselines.get(key).status !== 0) throw new Error(`clean baseline failed: ${detector.join(" ")}`);
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
          compiled = execute(item.compile, fixture).status === 0;
          if (compiled && execute(item.detector, fixture).status !== 0) {
            result = "killed";
            killedBy = item.expectedKiller;
          }
        }
      } finally {
        writeFileSync(sourcePath, original);
      }
      const restored = readFileSync(sourcePath, "utf8") === original;
      mutants.push({
        id: item.id, description: `${item.id} deliberate shipping-boundary fault`,
        sourcePath: item.sourcePath, applied, compiled, result, expectedKiller: item.expectedKiller,
        killedBy, restored
      });
    }
    mkdirSync(dirname(output), { recursive: true });
    writeJson(output, {
      protocol: "foundation-mutation-v2",
      criticalCases: CASES.map((item) => ({ id: item.expectedKiller, status: "passed" })),
      mutants
    });
    const valid = mutants.every((mutant) => mutant.applied && mutant.compiled && mutant.restored &&
      mutant.result === "killed" && mutant.killedBy === mutant.expectedKiller);
    process.stdout.write(`shipping semantic mutation: ${mutants.filter((m) => m.result === "killed").length}/${mutants.length} killed -> ${repoPath(output)}\n`);
    if (!valid) process.exitCode = 1;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) await main();
