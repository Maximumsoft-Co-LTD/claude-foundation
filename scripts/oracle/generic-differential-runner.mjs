#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
}

const fixturePath = value("--fixture");
const candidate = value("--candidate-bin");
if (!fixturePath || !candidate) {
  console.error("usage: generic-differential-runner.mjs --fixture <json> --candidate-bin <path>");
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || !fixture.entrypoint) {
  throw new Error("invalid generic differential fixture");
}

function run(bin, args) {
  const result = spawnSync(bin, args, { cwd: process.cwd(), encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function comparable(result) {
  let stdout = result.stdout;
  try {
    stdout = canonical(JSON.parse(stdout));
  } catch {
    // Non-JSON command output remains byte-exact.
  }
  return { status: result.status, stdout, stderr: result.stderr };
}

let failures = 0;
for (const testCase of fixture.cases) {
  const reference = run(process.execPath, [fixture.entrypoint, ...testCase.args]);
  const rust = run(resolve(candidate), testCase.args);
  const expected = testCase.result ?? (Object.hasOwn(testCase, "output")
    ? { status: 0, stdout: `${JSON.stringify(testCase.output)}\n`, stderr: "" }
    : reference);
  if (JSON.stringify(comparable(reference)) !== JSON.stringify(comparable(expected)) || JSON.stringify(comparable(rust)) !== JSON.stringify(comparable(expected))) {
    failures += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(`  expected  ${JSON.stringify(expected)}`);
    console.error(`  node      ${JSON.stringify(reference)}`);
    console.error(`  rust      ${JSON.stringify(rust)}`);
  } else {
    console.log(`PASS ${testCase.name}`);
  }
}
if (failures) process.exit(1);
console.log(`${fixture.runtimeApi} differential: ${fixture.cases.length} fixture(s) passed`);
