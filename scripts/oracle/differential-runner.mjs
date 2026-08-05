#!/usr/bin/env node

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  API_12_REVISION,
  materializeRevision,
  readOracle,
  repositoryRoot,
  runCase
} from "./runtime-api.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

const oraclePath = value("--oracle");
const candidateBin = value("--candidate-bin");
const candidateRef = value("--candidate-ref");
const candidateCwd = value("--candidate-cwd");
const selectedCase = value("--case");
const prefix = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--candidate-prefix") prefix.push(process.argv[index + 1]);
}

if (!oraclePath || (!candidateBin && !candidateRef) || (candidateBin && candidateRef)) {
  console.error("usage: differential-runner.mjs --oracle <fixture.json> " +
    "(--candidate-bin <path> [--candidate-prefix <arg> ...] [--candidate-cwd <dir>] | " +
    "--candidate-ref <git-revision>) [--case <name>]");
  process.exit(2);
}

const oracle = readOracle(oraclePath);
let checkout = null;
let bin;
let cwd;
let commandPrefix;

if (candidateRef) {
  checkout = materializeRevision(repositoryRoot(), candidateRef);
  bin = process.execPath;
  cwd = checkout;
  commandPrefix = [oracle.entrypoint];
} else {
  bin = resolve(candidateBin);
  cwd = candidateCwd ? resolve(candidateCwd) : process.cwd();
  commandPrefix = prefix;
}

let failed = 0;
try {
  const cases = selectedCase
    ? oracle.cases.filter((testCase) => testCase.name === selectedCase)
    : oracle.cases;
  if (cases.length === 0) throw new Error(`unknown oracle case '${selectedCase}'`);

  for (const testCase of cases) {
    const actual = runCase({ bin, prefix: commandPrefix, cwd, testCase });
    if (JSON.stringify(actual) === JSON.stringify(testCase.result)) {
      console.log(`PASS ${testCase.name}`);
    } else {
      failed += 1;
      console.error(`FAIL ${testCase.name}`);
      console.error(`  expected ${JSON.stringify(testCase.result)}`);
      console.error(`  actual   ${JSON.stringify(actual)}`);
    }
  }
} finally {
  if (checkout) rmSync(checkout, { recursive: true, force: true });
}

if (failed > 0) process.exit(1);
console.log(`runtime API ${oracle.runtimeApi} differential: ${oracle.cases.length} fixture(s) available`);

