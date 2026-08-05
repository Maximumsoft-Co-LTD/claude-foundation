#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_BASELINES } from "../../scripts/oracle/runtime-api.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const [runtimeApi, baseline] of Object.entries(RUNTIME_BASELINES)) {
  const result = spawnSync(process.execPath, [
    join(root, "scripts/oracle/differential-runner.mjs"),
    "--oracle", join(root, `tests/oracle/runtime-api-${runtimeApi}.json`),
    "--candidate-ref", baseline.revision
  ], { cwd: root, stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
