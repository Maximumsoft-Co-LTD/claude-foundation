import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  baselineAllowedTools, cleanRoomCommandContract, directoryDigest, installedAllowedTools,
  runScenarioLab, shellCheck
} from "../openspec-native/lab.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function executable(path, value) {
  write(path, value);
  chmodSync(path, 0o755);
}

function writeFixtureMatrix(matrix, fixture, oracle, projectCommand = "node --test") {
  const workloads = [
    "ui-state-defect", "api-validation-defect", "data-migration",
    "behavior-preserving-refactor", "multi-service-contract",
    "budget-decision-boundary"
  ];
  write(matrix, `${JSON.stringify({
    version: 2,
    protocol: "foundation-openspec-native-matrix-v2",
    execution_policy: {
      smoke_repeats: 1, variance_repeats: 3,
      required_measurements: ["oracle", "wall_ms", "cost_usd", "model_requests",
        "operation_counts", "coverage", "crap"],
      budget_exhaustion: { terminal_status: "needs-user-decision", ask_user: true,
        resumable: true, may_report_complete: false, may_report_blocked: false }
    },
    scenarios: [{
      id: "fixture", status: "ready", execution: "paid",
      workload: "brownfield-defect", stack: "node", size: "small",
      fixture, fixture_digest: directoryDigest(fixture), prompt: "/dev fixture",
      host: "stub", risk: "low", project_command: projectCommand,
      clean_install_command: "true", critical_case_ids: ["CASE-1"],
      oracle: { required: true, path: oracle }, quality_required: true,
      budget: { wall_ms: 1000, cost_usd: 1, model_requests: 2 },
      expected_terminal: "completed", baseline: null
    }, ...workloads.map((workload, index) => ({
      id: `planned-${index}`, status: "planned", execution: "paid", workload,
      budget: { wall_ms: 1, cost_usd: 1, model_requests: 1 }
    }))]
  }, null, 2)}\n`);
}

test("fixture digests ignore generated Python bytecode", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-lab-digest-"));
  try {
    write(join(root, "app.py"), "value = 1\n");
    const expected = directoryDigest(root);
    write(join(root, "__pycache__/app.cpython-312.pyc"), "generated");
    write(join(root, "loose.pyc"), "generated");
    assert.equal(directoryDigest(root), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("consumer lab installs a disposable seed, preserves evidence, and cleans up", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-lab-test-"));
  const fixture = join(root, "fixture");
  const tempParent = join(root, "tmp");
  const outputRoot = join(root, "results");
  mkdirSync(tempParent, { recursive: true });
  write(join(fixture, "src/app.js"), "module.exports = 1;\n");
  const oracle = join(root, "oracle.sh");
  executable(oracle, "#!/bin/sh\nprintf '%s\\n' '{\"verdict\":\"pass\",\"score\":1,\"max\":1,\"results\":{\"CASE-1\":\"pass\"}}'\n");
  const installer = join(root, "install.sh");
  executable(installer, `#!/bin/sh
set -eu
mkdir -p "$1/.claude/harness"
printf '%s\n' '#!/usr/bin/env node' > "$1/.claude/harness/foundation.mjs"
`);
  const runner = join(root, "runner.mjs");
  executable(runner, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const project = value("--project");
const output = value("--output");
mkdirSync(join(project, ".foundation/runtime"), { recursive: true });
mkdirSync(join(project, ".foundation/receipts/demo"), { recursive: true });
writeFileSync(join(project, ".foundation/runtime/demo.json"), '{"status":"proven"}\\n');
writeFileSync(join(project, ".foundation/receipts/demo/proof.json"), '{"status":"pass"}\\n');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, '{"fixture":true}\\n');
`);
  const matrix = join(root, "matrix.json");
  writeFixtureMatrix(matrix, fixture, oracle);
  try {
    const result = runScenarioLab({
      matrixPath: matrix, scenarioId: "fixture", outputRoot, installer, runner,
      tempParent, runId: "run-1"
    });
    assert.equal(result.status, 0);
    assert.equal(result.project, null);
    assert.deepEqual(readdirSync(tempParent), [], "the disposable consumer is removed");
    const manifest = JSON.parse(readFileSync(result.manifest, "utf8"));
    assert.equal(manifest.seedDigest, directoryDigest(fixture));
    assert.equal(manifest.prompt, "/dev fixture");
    assert.deepEqual(manifest.criticalCaseIds, ["CASE-1"]);
    assert.match(manifest.source.patchDigest, /^sha256:/);
    assert.match(manifest.treeDigests.deliveredProject, /^sha256:/);
    assert.equal(manifest.strictPass, true);
    assert.equal(manifest.verification.projectCommand.status, "pass");
    assert.equal(manifest.verification.cleanInstall.status, "pass");
    assert.equal(manifest.verification.cleanInstallProjectCommand.status, "pass");
    assert.deepEqual(manifest.verification.contract, {
      version: 1, command: "true", timeoutMs: 600000,
      cachePolicy: "isolated-disposable", networkPolicy: "allowed-with-timeout"
    });
    assert.ok(existsSync(join(result.runDir, "source.patch")));
    const integrity = JSON.parse(readFileSync(join(result.runDir, "integrity.json"), "utf8"));
    assert.match(integrity.files["manifest.json"], /^sha256:/);
    assert.ok(manifest.retained.includes(".foundation/runtime"));
    assert.ok(existsSync(join(result.runDir,
      "evidence/.foundation/receipts/demo/proof.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean-room contract bounds execution and reports missing tools as unavailable", () => {
  assert.deepEqual(cleanRoomCommandContract({
    clean_install_command: "install-project", clean_install_timeout_ms: 1234,
    clean_install_network: "offline"
  }), {
    version: 1, command: "install-project", timeoutMs: 1234,
    cachePolicy: "isolated-disposable", networkPolicy: "offline"
  });
  const result = shellCheck("foundation-command-that-does-not-exist", process.cwd(), {
    timeoutMs: 1000
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "command-unavailable");
});

// The paid lab passed only `Bash(claude-foundation *)`, so the installed CLI
// shim `.foundation/bin/claude-foundation` was scored as a product prompt even
// though the shipped install pre-allows it in a trusted workspace.
test("paid lab grants exactly the allowlist the installer seeded", () => {
  const project = mkdtempSync(join(tmpdir(), "bench-lab-allow-"));
  try {
    assert.deepEqual(installedAllowedTools(project), ["Bash(claude-foundation *)"]);
    const shipped = JSON.parse(readFileSync(new URL("../../../settings.json", import.meta.url),
      "utf8")).permissions.allow;
    write(join(project, ".claude/settings.json"), JSON.stringify({
      permissions: { allow: [...shipped, "", 7] }
    }));
    assert.deepEqual(installedAllowedTools(project), shipped);
    assert.ok(installedAllowedTools(project).includes("Bash(.foundation/bin/claude-foundation *)"));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("baseline lab runs the same seed with no harness, no installer, and plain-user tools", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-lab-baseline-"));
  const fixture = join(root, "fixture");
  const tempParent = join(root, "tmp");
  const outputRoot = join(root, "results");
  mkdirSync(tempParent, { recursive: true });
  write(join(fixture, "src/app.js"), "module.exports = 1;\n");
  write(join(fixture, "package.json"), '{"scripts":{"test":"node --test"}}\n');
  const oracle = join(root, "oracle.sh");
  executable(oracle, "#!/bin/sh\nexit 0\n");
  const installerRan = join(root, "installer-ran");
  const installer = join(root, "install.sh");
  executable(installer, `#!/bin/sh\ntouch "${installerRan}"\n`);
  const observed = join(root, "observed.json");
  const runner = join(root, "runner.mjs");
  executable(runner, `#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const project = value("--project");
writeFileSync(${JSON.stringify(observed)}, JSON.stringify({ args,
  entries: readdirSync(project).sort(), path: process.env.PATH }));
writeFileSync(join(project, "src/feature.js"), "module.exports = 2;\\n");
mkdirSync(dirname(value("--output")), { recursive: true });
writeFileSync(value("--output"), '{"fixture":true}\\n');
`);
  const matrix = join(root, "matrix.json");
  writeFixtureMatrix(matrix, fixture, oracle, "test -f src/feature.js");
  try {
    const result = runScenarioLab({
      matrixPath: matrix, scenarioId: "fixture", outputRoot, installer, runner,
      tempParent, runId: "baseline-1", arm: "baseline"
    });
    assert.equal(result.status, 0);
    assert.equal(existsSync(installerRan), false, "the baseline never installs Change Loop");
    assert.deepEqual(readdirSync(tempParent), [], "the disposable baseline project is removed");
    const seen = JSON.parse(readFileSync(observed, "utf8"));
    assert.deepEqual(seen.entries, [".foundation-benchmark.json", ".git", "package.json", "src"]);
    assert.doesNotMatch(seen.path, /baseline-1\/bin/, "no claude-foundation shim on PATH");
    const flag = (name) => seen.args[seen.args.indexOf(name) + 1];
    assert.equal(flag("--arm"), "baseline");
    assert.equal(flag("--max-cost-usd"), "1", "the matrix budget is shared by both arms");
    assert.equal(flag("--max-model-requests"), "2");
    assert.equal(flag("--timeout-ms"), "1000");
    assert.equal(seen.args.includes("--test-land"), false);
    assert.equal(seen.args.includes("--test-self-review"), false);
    const claudeArgs = seen.args.flatMap((value, index) =>
      value === "--claude-arg" ? [seen.args[index + 1]] : []);
    assert.deepEqual(claudeArgs.slice(0, 3), ["--permission-mode", "acceptEdits", "--allowedTools"]);
    assert.equal(claudeArgs.some((rule) => /claude-foundation|foundation\.mjs|\.foundation/.test(rule)),
      false);
    const manifest = JSON.parse(readFileSync(result.manifest, "utf8"));
    assert.equal(manifest.arm, "baseline");
    assert.equal(manifest.strictPass, true);
    assert.equal(manifest.seedDigest, directoryDigest(fixture));
    assert.match(readFileSync(join(result.runDir, "product.patch"), "utf8"),
      /src\/feature\.js/, "the baseline's product diff is preserved");
    assert.deepEqual(manifest.retained, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline dry-run prints the exact host plan for free and keeps no project", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-lab-baseline-dry-"));
  const fixture = join(root, "fixture");
  const tempParent = join(root, "tmp");
  const outputRoot = join(root, "results");
  mkdirSync(tempParent, { recursive: true });
  write(join(fixture, "src/app.js"), "module.exports = 1;\n");
  const oracle = join(root, "oracle.sh");
  executable(oracle, "#!/bin/sh\nexit 0\n");
  const matrix = join(root, "matrix.json");
  writeFixtureMatrix(matrix, fixture, oracle);
  try {
    const plan = runScenarioLab({
      matrixPath: matrix, scenarioId: "fixture", outputRoot, tempParent,
      runId: "dry-1", arm: "baseline", dryRun: true
    });
    assert.equal(plan.dryRun, true);
    assert.equal(plan.harnessInstalled, false);
    assert.deepEqual(plan.projectEntries, [".foundation-benchmark.json", ".git", "src"]);
    assert.equal(plan.host.arm, "baseline");
    assert.equal(plan.host.claudeBin, "claude");
    assert.equal(plan.host.argv[1], plan.host.prompt);
    assert.match(plan.host.prompt, /^fixture\n\nThe canonical project test command is `node --test`/);
    assert.equal(plan.host.argv[plan.host.argv.indexOf("--max-budget-usd") + 1], "1");
    assert.equal(plan.host.maxModelRequests, 2);
    assert.equal(existsSync(outputRoot), false, "a dry run writes no results");
    assert.deepEqual(readdirSync(tempParent), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline tools are what a plain user approves for the task", () => {
  const project = mkdtempSync(join(tmpdir(), "bench-lab-baseline-allow-"));
  try {
    assert.deepEqual(baselineAllowedTools({ project,
      projectCommand: "python3 -m unittest discover -s tests" }), [
      "Edit(/**)", "Bash(python3 *)", "Bash(python3 -m unittest discover -s tests)",
      "Bash(git status)", "Bash(git status *)", "Bash(git diff)", "Bash(git diff *)",
      "Bash(git log)", "Bash(git log *)", "Bash(git show)", "Bash(git show *)"
    ]);
    write(join(project, "package.json"), '{"scripts":{"test":"node --test"}}');
    const node = baselineAllowedTools({ project, projectCommand: "node --test" });
    assert.ok(node.includes("Bash(node *)"));
    assert.ok(node.includes("Bash(npm test)"));
    assert.equal(node.some((rule) => /git (?:commit|push|reset|checkout)/.test(rule)), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
