// The OpenSpec CLI gate decides whether a change can reach 'openspec archive'
// at all. It used to be a substring test over stdout+stderr run after the code
// had already been projected, so both halves are pinned here: the version
// policy itself, and the fact that landCheck refuses before any projection.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertOpenSpecCli, createLandRuntime, openSpecCliStatus, openSpecVersionStatus
} from "../../harness/runtime/workflow/land-runtime.mjs";

let assertions = 0;
function check(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

// Version policy over stdout text.
check(openSpecVersionStatus("1.7.0").level, "ok", "the tested version passes");
check(openSpecVersionStatus("1.7.4\n").level, "ok", "patch releases inside 1.7 pass");
check(openSpecVersionStatus("v1.7.12").level, "ok", "a v-prefixed patch release passes");
check(openSpecVersionStatus("1.8.0").level, "warn", "an untested newer minor warns");
check(openSpecVersionStatus("1.11.0").level, "warn", "minor comparison is numeric, not lexical");
check(openSpecVersionStatus("1.6.9").level, "error", "a minor below the tested line fails");
check(openSpecVersionStatus("2.0.0").level, "error", "a major mismatch fails");
check(openSpecVersionStatus("0.9.1").level, "error", "a pre-1.0 major fails");
check(openSpecVersionStatus("").level, "error", "empty output fails");
check(openSpecVersionStatus(null).level, "error", "absent output fails");
check(openSpecVersionStatus("openspec, the spec CLI").level, "error", "unparseable output fails");
check(openSpecVersionStatus("1.7").level, "error", "a partial version is not a version");
check(openSpecVersionStatus("1.8.0").version, "1.8.0", "the reported version is the parsed one");
check(openSpecVersionStatus("openspec/1.7.0 (darwin-arm64)").version, "1.7.0",
  "the first semver in decorated output is used");

// The loose-match regression: a warning line mentioning the pinned version must
// not vouch for a CLI that reports a different one.
check(openSpecVersionStatus("2.1.0\nnotice: config format changed since 1.7.0\n").level,
  "error", "stdout wins over any 1.7.0 mention elsewhere in the line");

const workspace = mkdtempSync(join(tmpdir(), "foundation-openspec-"));
const bin = join(workspace, "bin");
mkdirSync(bin);
const originalPath = process.env.PATH;

function fakeCli({ stdout = "", stderr = "", status = 0 }) {
  writeFileSync(join(bin, "openspec"), [
    // Absolute interpreter: PATH is reduced to the fake bin for these probes.
    "#!/bin/sh",
    stdout ? `printf '%s\\n' ${JSON.stringify(stdout)}` : "",
    stderr ? `printf '%s\\n' ${JSON.stringify(stderr)} >&2` : "",
    `exit ${status}`
  ].filter(Boolean).join("\n"));
  chmodSync(join(bin, "openspec"), 0o755);
  process.env.PATH = bin;
}

try {
  process.env.PATH = join(workspace, "empty");
  const missing = openSpecCliStatus(workspace);
  check(missing.level, "error", "an absent CLI is an error");
  assertions += 1;
  assert.match(missing.detail, /@fission-ai\/openspec/,
    "the absent-CLI detail names the package to install");

  fakeCli({ stdout: "1.7.0" });
  check(openSpecCliStatus(workspace).level, "ok", "a pinned CLI passes the probe");

  // The exact defect the string match hid: the real version is 2.0.0 and only
  // a deprecation notice on stderr mentions 1.7.0.
  fakeCli({ stdout: "2.0.0", stderr: "warning: openspec 1.7.0 config is deprecated" });
  const stderrDecoy = openSpecCliStatus(workspace);
  check(stderrDecoy.level, "error", "stderr is not part of the matched version");
  check(stderrDecoy.version, "2.0.0", "the version comes from stdout only");

  fakeCli({ stdout: "1.7.3" });
  check(openSpecCliStatus(workspace).level, "ok", "a newer patch needs no escape hatch");

  fakeCli({ stdout: "", stderr: "boom", status: 1 });
  check(openSpecCliStatus(workspace).level, "error", "a non-zero probe is an error");

  // assertOpenSpecCli: errors stop, warnings are observable and do not stop.
  fakeCli({ stdout: "2.0.0" });
  assertions += 1;
  assert.throws(() => assertOpenSpecCli(workspace, (message) => {
    throw new Error(message);
  }), /incompatible/, "a major mismatch stops the caller");

  fakeCli({ stdout: "1.9.0" });
  const warnings = [];
  const originalError = console.error;
  console.error = (message) => warnings.push(message);
  try {
    check(assertOpenSpecCli(workspace, () => {
      throw new Error("must not fail");
    }).level, "warn", "an untested newer minor is allowed through");
  } finally {
    console.error = originalError;
  }
  assertions += 1;
  assert.match(warnings.join("\n"), /WARNING: OpenSpec 1\.9\.0 is newer/,
    "the allowance is warned observably on stderr");

  // landCheck gates on the CLI before it reads proof or touches a projection.
  const calls = [];
  const runtime = createLandRuntime({
    root: workspace,
    loadRuntime: () => ({ id: "demo", status: "proven" }),
    pendingApplyTransactions: () => [],
    recoverPendingApply: () => {},
    assertNoDroppedScenarios: () => calls.push("scenarios"),
    proofPath: () => {
      calls.push("proof");
      return join(workspace, "missing-proof.json");
    },
    proofAudit: () => ({ valid: true }),
    clearSnapshotCache: () => {},
    relevantHash: () => "hash",
    requiredProviders: () => [],
    fail: (message) => {
      throw new Error(message);
    }
  });

  process.env.PATH = join(workspace, "empty");
  assertions += 1;
  assert.throws(() => runtime.landCheck("demo"), /OpenSpec CLI is required/,
    "landCheck refuses a missing CLI");
  check(calls, ["scenarios"], "the refusal happens before proof is even read");

  // With a usable CLI the gate is transparent: landCheck proceeds to its own
  // proof checks rather than stopping on the environment.
  fakeCli({ stdout: "1.7.0" });
  assertions += 1;
  assert.throws(() => runtime.landCheck("demo"), /has no passing proof/,
    "a usable CLI lets landCheck reach its proof checks");
} finally {
  process.env.PATH = originalPath;
  rmSync(workspace, { recursive: true, force: true });
}

console.log(`openspec version policy: ALL PASS (${assertions}/${assertions} assertions)`);
