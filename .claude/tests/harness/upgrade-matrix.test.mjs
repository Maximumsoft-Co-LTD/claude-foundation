import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareSemver, semverTuple, supportedTags } from "../../../scripts/release/upgrade-matrix.mjs";
import {
  projectUpgradeDiagnostics, upgradeCompatibilityDiagnostics
} from "../../harness/runtime/core/update-advisory.mjs";

test("upgrade policy selects every release from the supported minimum through current", () => {
  const tags = ["v3.4.10", "v3.2.18", "v3.3.0", "junk", "v3.2.19", "v3.4.11"];
  assert.deepEqual(supportedTags(tags, "3.2.19", "3.4.10"),
    ["v3.2.19", "v3.3.0", "v3.4.10"]);
});

test("project upgrade diagnostics read signed CI from the root repository catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-upgrade-diagnostics-"));
  try {
    mkdirSync(join(root, "openspec"), { recursive: true });
    writeFileSync(join(root, "foundation.json"), JSON.stringify({
      land: { riskBasedCi: true }
    }));
    writeFileSync(join(root, "openspec", "repositories.yaml"), JSON.stringify({
      repositories: [{ id: "root", ci: { issuers: {
        github: { algorithm: "ed25519", publicKey: "-----BEGIN PUBLIC KEY-----" }
      } } }]
    }));
    const diagnostics = projectUpgradeDiagnostics(root);
    assert.deepEqual(diagnostics.policyFindings, []);
    assert.equal(diagnostics.policyObservations[0].classification,
      "signed-ci-satisfies-policy");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("upgrade diagnostics honor signed CI and intentional policy acknowledgements", () => {
  const signed = upgradeCompatibilityDiagnostics({
    configuredPolicy: { land: { riskBasedCi: true } },
    signedCiConfigured: true
  });
  assert.deepEqual(signed.policyFindings, []);
  assert.equal(signed.policyObservations[0].classification,
    "signed-ci-satisfies-policy");

  const intentional = upgradeCompatibilityDiagnostics({
    configuredPolicy: {
      land: { riskBasedCi: true },
      upgradeAcknowledgements: {
        "land.riskBasedCi": { value: true, decisionRef: "decision-42" }
      }
    }
  });
  assert.deepEqual(intentional.policyFindings, []);
  assert.equal(intentional.policyObservations[0].classification, "intentional-policy");
  assert.equal(intentional.policyObservations[0].decisionRef, "decision-42");

  const unbound = upgradeCompatibilityDiagnostics({
    configuredPolicy: {
      land: { riskBasedCi: true },
      upgradeAcknowledgements: {
        "land.riskBasedCi": { value: false, decisionRef: "wrong-value" }
      }
    }
  });
  assert.equal(unbound.policyFindings.length, 1);

  const unsafeReference = upgradeCompatibilityDiagnostics({
    configuredPolicy: {
      land: { riskBasedCi: true },
      upgradeAcknowledgements: {
        "land.riskBasedCi": { value: true, decisionRef: "decision-42\nWARN forged" }
      }
    }
  });
  assert.equal(unsafeReference.policyObservations.length, 0);
  assert.equal(unsafeReference.policyFindings[0].classification,
    "historical-default-or-explicit-value-ambiguous");
});
