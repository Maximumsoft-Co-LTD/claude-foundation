// Regression seams for two Model Router V1 defects:
// - `sandbox apply --refresh` must route to applySandbox (it used to die on
//   any flag), while unknown flags and extra positionals still die.
// - `change validate` must run the OpenSpec strict lint when the CLI is
//   present, fail with its findings, and degrade to a warning when absent.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { routeRuntimeCommand } from "../../harness/runtime/core/cli-router.mjs";
import { createFlagParser } from "../../harness/runtime/core/cli-flags.mjs";
import { assertOpenSpecStrictValid } from "../../harness/runtime/workflow/change-validation.mjs";

const fail = (message) => { throw new Error(message); };
const { parseFlags, parseStrictCommandFlags } = createFlagParser({ fail });

async function route(command, values, overrides) {
  await routeRuntimeCommand(command, values, {
    parseFlags, parseStrictCommandFlags, fail, ...overrides
  });
}

// --- sandbox apply routing ---
{
  const applied = [];
  await route("sandbox", ["apply", "--refresh", "my-change"], {
    applySandbox: (id, flags) => applied.push([id, flags])
  });
  assert.deepEqual(applied, [["my-change", { refresh: true }]],
    "--refresh must reach applySandbox as options.refresh");

  applied.length = 0;
  await route("sandbox", ["apply", "my-change"], {
    applySandbox: (id, flags) => applied.push([id, flags])
  });
  assert.deepEqual(applied, [["my-change", {}]],
    "plain apply still routes with no options");

  await assert.rejects(
    route("sandbox", ["apply", "--controlPlane", "x", "my-change"], {
      applySandbox: () => fail("must not route")
    }), /unknown|sandbox apply/i,
    "controlPlane stays internal and unparseable");

  await assert.rejects(
    route("sandbox", ["apply", "my-change", "extra"], {
      applySandbox: () => fail("must not route")
    }), /exactly one change/,
    "extra positionals still die");
}

// --- authority reset-infra routing ---
{
  const resets = [];
  await route("authority-reset-infra", ["my-change", "--decision-ref", "ref-1"], {
    resetInfrastructureAuthority: (id, flags) => resets.push([id, flags])
  });
  assert.deepEqual(resets, [["my-change", { "decision-ref": "ref-1" }]],
    "reset-infra must route the decision reference");
  await assert.rejects(
    route("authority-reset-infra", [], {
      resetInfrastructureAuthority: () => fail("must not route")
    }), /exactly one change/);
}

// --- validate-time OpenSpec strict lint ---
{
  const root = mkdtempSync(join(tmpdir(), "foundation-spec-lint-"));
  const changeDir = join(root, "openspec", "changes", "lint-change");
  mkdirSync(changeDir, { recursive: true });
  const stubDir = join(root, "bin");
  mkdirSync(stubDir, { recursive: true });
  const stub = join(stubDir, "openspec");
  const writeStub = (validateExit, message) => {
    writeFileSync(stub, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "1.7.0"; exit 0; fi
echo "${message}"
exit ${validateExit}
`);
    chmodSync(stub, 0o755);
  };
  const priorPath = process.env.PATH;
  try {
    process.env.PATH = `${stubDir}${delimiter}${priorPath}`;

    writeStub(1, "Requirement must contain SHALL or MUST");
    assert.throws(() =>
      assertOpenSpecStrictValid("lint-change", changeDir, fail),
    /strict validation failed[\s\S]*SHALL or MUST/,
    "a strict-lint failure must fail validate with the findings");

    writeStub(0, "Change 'lint-change' is valid");
    assertOpenSpecStrictValid("lint-change", changeDir, fail);

    // Absent CLI: PATH without the stub (and without any system openspec)
    // degrades to a warning instead of failing.
    process.env.PATH = stubDir === "/nonexistent" ? "" : "/nonexistent";
    assertOpenSpecStrictValid("lint-change", changeDir, fail);
  } finally {
    process.env.PATH = priorPath;
  }
}

console.log("guard-fix CLI seams: all cases passed");
