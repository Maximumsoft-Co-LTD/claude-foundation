import assert from "node:assert/strict";
import test from "node:test";
import {
  authorityClaimIds,
  authorityRequestPolicy,
  authorityRequestSelection,
  displayAuthorityRequest,
  newAuthorityRequestValue,
  pendingAuthorityRequest,
  requestAuthorityOperation
} from "../runtime/workflow/authority-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function selectionContext(overrides = {}) {
  return {
    validate: () => {},
    pendingTasks: () => [],
    authorityProvider: (_id, type, repository) => repository
      ? `${type}-${repository}` : type,
    requiredProviders: () => ["review", "acceptance", "review-api"],
    authorityWorkspaceHash: (_id, provider) => `hash:${provider}`,
    fail,
    ...overrides
  };
}

test("authority request selection validates type before lifecycle and pending work", () => {
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: assert.fail
  }), "c", {}), /type must be review\|acceptance/);
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: assert.fail
  }), "c", { type: "invalid" }), /type must be review\|acceptance/);
  const validated = [];
  assert.throws(() => authorityRequestSelection(selectionContext({
    validate: (...args) => validated.push(args),
    pendingTasks: () => [{ id: "T002" }, { id: "T001" }]
  }), "c", { type: "review" }), /T002, T001/);
  assert.deepEqual(validated, [["c", "active", { quiet: true }]]);
});

test("authority request selection resolves scoped and unscoped providers", () => {
  assert.deepEqual(authorityRequestSelection(selectionContext(), "c", {
    type: "review", repo: " api "
  }), {
    type: "review", repository: "api", provider: "review-api",
    workspaceHash: "hash:review-api"
  });
  assert.deepEqual(authorityRequestSelection(selectionContext(), "c", {
    type: "acceptance"
  }), {
    type: "acceptance", repository: null, provider: "acceptance",
    workspaceHash: "hash:acceptance"
  });
  assert.throws(() => authorityRequestSelection(selectionContext({
    authorityProvider: () => null
  }), "c", { type: "review", repo: "api" }), /no review provider scoped/);
  assert.throws(() => authorityRequestSelection(selectionContext({
    requiredProviders: () => []
  }), "c", { type: "acceptance" }), /does not require acceptance authority/);
});

test("pending authority lookup requires complete identity and an open status", () => {
  const selection = { type: "review", provider: "reviewer", workspaceHash: "hash" };
  const matching = { type: "review", provider: "reviewer", workspaceHash: "hash" };
  const entries = [
    { value: { ...matching, type: "acceptance", status: "requested" } },
    { value: { ...matching, provider: "other", status: "requested" } },
    { value: { ...matching, workspaceHash: "old", status: "requested" } },
    { value: { ...matching, status: "completed" } },
    { value: { ...matching, status: "pending", requestId: "open" } }
  ];
  assert.equal(pendingAuthorityRequest(entries, selection).requestId, "open");
  assert.equal(pendingAuthorityRequest(entries.slice(0, 4), selection), null);
  for (const status of ["requested", "dispatched", "pending"])
    assert.equal(pendingAuthorityRequest([{ value: { ...matching, status } }], selection).status,
      status);
});

test("authority request policy separates review circuit from human acceptance", () => {
  const context = {
    policy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
    reviewPolicy: (id) => ({ id, actor: "ai" }),
    resolvedAcceptance: (id) => ({ id, reason: "requested" })
  };
  assert.deepEqual(authorityRequestPolicy(context, "c", "review"), {
    reviewCircuit: "full-delta", requirements: { id: "c", actor: "ai" }
  });
  assert.deepEqual(authorityRequestPolicy(context, "c", "acceptance"), {
    reviewCircuit: null,
    requirements: { actor: "human", acceptance: { id: "c", reason: "requested" } }
  });
  assert.deepEqual(authorityClaimIds([{ id: "a" }, { id: "b" }]), ["a", "b"]);
});

function valueContext(type = "review") {
  const timestamps = [1000, 2000];
  return {
    protocolVersion: "3",
    authorityPacket: (id, requestType) => ({ id, type: requestType }),
    timestamp: () => timestamps.shift(),
    randomHex: () => "0123456789abcdef",
    claimsForProvider: () => [{ id: "claim-a" }, { id: "claim-b" }],
    canonicalPacketDigest: (packet) => `digest:${packet.type}`,
    now: () => "2026-08-26T00:00:00.000Z",
    policy: () => ({ workflow: { reviewCircuit: "full-delta" } }),
    reviewPolicy: () => ({ actor: "ai" }),
    resolvedAcceptance: () => ({ reason: `${type}-reason` })
  };
}

test("new authority request binds packet, claims, timing, and type policy", () => {
  const review = newAuthorityRequestValue(valueContext(), "change", {
    type: "review", provider: "reviewer", workspaceHash: "workspace"
  });
  assert.deepEqual(review, {
    version: 3,
    requestId: "review-1000-0123456789abcdef",
    changeId: "change", type: "review", provider: "reviewer",
    status: "requested", workspaceHash: "workspace",
    claimIds: ["claim-a", "claim-b"],
    packet: { id: "change", type: "review" },
    packetDigest: "digest:review",
    requestedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "1970-01-02T00:00:02.000Z",
    reviewCircuit: "full-delta", requirements: { actor: "ai" }
  });
  const acceptance = newAuthorityRequestValue(valueContext("acceptance"), "change", {
    type: "acceptance", provider: "human", workspaceHash: "workspace"
  });
  assert.equal(acceptance.reviewCircuit, null);
  assert.deepEqual(acceptance.requirements, {
    actor: "human", acceptance: { reason: "acceptance-reason" }
  });
});

test("authority display honors quiet mode and configured or default packet limits", () => {
  const rows = [];
  let policyCalls = 0;
  const context = {
    policy: () => { policyCalls += 1; return { execution: {} }; },
    displayValue: (request, limit) => ({ request, limit }),
    output: { log: (row) => rows.push(JSON.parse(row)) }
  };
  displayAuthorityRequest(context, { requestId: "quiet" }, true);
  assert.equal(policyCalls, 0);
  displayAuthorityRequest(context, { requestId: "shown" }, false);
  assert.equal(rows[0].limit, 8192);
  context.policy = () => ({ execution: { packetBytes: { review: 1234 } } });
  displayAuthorityRequest(context, { requestId: "custom" }, false);
  assert.equal(rows[1].limit, 1234);
});

function operationContext(entries = []) {
  const writes = [];
  const rows = [];
  return {
    ...selectionContext(),
    authorityStore: {
      list: () => entries,
      writeRequest: (id, request) => writes.push([id, request])
    },
    ...valueContext(),
    displayValue: (request) => request,
    output: { log: (row) => rows.push(JSON.parse(row)) },
    writes,
    rows
  };
}

test("authority operation reuses open requests and writes new requests once", () => {
  const existing = {
    type: "review", provider: "review", workspaceHash: "hash:review",
    status: "dispatched", requestId: "existing"
  };
  const reused = operationContext([{ value: existing }]);
  assert.equal(requestAuthorityOperation(reused, "c", { type: "review" }), existing);
  assert.equal(reused.writes.length, 0);
  assert.equal(reused.rows[0].requestId, "existing");

  const created = operationContext();
  const request = requestAuthorityOperation(created, "c", { type: "review" }, {
    quiet: true
  });
  assert.equal(created.writes.length, 1);
  assert.deepEqual(created.writes[0], ["c", request]);
  assert.equal(created.rows.length, 0);
});
