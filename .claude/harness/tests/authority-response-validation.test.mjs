import assert from "node:assert/strict";
import test from "node:test";
import {
  authorityResponseProblems,
  createAuthorityStore,
  normalizeAuthorityEvidence,
  validateAuthorityResponseOperation
} from "../runtime/workflow/authority.mjs";

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
