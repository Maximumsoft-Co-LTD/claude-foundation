import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  configDigest, crapScore, mutationSummary, normalizeCrapReport,
  normalizeMutationReport, validateCapabilityReport
} from "../../harness/runtime/quality/quality-protocol.mjs";
import {
  capabilityNamesForProfiles, languagesForProfiles, profilesForInventory,
  validateProfiles
} from "../../harness/runtime/quality/language-profiles.mjs";

const tool = {
  name: "fixture", version: "1", adapterVersion: "1",
  configDigest: configDigest({ fixture: true })
};

assert.equal(crapScore(10, 100), 10);
assert.equal(crapScore(10, 0), 110);
assert.equal(configDigest({ b: 2, a: 1 }), configDigest({ a: 1, b: 2 }));

assert.deepEqual(profilesForInventory({
  files: ["package.json", "services/api/go.mod"], extensions: [".tsx", ".sql", ".scss"]
}), ["application-go", "application-js-ts", "database-sql", "web-style"]);
assert.deepEqual(profilesForInventory({
  files: ["pyproject.toml", "composer.json"],
  extensions: [".py", ".php", ".sh", ".sql", ".html", ".css", ".sass"]
}), ["application-php", "application-python", "database-sql", "script-bash", "web-markup", "web-style"]);
assert.deepEqual(languagesForProfiles(["application-js-ts", "web-style"]),
  ["css", "javascript", "sass", "typescript"]);
assert.ok(capabilityNamesForProfiles(["application-go"]).includes("crap"));
assert.throws(() => validateProfiles(["unknown"]), /unknown quality profile/);

validateCapabilityReport({
  protocol: "foundation-quality-capabilities-v1",
  repository: "root", languages: ["typescript"], profiles: ["application-js-ts"],
  capabilities: {
    crap: { status: "available", adapter: "js-ts" },
    performance: { status: "not-applicable", reason: "not required for this surface" }
  }
});
assert.throws(() => validateCapabilityReport({
  protocol: "foundation-quality-capabilities-v1",
  repository: "root", languages: [], profiles: [],
  capabilities: { crap: { status: "unsupported" } }
}), /requires a reason/);

const crap = normalizeCrapReport({
  protocol: "foundation-crap-v1", repository: "root", repositoryCommit: null,
  workspaceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  language: "typescript", tool,
  functions: [{
    id: "authorize", path: "src/auth.ts", line: 1, endLine: 4,
    complexity: 10, coverageKind: "branch", coveragePercent: 50,
    crap: 999, mapping: "exact"
  }]
});
assert.equal(crap.functions[0].crap, 22.5, "Harness owns the CRAP formula");
assert.throws(() => normalizeCrapReport({
  ...crap, functions: [{ ...crap.functions[0], coveragePercent: null, mapping: "exact" }]
}), /must use mapping 'unmapped'/);

const mutation = normalizeMutationReport({
  protocol: "foundation-automated-mutation-v1", repository: "root",
  repositoryCommit: null,
  workspaceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  language: "typescript", tool,
  mutants: [
    { id: "m1", path: "src/auth.ts", line: 1, operator: "condition",
      status: "killed", killedBy: ["case-1"], changedSurface: "changed-relevant" },
    { id: "m2", path: "src/legacy.ts", line: 1, operator: "condition",
      status: "survived", killedBy: [], changedSurface: "legacy-unrelated" }
  ]
});
assert.deepEqual(mutationSummary(mutation), {
  total: 1, killed: 1, survived: 0, noCoverage: 0, timeout: 0,
  compileError: 0, runtimeError: 0, unavailable: 0, score: 100
});
assert.throws(() => normalizeMutationReport({
  ...mutation,
  mutants: [{ ...mutation.mutants[1], status: "survived", killedBy: ["case-1"] }]
}), /not killed but declares killers/);
assert.throws(() => normalizeMutationReport({
  ...mutation,
  mutants: [{ ...mutation.mutants[1], status: "ignored-equivalent" }]
}), /requires a reason/);

const fixture = (name) => JSON.parse(readFileSync(new URL(
  `../../harness/tests/fixtures/quality/protocol/${name}`, import.meta.url), "utf8"));
assert.equal(normalizeCrapReport(fixture("crap-valid.json")).functions[0].crap, 1);
assert.equal(normalizeMutationReport(fixture("mutation-valid.json")).mutants[0].status, "killed");

console.log("quality protocol tests: ok");
