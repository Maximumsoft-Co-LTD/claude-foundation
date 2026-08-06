#!/usr/bin/env node
// Runs the Rust workspace suite and writes a structured report the Foundation
// `test-discovery` adapter can read.
//
// `cargo test` has no stable machine-readable output, so the count comes from
// the `test result:` summary lines it prints per suite. A suite that fails to
// build prints no summary at all, which is why the exit status — not the parsed
// count — decides pass or fail; the count only proves tests were discovered.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPORT = resolve(process.env.CARGO_TEST_REPORT || "target/evidence/cargo-test.json");

const result = spawnSync(
  "cargo",
  ["test", "--workspace", "--locked", ...process.argv.slice(2)],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
);

const output = `${result.stdout || ""}${result.stderr || ""}`;
const summaries = [...output.matchAll(
  /^test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored/gm
)];

const report = {
  schemaVersion: 1,
  tool: "cargo test --workspace",
  numTotalTests: summaries.reduce((total, line) => total + Number(line[2]) + Number(line[3]), 0),
  numPassedTests: summaries.reduce((total, line) => total + Number(line[2]), 0),
  numFailedTests: summaries.reduce((total, line) => total + Number(line[3]), 0),
  numIgnoredTests: summaries.reduce((total, line) => total + Number(line[4]), 0),
  suites: summaries.length,
  exitCode: result.status ?? 1,
};

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(
  `${report.numPassedTests} passed, ${report.numFailedTests} failed across ${report.suites} suites\n`
);
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(report.exitCode === 0 && report.numFailedTests === 0 ? 0 : 1);
