import assert from "node:assert/strict";
import test from "node:test";

import { compareSemver, semverTuple, supportedTags } from "../../../scripts/release/upgrade-matrix.mjs";

test("upgrade policy selects every release from the supported minimum through current", () => {
  const tags = ["v3.4.10", "v3.2.18", "v3.3.0", "junk", "v3.2.19", "v3.4.11"];
  assert.deepEqual(supportedTags(tags, "3.2.19", "3.4.10"),
    ["v3.2.19", "v3.3.0", "v3.4.10"]);
});

test("semantic version comparison is numeric rather than lexical", () => {
  assert.deepEqual(semverTuple("v3.4.10"), [3, 4, 10]);
  assert.ok(compareSemver("v3.4.10", "v3.4.9") > 0);
  assert.throws(() => compareSemver("latest", "3.4.10"), /invalid semantic version/);
});
