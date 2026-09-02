import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  cleanRoomCommandContract, directoryDigest, runScenarioLab, shellCheck
} from "../openspec-native/lab.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function executable(path, value) {
  write(path, value);
  chmodSync(path, 0o755);
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
      host: "stub", risk: "low", project_command: "node --test",
      clean_install_command: "true", critical_case_ids: ["CASE-1"],
      oracle: { required: true, path: oracle }, quality_required: true,
      budget: { wall_ms: 1000, cost_usd: 1, model_requests: 2 },
      expected_terminal: "completed", baseline: null
    }, ...workloads.map((workload, index) => ({
      id: `planned-${index}`, status: "planned", execution: "paid", workload,
      budget: { wall_ms: 1, cost_usd: 1, model_requests: 1 }
    }))]
  }, null, 2)}\n`);
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
