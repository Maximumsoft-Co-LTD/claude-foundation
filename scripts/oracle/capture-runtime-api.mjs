#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNTIME_API_CASES,
  RUNTIME_BASELINES,
  materializeRevision,
  repositoryRoot,
  runCase
} from "./runtime-api.mjs";

const outputFlag = process.argv.indexOf("--output");
const apiFlag = process.argv.indexOf("--api");
const runtimeApi = apiFlag === -1 ? null : process.argv[apiFlag + 1];
const baseline = RUNTIME_BASELINES[runtimeApi];
if (outputFlag === -1 || !process.argv[outputFlag + 1] || !baseline) {
  console.error("usage: capture-runtime-api.mjs --api <12|13> --output <fixture.json>");
  process.exit(2);
}

const root = repositoryRoot();
const checkout = materializeRevision(root, baseline.revision);
try {
  const reportedApi = runCase({
    bin: process.execPath,
    prefix: [".claude/harness/foundation.mjs"],
    cwd: checkout,
    testCase: { args: ["api-version"] }
  });
  if (reportedApi.status !== 0 || reportedApi.stdout.trim() !== runtimeApi) {
    throw new Error(`pinned revision did not report runtime API ${runtimeApi}: ${JSON.stringify(reportedApi)}`);
  }

  const oracle = {
    schemaVersion: 2,
    runtimeApi,
    sourceRevision: baseline.revision,
    entrypoint: ".claude/harness/foundation.mjs",
    cases: RUNTIME_API_CASES.map((testCase) => ({
      name: testCase.name,
      args: testCase.args,
      ...(testCase.setup ? { setup: testCase.setup } : {}),
      ...(testCase.inspectPaths ? { inspectPaths: testCase.inspectPaths } : {}),
      result: runCase({
        bin: process.execPath,
        prefix: [".claude/harness/foundation.mjs"],
        cwd: checkout,
        testCase
      })
    }))
  };
  writeFileSync(resolve(process.argv[outputFlag + 1]), `${JSON.stringify(oracle, null, 2)}\n`);
} finally {
  // The archive checkout contains runtime state created by read commands only.
  // Keeping cleanup here makes repeated capture deterministic.
  const { rmSync } = await import("node:fs");
  rmSync(checkout, { recursive: true, force: true });
}
