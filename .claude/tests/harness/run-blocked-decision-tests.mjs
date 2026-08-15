// Terminal stops are the places a user is most likely to conclude the harness
// has no way forward, so the shape of a stop is a contract, not a formatting
// choice. These assertions pin it: two real options, a preserved pause, and a
// recommendation the stop actually offers.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlockedDecision } from "../../harness/runtime/core/blocked-decision.mjs";

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "harness");

class Blocked extends Error {}
const { blockedDecisionValue, blockWithDecision } = createBlockedDecision({
  fail(message) { throw new Blocked(message); }
});

const valid = {
  kind: "example",
  summary: "An example stop.",
  options: [
    { id: "fix", outcome: "Do the thing that resolves it." },
    { id: "pause", outcome: "Change nothing." }
  ],
  recommended: "fix"
};

const envelope = blockedDecisionValue("demo-change", "example-code", valid);
assert.equal(envelope.status, "BLOCKED");
assert.equal(envelope.code, "example-code");
assert.equal(envelope.changeId, "demo-change");
assert.equal(envelope.decision.recommended, "fix");

assert.throws(() => blockedDecisionValue("c", "one-option", {
  ...valid, options: [valid.options[0]]
}), /at least two options/);

assert.throws(() => blockedDecisionValue("c", "no-pause", {
  ...valid,
  options: [{ id: "fix", outcome: "x" }, { id: "retry", outcome: "y" }]
}), /'pause' outcome/);

assert.throws(() => blockedDecisionValue("c", "phantom-recommendation", {
  ...valid, recommended: "not-offered"
}), /recommends an option it does not offer/);

assert.throws(() => blockedDecisionValue("c", "duplicate", {
  ...valid, options: [...valid.options, { id: "pause", outcome: "again" }]
}), /repeats an option id/);

assert.throws(() => blockedDecisionValue("c", "unlabelled", {
  ...valid, options: [{ id: "fix" }, { id: "pause", outcome: "y" }]
}), /an id and an outcome per option/);

// A stop still refuses: the envelope informs, it does not soften the exit code.
assert.throws(() => blockWithDecision("c", "example-code", valid), Blocked);

// Every terminal stop in the runtime is registered here on purpose. Adding one
// without listing it means it shipped without anyone deciding what the exits
// are, which is the failure this whole contract exists to prevent.
const REGISTERED = new Set([
  "abandon-applied-workspace",
  "abandon-revert-failed",
  "apply-manual-recovery",
  "apply-pending-recovery",
  "budget-continuation-rejected",
  "budget-continuation-spent",
  "control-head-moved",
  "review-history-corrupt",
  "root-pointers-restaged"
]);

function harnessSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return harnessSources(path);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [path] : [];
  });
}

const found = new Set();
for (const path of harnessSources(HARNESS))
  for (const match of readFileSync(path, "utf8")
    .matchAll(/blockWithDecision\(\s*[A-Za-z0-9_.]+\s*,\s*"([a-z0-9-]+)"/g))
    found.add(match[1]);

assert.deepEqual([...found].sort(), [...REGISTERED].sort(),
  "every terminal stop must be registered with its exits");

console.log(`blocked decisions: ALL PASS (14/14 assertions, ${found.size} registered stops)`);
