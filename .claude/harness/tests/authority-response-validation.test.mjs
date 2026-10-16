import assert from "node:assert/strict";
import test from "node:test";
import {
  authorityResponseProblems,
  authorityStatusValue,
  createAuthorityStore,
  normalizeAuthorityEvidence,
  validateAuthorityResponseOperation
} from "../runtime/workflow/authority.mjs";
import {
  authorityResponsePreflightIssues, authorityResponseTemplate, reviewFindingResponseEvidence
} from "../runtime/workflow/authority-runtime.mjs";

// One record run reports every problem it can decide, not one per attempt.
test("authority record preflight reports every response problem together", () => {
  const delta = { requestId: "r-1", changeId: "c", type: "review", reviewCircuit: "full-delta",
    status: "requested", packet: { closureFindings: { ids: ["F1", "F2"] } } };
  const issues = authorityResponsePreflightIssues({
    request: delta, undispatched: true, referenceExists: () => false,
    response: { status: "pass", evidence: {
      reference: ["notes/review.md", "https://example.test/pr/1"],
      "subject-model": "claude-opus-5-5", "verified-findings": 0, verifiedFindingIds: ["F1"]
    } }
  });
  for (const pattern of [/authority dispatch c --request r-1/, /notes\/review\.md/, /subject-actor/,
    /subject-session/, /verified-findings \(0\) must equal the 1 verifiedFindingIds/,
    /close exactly the first-round findings: F1, F2/])
    assert.ok(issues.some((issue) => pattern.test(issue)), `${pattern}: ${issues.join(" | ")}`);
  assert.equal(issues.some((issue) => /example\.test/.test(issue)), false, "a URI reference is fine");
  // A complete human response for a dispatched request has nothing to report.
  assert.deepEqual(authorityResponsePreflightIssues({
    request: { ...delta, status: "dispatched" }, referenceExists: () => true,
    response: { status: "pass", evidence: { reference: ["tasks.md"], "subject-actor": "claude",
      "subject-session": "s-1", "subject-model": "m", "verified-findings": 2, verifiedFindingIds: ["F1", "F2"] } }
  }), []);
});

// The preflight never refuses a response the later validators accept.
test("authority record preflight accepts what the receipt validator accepts", () => {
  const full = { requestId: "r-2", changeId: "c", type: "review", reviewCircuit: "full-delta",
    status: "dispatched", dispatch: { scope: { mode: "full" } }, packet: {} };
  const check = (evidence, status = "pass", request = full) =>
    authorityResponsePreflightIssues({ request, referenceExists: () => false,
      response: { status, evidence } });
  // Several implementers are expressed only as subject-provenance.
  assert.deepEqual(check({ "subject-provenance": [{ actor: "a" }, { actor: "b" }] }), []);
  // An infrastructure error closes the attempt without receipt provenance or references.
  assert.deepEqual(check({ reference: ["missing.json"] }, "error"), []);
  // A full review with no finding rows binds no counts.
  assert.deepEqual(check({ "subject-actor": "a", "verified-findings": 3 }), []);
  // A delta scope still binds them.
  assert.ok(check({ "subject-actor": "a", "verified-findings": 3 }, "pass",
    { ...full, dispatch: { scope: { mode: "delta" } } })
    .some((issue) => /verified-findings \(3\) must equal the 0/.test(issue)));
});

test("a delta review template is recordable as given and names dispatch when needed", () => {
  const delta = { requestId: "r-1", changeId: "c", type: "review", reviewCircuit: "full-delta",
    status: "requested", packet: { closureFindings: { ids: ["F1"] } } };
  const evidence = reviewFindingResponseEvidence(delta);
  assert.equal(evidence["verified-findings"], 1);
  assert.deepEqual(evidence.verifiedFindingIds, ["F1"]);
  const context = { protocolVersion: 2, expandList: (value) => value || [], listCount: () => 0 };
  const template = authorityResponseTemplate(context, delta);
  assert.match(template.dispatchFirst, /claude-foundation authority dispatch c --request r-1/);
  const dispatched = authorityResponseTemplate(context, { ...delta, status: "dispatched" });
  assert.equal("dispatchFirst" in dispatched, false);
});

const request = {
  requestId: "request-1",
  type: "review",
  workspaceHash: "workspace-hash"
};

function response(overrides = {}) {
  return {
    version: 3,
    requestId: "request-1",
    changeId: "change",
    type: "review",
    workspaceHash: "workspace-hash",
    status: "pass",
    ...overrides
  };
}

test("response problem collector names every mismatched binding and status", () => {
  assert.deepEqual(authorityResponseProblems(response({
    version: 2,
    requestId: "wrong-request",
    changeId: "wrong-change",
    type: "acceptance",
    workspaceHash: "wrong-workspace",
    status: "approved"
  }), request, "change", "3"), [
    'version: expected "3", got "2"',
    'requestId: expected "request-1", got "wrong-request"',
    'changeId: expected "change", got "wrong-change"',
    'type: expected "review", got "acceptance"',
    'workspaceHash: expected "workspace-hash", got "wrong-workspace"',
    'status: expected one of pass|fail|inconclusive|error, got "approved"'
  ]);
});

test("missing response reports null values while numeric protocol versions normalize", () => {
  const problems = authorityResponseProblems(null, request, "change", "3");
  assert.equal(problems.length, 6);
  assert.match(problems[0], /version: expected "3", got ""/);
  assert.match(problems[1], /got null/);
  assert.deepEqual(authorityResponseProblems(response(), request, "change", "3"), []);
});

test("evidence normalization wraps only declared multi-value fields", () => {
  const original = {
    artifact: "report.json",
    artifacts: ["one", "two"],
    reference: "https://example.test/run",
    criterion: "criterion-a",
    "scope-path": "src/**",
    "subject-provenance": { kind: "diff" },
    observed: "all checks passed"
  };
  assert.deepEqual(normalizeAuthorityEvidence(original), {
    artifact: ["report.json"],
    artifacts: ["one", "two"],
    reference: ["https://example.test/run"],
    criterion: ["criterion-a"],
    "scope-path": ["src/**"],
    "subject-provenance": [{ kind: "diff" }],
    observed: "all checks passed"
  });
  assert.deepEqual(normalizeAuthorityEvidence(null), {});
  assert.deepEqual(normalizeAuthorityEvidence("invalid"), {});
  assert.equal(original.artifact, "report.json");
});

test("validation rejects the aggregate mismatch with stable prose", () => {
  const value = validateAuthorityResponseOperation({ protocolVersion: "3" },
    response({ requestId: null, status: null }), request, "change");
  assert.equal(value.valid, false);
  assert.match(value.reason, /^authority response does not match the request and workspace/);
  assert.match(value.reason, /requestId: expected "request-1", got null/);
  assert.match(value.reason, /status: expected one of pass\|fail\|inconclusive\|error, got null/);
});

test("validation accepts every response status and returns normalized evidence", () => {
  for (const status of ["pass", "fail", "inconclusive", "error"]) {
    const value = validateAuthorityResponseOperation({ protocolVersion: "3" }, response({
      status,
      evidence: { reference: "run-7", observed: status }
    }), request, "change");
    assert.deepEqual(value, {
      valid: true,
      status,
      evidence: { reference: ["run-7"], observed: status }
    });
  }
});

test("authority store exposes the decomposed validator without changing its contract", () => {
  const store = createAuthorityStore({
    root: "/authority",
    protocolVersion: "3",
    readJson: () => ({}),
    writeJson: () => {},
    now: () => "2026-08-26T00:00:00.000Z"
  });
  assert.equal(store.validateResponse(response(), request, "change").valid, true);
  assert.equal(store.validateResponse(response({ type: "acceptance" }),
    request, "change").valid, false);
});

test("open authority status distinguishes current, stale, and expired requests", () => {
  const future = "2999-01-01T00:00:00.000Z";
  const current = { value: { status: "requested", workspaceHash: "current", expiresAt: future } };
  assert.equal(authorityStatusValue(current, "current", null, () => 1).status, "requested");
  assert.equal(authorityStatusValue(current, "other", null,
    () => { throw new Error("a stale workspace must short-circuit expiry"); }).status, "stale");
  assert.equal(authorityStatusValue({
    value: { ...current.value, status: "pending", expiresAt: "2000-01-01T00:00:00.000Z" }
  }, "current", null, () => Date.now()).status, "expired");
  assert.equal(authorityStatusValue({ value: { ...current.value, status: "dispatched" } },
    "composite", () => "current", () => 1).status, "dispatched");
  assert.equal(current.value.status, "requested", "status reads must not mutate stored requests");
});

test("only a current unexpired stale request heals in memory", () => {
  const entry = { value: {
    status: "stale", workspaceHash: "repository-hash", expiresAt: "2999-01-01T00:00:00.000Z"
  } };
  assert.equal(authorityStatusValue(entry, "composite", () => "repository-hash", () => 1).status,
    "requested");
  assert.equal(authorityStatusValue(entry, "composite", null, () => 1).status, "stale");
  assert.equal(authorityStatusValue(entry, "composite", () => "other", () => 1).status, "stale");
  assert.equal(authorityStatusValue({
    value: { ...entry.value, expiresAt: "2000-01-01T00:00:00.000Z" }
  }, "composite", () => "repository-hash", Date.now).status, "stale");
  assert.equal(authorityStatusValue({ value: { ...entry.value, status: "completed" } },
    "composite", () => "repository-hash",
    () => { throw new Error("closed requests must not inspect expiry"); }).status, "completed");
});
