#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { directoryDigest } from "./lab.mjs";
import { loadMatrix, matrixIssues } from "./matrix.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const WORKLOAD_SUITE = resolve(HERE, "../tests/openspec-native-workloads.test.mjs");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fixtureDigest(path) {
  return statSync(path).isDirectory() ? directoryDigest(path) : sha256(readFileSync(path));
}

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

export function runDeterministicSentinel() {
  const matrix = loadMatrix();
  const issues = matrixIssues(matrix);
  if (issues.length) throw new Error(`invalid matrix:\n${issues.join("\n")}`);
  const started = performance.now();
  const result = spawnSync(process.execPath, ["--test", WORKLOAD_SUITE], {
    cwd: ROOT, encoding: "utf8", env: process.env
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const scenarios = matrix.scenarios.map((scenario) => {
    const actualFixtureDigest = fixtureDigest(resolve(ROOT, scenario.fixture));
    return {
      id: scenario.id,
      execution: "deterministic-zero-cost",
      expectedFixtureDigest: scenario.fixture_digest,
      actualFixtureDigest,
      fixtureFrozen: actualFixtureDigest === scenario.fixture_digest,
      status: result.status === 0 && actualFixtureDigest === scenario.fixture_digest
        ? "pass" : "fail"
    };
  });
  const revision = git(["rev-parse", "HEAD"]);
  const patch = git(["diff", "--binary", "HEAD"]);
  const report = {
    version: 1,
    protocol: "foundation-deterministic-sentinel-v1",
    matrixProtocol: matrix.protocol,
    matrixDigest: sha256(readFileSync(resolve(HERE,
      "../config/openspec-native-matrix.json"))),
    source: {
      commit: revision.status === 0 ? revision.stdout.trim() : null,
      dirty: Boolean(String(patch.stdout || "").trim()),
      patchDigest: sha256(String(patch.stdout || ""))
    },
    zeroModelSpend: true,
    command: [process.execPath, "--test", WORKLOAD_SUITE],
    commandExitCode: result.status,
    commandOutputDigest: sha256(output),
    durationMs: Number((performance.now() - started).toFixed(3)),
    scenarios,
    status: result.status === 0 && scenarios.every((row) => row.status === "pass")
      ? "pass" : "fail"
  };
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = runDeterministicSentinel();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
