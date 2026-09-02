import assert from "node:assert/strict";
import test from "node:test";

import { REQUIRED_ARCHIVE_PATHS, rehearsalStatus,
  unsafeEnvironmentPaths } from "../../../scripts/release/local-rehearsal.mjs";

test("local release rehearsal requires runtime, installer, formula, and site sources", () => {
  for (const path of ["VERSION", "install.sh", "cli.sh", ".claude/harness/foundation.mjs",
    "Formula/claude-foundation.rb", "website/docs/package.json"])
    assert.ok(REQUIRED_ARCHIVE_PATHS.includes(path), path);
});

test("optional unavailable host tooling is distinct from a failed required check", () => {
  assert.equal(rehearsalStatus({ archive: { status: "pass" },
    brew: { status: "unavailable", required: false } }), "pass");
  assert.equal(rehearsalStatus({ archive: { status: "fail" },
    brew: { status: "pass", required: false } }), "fail");
});

test("archive intake permits examples but rejects environment payloads", () => {
  assert.deepEqual(unsafeEnvironmentPaths([
    "dashboard/.env.example", ".env", "app/.env.local", "src/app.js"
  ]), [".env", "app/.env.local"]);
});
