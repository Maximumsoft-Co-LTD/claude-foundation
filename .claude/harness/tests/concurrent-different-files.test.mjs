import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  agentEdit, append, assertArchived, buildChange, cleanup, landTrail, proveChange, runtimeText,
  startChange, world
} from "./fixtures/concurrent-changes.mjs";

// Scenario 1 of the concurrent-change proof: three changes started from one
// base on different files are built together, proved, and landed in a
// different order (bravo, alpha, charlie). Nothing waits for anything else.
test("three changes on different files build together and land in any order", () => {
  const w = world();
  try {
    const labels = ["alpha", "bravo", "charlie"];
    for (const label of labels) startChange(w, label, [`src/${label}.txt`]);
    // Build is not serialized: all three sandboxes exist at the same time.
    const sandboxes = Object.fromEntries(labels.map((label) => [label, buildChange(w, label)]));
    assert.equal(new Set(Object.values(sandboxes)).size, 3, "one sandbox per change");
    for (const sandbox of Object.values(sandboxes)) assert.ok(existsSync(sandbox));
    for (const label of labels)
      agentEdit(sandboxes[label], label, { [`src/${label}.txt`]: append(`${label}-edit`) });
    for (const label of labels) proveChange(w, label);
    for (const label of ["bravo", "alpha", "charlie"])
      assertArchived(w, label, landTrail(w, label));
    for (const label of labels)
      assert.match(w.read(`src/${label}.txt`), new RegExp(`${label}-edit`));

    // No cross-change state: each change owns its runtime record, sandbox, and
    // receipts, and its receipts never name another change. (The runtime
    // record's target manifest lists every packet in the checkout by design.)
    const receipts = readdirSync(join(w.project, ".foundation/receipts"));
    for (const label of labels) {
      assert.ok(receipts.includes(w.ids[label]), `${label} has its own receipts`);
      assert.equal(JSON.parse(runtimeText(w, label)).workspace.path, sandboxes[label]);
      const dir = join(w.project, ".foundation/receipts", w.ids[label]);
      const text = readdirSync(dir).map((file) => readFileSync(join(dir, file), "utf8")).join("\n");
      for (const other of labels.filter((candidate) => candidate !== label))
        assert.ok(!text.includes(w.ids[other]), `${label} receipts never reference ${other}`);
    }
    // Work scales linearly: start, build, prove, and Land are one operation each
    // per change, with no retries and nothing extra for being concurrent.
    assert.deepEqual(w.operations.byChange, { "-": 3, alpha: 3, bravo: 3, charlie: 3 });
    assert.equal(w.operations.count, 4 * labels.length);
  } finally { cleanup(w); }
});
