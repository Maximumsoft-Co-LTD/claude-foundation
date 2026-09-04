import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REHEARSAL_EVIDENCE_PROTOCOL, rehearsalEvidence, rehearsalEvidenceIssues
} from "../../../scripts/release/rehearsal-evidence.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-release-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "release.yml"), "name: Release\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  return root;
}

test("release rehearsal evidence binds version, source, workflow and dependencies", (t) => {
  const root = fixture(t);
  const expected = rehearsalEvidence({
    root, candidateVersion: "3.5.6", sourceHead: "a".repeat(40)
  });
  assert.equal(expected.protocol, REHEARSAL_EVIDENCE_PROTOCOL);
  assert.equal(expected.source.workflowSha256.length, 64);
  assert.equal(expected.source.packageLockSha256.length, 64);
  assert.deepEqual(rehearsalEvidenceIssues(structuredClone(expected), expected), []);

  const wrongVersion = structuredClone(expected);
  wrongVersion.candidateVersion = "3.5.7";
  assert.match(rehearsalEvidenceIssues(wrongVersion, expected)[0], /candidateVersion/);

  const wrongWorkflow = structuredClone(expected);
  wrongWorkflow.source.workflowSha256 = "0".repeat(64);
  assert.ok(rehearsalEvidenceIssues(wrongWorkflow, expected)
    .some((issue) => issue.includes("workflowSha256")));

  const incomplete = structuredClone(expected);
  delete incomplete.checks.bottleRehearsal;
  assert.ok(rehearsalEvidenceIssues(incomplete, expected)
    .some((issue) => issue.includes("checks.bottleRehearsal")));
});

test("release rehearsal evidence rejects ambiguous identities", (t) => {
  const root = fixture(t);
  assert.throws(() => rehearsalEvidence({
    root, candidateVersion: "v3.5.6", sourceHead: "a".repeat(40)
  }), /X\.Y\.Z/);
  assert.throws(() => rehearsalEvidence({
    root, candidateVersion: "3.5.6", sourceHead: "short"
  }), /full hexadecimal commit id/);
});
