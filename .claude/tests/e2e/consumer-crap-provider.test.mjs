import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverNodeTestFiles } from "./consumer-crap-provider.mjs";

test("consumer CRAP provider discovers root and nested Node tests", () => {
  const root = mkdtempSync(join(tmpdir(), "consumer-crap-provider-"));
  try {
    mkdirSync(join(root, "test"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "window.test.js"), "");
    writeFileSync(join(root, "test", "nested.spec.mjs"), "");
    writeFileSync(join(root, "src", "app.js"), "");
    assert.deepEqual(discoverNodeTestFiles(root), ["test/nested.spec.mjs", "window.test.js"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
