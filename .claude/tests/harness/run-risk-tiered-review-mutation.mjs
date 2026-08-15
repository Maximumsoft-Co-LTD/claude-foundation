import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = resolve(".claude/harness/runtime/evidence/adapter-runtime.mjs");
const source = readFileSync(sourcePath, "utf8");
const guard = "row.expectedKiller && row.killedBy === row.expectedKiller &&\n      passedKillers.has(row.expectedKiller)";
const fault = "row.expectedKiller && Boolean(row.killedBy) &&\n      passedKillers.has(row.expectedKiller)";
const mutated = source.replace(guard, fault);
const applied = mutated !== source;
const scratch = mkdtempSync(join(tmpdir(), "foundation-v33-mutant-"));
let compiled = false;
let killed = false;
try {
  if (!applied) throw new Error("mutation target did not apply");
  const modulePath = join(scratch, "adapter-mutant.mjs");
  writeFileSync(modulePath, mutated);
  const runtime = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  compiled = true;
  const status = runtime.mutationV2Result({
    criticalCases: [{ id: "CASE-MUTANT-KILLER", status: "passed" }],
    mutants: [{
      id: "MUT-KILLER-BINDING", applied: true, compiled: true,
      result: "killed", killedBy: "WRONG-CASE"
    }]
  }, ["MUT-KILLER-BINDING"], {
    "MUT-KILLER-BINDING": "CASE-MUTANT-KILLER"
  }).status;
  assert.equal(status, "pass");
  killed = true;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/v33-mutation.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  criticalCases: [{
    id: "CASE-MUTANT-KILLER", status: killed ? "passed" : "failed"
  }],
  mutants: [{
    id: "MUT-KILLER-BINDING", applied, compiled,
    result: killed ? "killed" : "survived",
    killedBy: killed ? "CASE-MUTANT-KILLER" : ""
  }]
}, null, 2)}\n`);
if (!applied || !compiled || !killed) process.exit(1);
process.stdout.write("PASS: mutation-v2 killer binding mutant was killed\n");
