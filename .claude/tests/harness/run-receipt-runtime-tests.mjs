import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createReceiptRuntime, groundedRepairBinding, normalizedReviewFinding,
  proofPlanOperation, receiptBindingNote
} from "../../harness/runtime/evidence/receipt-runtime.mjs";

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };

function fixture(capability = "test", configPatch = {}, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "receipt-runtime-unit-"));
  const receipts = new Map();
  const config = {
    capability, adapter: "external", version: "2", inputMode: "dom-event",
    ...configPatch
  };
  const receiptPath = (id, provider) => join(root, id, `${provider}.json`);
  const runtime = createReceiptRuntime({
    ROOT: root,
    LOGS: join(root, "logs"),
    PROVIDERS: new Set(["test", "review", "acceptance", "browser", "discovery", "mutation"]),
    INPUT_MODES: new Set(["browser-automation", "dom-event", "os-input", "both"]),
    providerWorkspace: () => root,
    ADAPTER_PROTOCOL_VERSION: 3,
    PROVIDER_PROTOCOL_VERSION: 4,
    REVIEW_PROTOCOL_VERSION: 5,
    ACCEPTANCE_PROTOCOL_VERSION: 6,
    validate: () => {},
    relevantHash: () => "relevant-hash",
    requiredProviders: () => [],
    advisoryCapabilities: () => [],
    receiptValidity: () => ({ validity: "valid" }),
    now: () => "2026-08-25T00:00:00.000Z",
    writeJson: (path, value) => receipts.set(path, structuredClone(value)),
    receiptPath,
    providerConfig: () => config,
    providerCapability: (_provider, configured) => configured?.capability || null,
    loadRuntime: () => ({ activeProofRun: {
      id: "proof-run", workspaceHash: "run-hash", snapshotId: "snapshot"
    } }),
    resolvedAcceptance: () => ({ required: true, reason: "declared" }),
    evidence: () => ({ claims: [{ id: "claim-1" }, { id: "claim-2" }] }),
    claimsForProvider: () => [{ id: "claim-1" }],
    providerWorkspaceHash: () => "workspace-hash",
    providerRepository: () => ({ id: "root" }),
    providerRepositories: () => [{ id: "root" }],
    rejectPrototypeEvidenceInputs: () => {},
    durableArtifact: (_id, _provider, _run, artifact) => artifact,
    providerInputIdentity: () => ({ mode: "workspace", files: ["src/a.mjs"] }),
    contractFingerprint: () => "contract",
    executionFingerprint: () => "execution",
    stableHash,
    relevantSnapshot: () => ({ packetReviewHash: "packet" }),
    changeDiffIdentity: () => "diff",
    adapterFingerprint: () => "adapter",
    environmentDescriptor: () => ({ os: "test" }),
    reviewPolicy: () => ({ independence: "required", diversity: "required" }),
    subjectProvenance: () => [{ type: "human", identity: "implementer" }],
    reviewProvenanceResult: () => ({ complete: true, independent: true, diverse: true }),
    readJson: () => ({}),
    flagValues: (flags, key) => {
      const value = flags[key];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    },
    reviewHistoryState: () => ({ totalAttempts: 0 }),
    reserveReviewAttempt: () => ({ digest: "attempt" }),
    reviewAttemptByDigest: () => null,
    reviewAttemptIsValid: () => true,
    reviewReceiptBinding: () => ({}),
    recordRepairClosureAttempt: () => ({ digest: "closure" }),
    deliveredAiAttempts: () => [],
    foundationPolicy: () => ({ workflow: { reviewCircuit: "legacy" } }),
    die: fail,
    ...overrides
  });
  const recorded = (provider = "provider") => receipts.get(receiptPath("change", provider));
  return { runtime, config, recorded };
}

const externalEvidence = {
  observed: "verified behavior", source: "human:operator",
  reference: ["https://example.test/evidence"]
};

test("records manual and harness-executed receipts with durable evidence", () => {
  const manual = fixture();
  manual.runtime.recordReceipt("change", "provider", "pass", externalEvidence);
  assert.deepEqual(manual.recorded().claims, ["claim-1"]);
  assert.equal(manual.recorded().execution, "manual");
  assert.equal(manual.recorded().provenance.source, "human:operator");

  const executed = fixture();
  executed.runtime.recordReceipt("change", "provider", "pass", {
    artifact: [{ path: "run.log", type: "command-log", required: true }]
  }, { executed: true, quiet: true });
  assert.equal(executed.recorded().execution, "harness");
  assert.equal(executed.recorded().log, "run.log");

  const detailed = fixture();
  detailed.runtime.recordReceipt("change", "provider", "pass", {
    observed: "ran", source: "command:test", artifact: ["a.log,b.log"],
    artifacts: [{ path: "a.log", type: "external-evidence" }],
    log: "command.log", commandExecutionId: "execution-1", durationMs: "12",
    started: "2026-08-24T00:00:00.000Z"
  }, { executed: true });
  assert.equal(detailed.recorded().artifacts.length, 3);
  assert.equal(detailed.recorded().executionId, "execution-1");
  assert.equal(detailed.recorded().durationMs, 12);

  const unconfigured = fixture("test", {}, {
    providerConfig: () => null, providerCapability: () => "test"
  });
  unconfigured.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, adapter: "external", version: "9", environment: { os: "manual" }
  });
  assert.equal(typeof unconfigured.recorded().providerFingerprint, "string");
  assert.deepEqual(unconfigured.recorded().environment, { os: "manual" });
});

test("explains receipt bindings and renders complete proof plans", () => {
  const configs = {
    review: { capability: "review" },
    declared: { capability: "test", inputs: ["src/**", "test/**"] },
    workspace: { capability: "test" }
  };
  const context = {
    providerConfig: (_id, provider) => configs[provider],
    providerCapability: (_provider, config) => config.capability
  };
  assert.equal(receiptBindingNote(context, "change", "review", "stale"),
    "review is bound to the change's diff and packet; a clean replay onto a moved base " +
    "rebinds it without a new verdict");
  assert.equal(receiptBindingNote(context, "change", "declared", "stale"),
    "declared inputs: src/**, test/**");
  assert.equal(receiptBindingNote(context, "change", "declared", "reusable-inputs"),
    "declared inputs: src/**, test/**; unchanged inputs will be rebound without re-execution");
  assert.equal(receiptBindingNote(context, "change", "workspace", "stale"),
    "whole-workspace binding; declare inputs to narrow it");
  assert.equal(receiptBindingNote(context, "change", "review", "valid"), null);
  assert.equal(receiptBindingNote(context, "change", "review", "missing"), null);

  const calls = [];
  proofPlanOperation({
    ...context,
    validate: (...args) => calls.push(["validate", ...args]),
    relevantHash: () => "workspace-hash",
    requiredProviders: () => ["review", "declared"],
    receiptValidity: (_id, provider) => ({
      provider, validity: provider === "review" ? "valid" : "reusable-inputs"
    }),
    advisoryCapabilities: () => [
      { capability: "supply-chain", trigger: "lockfile" },
      { capability: "accessibility" }
    ],
    log: (message) => calls.push(["log", message])
  }, "change");
  assert.deepEqual(calls[0], ["validate", "change", "active", { quiet: true }]);
  assert.ok(calls.some((entry) => entry[1] === "  review: valid"));
  assert.ok(calls.some((entry) => entry[1].includes("unchanged inputs will be rebound")));
  assert.ok(calls.some((entry) => entry[1].includes("inferred from lockfile")));
  assert.ok(calls.some((entry) => entry[1].includes("inferred from the changed surface")));
});

test("rebinds reusable and diff-bound receipts without rewriting review identity", () => {
  const reusable = fixture();
  reusable.runtime.rebindReusableReceipt("change", {
    provider: "provider",
    expectedWorkspaceHash: "workspace-next",
    expectedInputs: { fingerprint: "inputs-next" },
    receipt: {
      workspaceHash: "workspace-prior", workspaceSnapshotId: "snapshot-prior",
      proofRunId: "proof-prior", finishedAt: "finished-prior"
    }
  }, { id: "snapshot-next" }, "proof-next");
  assert.deepEqual(reusable.recorded().reusedFrom, {
    proofRunId: "proof-prior",
    workspaceHash: "workspace-prior",
    workspaceSnapshotId: "snapshot-prior",
    receiptFinishedAt: "finished-prior"
  });
  assert.equal(reusable.recorded().workspaceSnapshotId, "snapshot-next");
  assert.equal(reusable.recorded().inputIdentity.fingerprint, "inputs-next");

  const firstReusable = fixture();
  firstReusable.runtime.rebindReusableReceipt("change", {
    provider: "provider", expectedWorkspaceHash: "workspace-next",
    expectedInputs: { fingerprint: "inputs-next" },
    receipt: { workspaceHash: "workspace-prior" }
  }, { id: "snapshot-next" }, "proof-next");
  assert.deepEqual(firstReusable.recorded().reusedFrom, {
    proofRunId: null, workspaceHash: "workspace-prior",
    workspaceSnapshotId: null, receiptFinishedAt: null
  });

  const diff = fixture();
  diff.runtime.rebindDiffBoundReceipt("change", {
    provider: "provider", expectedWorkspaceHash: "workspace-next",
    receipt: {
      workspaceHash: "workspace-original", proofRunId: "proof-prior",
      rebind: { boundWorkspaceHash: "workspace-bound", diffIdentity: "diff-prior" }
    }
  }, { id: "snapshot-next" }, "proof-next");
  assert.equal(diff.recorded().workspaceHash, "workspace-original");
  assert.deepEqual(diff.recorded().rebind.reboundFrom, {
    workspaceHash: "workspace-bound", proofRunId: "proof-prior"
  });
  assert.equal(diff.recorded().rebind.boundWorkspaceHash, "workspace-next");

  const firstDiff = fixture();
  firstDiff.runtime.rebindDiffBoundReceipt("change", {
    provider: "provider", expectedWorkspaceHash: "workspace-next",
    receipt: { workspaceHash: "workspace-original" }
  }, { id: "snapshot-next" }, "proof-next");
  assert.deepEqual(firstDiff.recorded().rebind.reboundFrom, {
    workspaceHash: "workspace-original", proofRunId: null
  });
});

test("normalizes review findings and derives only fully grounded repair bindings", () => {
  assert.deepEqual(normalizedReviewFinding({
    id: " F-2 ", severity: "MAJOR", path: "src/a.mjs", line: "7",
    message: " fix ", claimIds: [" claim-b ", "claim-a", "claim-a", ""],
    verificationCaseIds: [" case-b ", "case-a", "case-a", ""]
  }), {
    id: "F-2", severity: "major", path: "src/a.mjs", line: 7, message: "fix",
    claimIds: ["claim-a", "claim-b"], verificationCaseIds: ["case-a", "case-b"]
  });
  assert.deepEqual(normalizedReviewFinding(), {
    id: "", severity: "", path: "", line: null, message: "",
    claimIds: [], verificationCaseIds: []
  });
  assert.equal(normalizedReviewFinding({ line: null }).line, null);

  const grounding = {
    version: 2,
    claims: [
      { id: "claim-b", productionPath: [{ repository: "repo", path: "src/a.mjs" }] },
      { id: "claim-a", failurePaths: [{ path: "src/a.mjs" }] },
      { productionPath: [{ path: "src/a.mjs" }] }
    ],
    criticalCases: [
      { id: "case-b", claimIds: ["claim-b"] },
      { id: "case-a", claimIds: ["claim-b"] },
      { claimIds: ["claim-b"] }
    ]
  };
  assert.equal(groundedRepairBinding(null, { path: "src/a.mjs" }), null);
  assert.equal(groundedRepairBinding({ version: 1 }, { path: "src/a.mjs" }), null);
  assert.equal(groundedRepairBinding(grounding, {}), null);
  assert.deepEqual(groundedRepairBinding(grounding, { path: "./repo/src/a.mjs" }), {
    claimIds: ["claim-b"], verificationCaseIds: ["case-a", "case-b"],
    source: "grounding-v2-path"
  });
  assert.equal(groundedRepairBinding(grounding, { path: "missing.mjs" }), null);
  assert.equal(groundedRepairBinding({ ...grounding, criticalCases: [] }, {
    path: "repo/src/a.mjs"
  }), null);
});

test("rejects invalid identity, claims, execution assertions, and evidence", () => {
  assert.throws(() => fixture("test", {}, { providerCapability: () => null }).runtime
    .recordReceipt("change", "provider", "pass", externalEvidence), /unknown provider/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "unknown"),
    /invalid receipt status/);
  assert.throws(() => fixture("test", {}, { claimsForProvider: () => [] }).runtime
    .recordReceipt("change", "provider", "pass", externalEvidence), /no declared claims/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, claims: "missing"
  }), /unknown claim/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, claims: "claim-2"
  }), /not declared/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass", {
    adapter: "command", ...externalEvidence
  }), /hand-recorded receipt/);
  assert.throws(() => fixture("test", { adapter: "command" }).runtime
    .recordReceipt("change", "provider", "pass", externalEvidence), /must come from an execution/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass"),
    /missing:/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass", {}, {
    executed: true
  }), /must carry its command log/);
  assert.throws(() => fixture("test", {}, {
    providerInputIdentity: () => ({ mode: "declared", files: [] })
  }).runtime.recordReceipt("change", "provider", "pass", externalEvidence), /matched no files/);
  assert.throws(() => fixture().runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, reference: ["missing-local-evidence.txt"]
  }), /resolve to nothing/);
});

test("enforces browser, discovery, and mutation capability contracts", () => {
  const browser = fixture("browser", { inputMode: "os-input" });
  assert.throws(() => browser.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, "foreground-required": "yes", "foreground-available": "no"
  }), /foreground input is unavailable/);
  browser.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, "foreground-required": "yes", "foreground-available": "yes"
  });
  assert.equal(browser.recorded().capability.inputMode, "os-input");
  assert.throws(() => fixture("browser", { inputMode: "invalid" }).runtime.recordReceipt(
    "change", "provider", "pass", externalEvidence
  ), /requires --input-mode/);
  assert.throws(() => fixture("browser", { inputMode: "os-input" }).runtime.recordReceipt(
    "change", "provider", "pass", externalEvidence
  ), /requires foreground-required=yes/);

  assert.throws(() => fixture("discovery").runtime.recordReceipt(
    "change", "provider", "pass", { ...externalEvidence, discovered: 1, minimum: 2 }
  ), /passing discovery receipt/);
  const discovery = fixture("discovery");
  discovery.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, discovered: 3, minimum: 2
  });
  assert.deepEqual(discovery.recorded().discovery, { discovered: 3, minimum: 2 });
  const failedDiscovery = fixture("discovery");
  failedDiscovery.runtime.recordReceipt("change", "provider", "fail", {});
  assert.equal(failedDiscovery.recorded().discovery, undefined);

  assert.throws(() => fixture("mutation").runtime.recordReceipt(
    "change", "provider", "pass", { ...externalEvidence, classification: "crash" }
  ), /crash is not a kill/);
  const mutation = fixture("mutation");
  mutation.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence, classification: "behavioral-kill"
  });
  assert.equal(mutation.recorded().classification, "behavioral-kill");
  const failedMutation = fixture("mutation");
  failedMutation.runtime.recordReceipt("change", "provider", "fail", {});
  assert.equal(failedMutation.recorded().classification, null);
});

test("records structured acceptance and review receipts", () => {
  const acceptance = fixture("acceptance");
  acceptance.runtime.recordReceipt("change", "provider", "pass", {
    observed: "accepted", acceptor: "product-owner", decision: "accept",
    criterion: ["criterion-a"], reference: ["https://example.test/acceptance"]
  });
  assert.equal(acceptance.recorded().acceptance.actor.identity, "product-owner");
  assert.equal(acceptance.recorded().provenance.source, "human:product-owner");

  const review = fixture("review");
  review.runtime.recordReceipt("change", "provider", "pass", {
    ...externalEvidence,
    "reviewer-type": "human", "reviewer-identity": "independent-reviewer",
    "unresolved-blockers": 0, "verified-findings": 0
  });
  assert.equal(review.recorded().review.reviewer.identity, "independent-reviewer");
  assert.equal(review.recorded().review.attemptDigest, "attempt");
});

test("rejects incomplete acceptance and undeclared acceptance", () => {
  assert.throws(() => fixture("acceptance", {}, {
    resolvedAcceptance: () => ({ required: false })
  }).runtime.recordReceipt("change", "provider", "pass", externalEvidence),
  /not declared/);
  assert.throws(() => fixture("acceptance").runtime.recordReceipt(
    "change", "provider", "pass", {
      observed: "checked", acceptor: "owner", decision: "reject",
      criterion: ["duplicate", "duplicate"], reference: ["https://example.test/a"]
    }
  ), /passing acceptance is missing/);
  for (const patch of [
    { acceptor: "", decision: "accept", criterion: ["criterion"] },
    { acceptor: "owner", decision: "reject", criterion: ["criterion"] },
    { acceptor: "owner", decision: "accept", criterion: [] },
    { acceptor: "owner", decision: "accept", criterion: [""] }
  ]) assert.throws(() => fixture("acceptance").runtime.recordReceipt(
    "change", "provider", "pass", {
      ...externalEvidence, ...patch
    }
  ), /passing acceptance is missing/);
  const failed = fixture("acceptance");
  failed.runtime.recordReceipt("change", "provider", "fail", {});
  assert.equal(failed.recorded().acceptance.actor.identity, null);
  assert.equal(failed.recorded().acceptance.decision, null);
});

const humanReview = {
  ...externalEvidence,
  "reviewer-type": "human", "reviewer-identity": "reviewer",
  "unresolved-blockers": 0, "verified-findings": 0
};
const aiReview = {
  ...humanReview,
  "reviewer-type": "ai", "reviewer-provider-family": "openai",
  "reviewer-model-family": "gpt", "reviewer-model": "gpt-review",
  "reviewer-session": "session"
};

test("review identity and provenance validation fail closed", () => {
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", { ...externalEvidence, "unresolved-blockers": 0 }
  ), /reviewer-type/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", { ...humanReview, "reviewer-identity": "" }
  ), /reviewer-identity/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", {
      ...aiReview, "reviewer-provider-family": "", "reviewer-session": ""
    }
  ), /provider\/model family/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", { ...aiReview, "reviewer-session": "" }
  ), /actual reviewer session/);
  assert.throws(() => fixture("review", {}, { subjectProvenance: () => [] }).runtime
    .recordReceipt("change", "provider", "pass", humanReview), /implementation provenance/);
  assert.throws(() => fixture("review", {}, {
    reviewProvenanceResult: () => ({ complete: false })
  }).runtime.recordReceipt("change", "provider", "pass", humanReview), /complete structured/);
  assert.throws(() => fixture("review", {}, {
    reviewProvenanceResult: () => ({ complete: true, independent: false, diverse: true })
  }).runtime.recordReceipt("change", "provider", "pass", humanReview), /must use an identity/);
  assert.throws(() => fixture("review", {}, {
    reviewProvenanceResult: () => ({ complete: true, independent: true, diverse: false })
  }).runtime.recordReceipt("change", "provider", "pass", humanReview), /different provider/);
});

test("review findings, dispatch scope, and attempt binding are validated", () => {
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", { ...humanReview, "unresolved-blockers": undefined }
  ), /requires --unresolved-blockers/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "fail", { ...humanReview, "unresolved-blockers": -1 }
  ), /non-negative integers/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", { ...humanReview, "unresolved-blockers": 1 }
  ), /cannot contain unresolved blockers/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "fail", {
      ...humanReview, findings: [{ id: "bad", severity: "note", message: "bad" }]
    }
  ), /unique IDs/);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "fail", {
      ...humanReview, findings: [{ id: "major-1", severity: "major", message: "fix" }]
    }
  ), /counts must equal/);
  const failedWithFinding = fixture("review");
  failedWithFinding.runtime.recordReceipt("change", "provider", "fail", {
    ...humanReview, "unresolved-blockers": 1,
    findings: [{
      id: "major-1", severity: "MAJOR", path: "src/a.mjs", line: 7,
      message: "fix this", claimIds: ["claim-1", "claim-1"],
      verificationCaseIds: ["case-1", "case-1"]
    }]
  });
  assert.deepEqual(failedWithFinding.recorded().review.findings.unresolvedIds, ["major-1"]);
  assert.deepEqual(failedWithFinding.recorded().review.findings.items[0].claimIds, ["claim-1"]);
  assert.throws(() => fixture("review").runtime.recordReceipt(
    "change", "provider", "pass", humanReview, { reviewCircuit: "full-delta" }
  ), /authority dispatch attempt/);

  const dispatched = {
    digest: "dispatch-attempt", attempt: 2, requestId: "request", packetDigest: "packet",
    scope: { mode: "delta", baseAttemptDigest: "base", digest: "scope" }
  };
  assert.throws(() => fixture("review", {}, {
    reviewAttemptByDigest: () => dispatched
  }).runtime.recordReceipt("change", "provider", "pass", aiReview, {
    reviewCircuit: "full-delta"
  }), /requires at least one scope-path/);

  const valid = fixture("review", {}, { reviewAttemptByDigest: () => dispatched });
  valid.runtime.recordReceipt("change", "provider", "pass", {
    ...aiReview, "scope-path": ["src/a.mjs"]
  }, { reviewCircuit: "full-delta" });
  assert.equal(valid.recorded().review.scope.mode, "delta");
  assert.equal(valid.recorded().review.requestId, "request");

  assert.throws(() => fixture("review", {}, { reviewAttemptIsValid: () => false }).runtime
    .recordReceipt("change", "provider", "pass", humanReview), /does not match/);
});
