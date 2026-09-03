import assert from "node:assert/strict";
import test from "node:test";

import { compareSemver, semverTuple, supportedTags } from "../../../scripts/release/upgrade-matrix.mjs";
import {
  upgradeCompatibilityDiagnostics
} from "../../harness/runtime/core/update-advisory.mjs";

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

test("upgrade diagnostics preserve historical defaults and explain active-change effects", () => {
  const diagnostics = upgradeCompatibilityDiagnostics({
    previousVersion: "3.4.10",
    currentVersion: "3.4.10",
    configuredPolicy: { land: { riskBasedCi: true } },
    activeChanges: [{ id: "in-flight", status: "building" }]
  });
  assert.equal(diagnostics.blocking, false);
  assert.equal(diagnostics.policyFindings[0].code,
    "historical-default-land-risk-based-ci");
  assert.equal(diagnostics.policyFindings[0].changed, false);
  assert.match(diagnostics.policyFindings[0].recovery, /foundation\.json/);
  assert.deepEqual(diagnostics.activeChangeEffects[0].effects, [
    "state-and-agreement-preserved",
    "receipts-revalidated-against-current-protocols"
  ]);
  assert.match(diagnostics.activeChangeEffects[0].recovery,
    /change validate in-flight.*proof readiness in-flight/);
});
