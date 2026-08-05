#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RUNTIME_BASELINES } from "../../scripts/oracle/runtime-api.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const runtimeApi of Object.keys(RUNTIME_BASELINES)) {
  const cwd = mkdtempSync(join(tmpdir(), `cloop-api-${runtimeApi}-`));
  try {
    const result = spawnSync(process.execPath, [
      join(root, "scripts/oracle/differential-runner.mjs"),
      "--oracle", join(root, `tests/oracle/runtime-api-${runtimeApi}.json`),
      "--candidate-bin", join(root, "target/debug/cloop"),
      "--candidate-prefix", "legacy-runtime",
      "--candidate-prefix", "--api",
      "--candidate-prefix", runtimeApi,
      "--candidate-cwd", cwd
    ], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
