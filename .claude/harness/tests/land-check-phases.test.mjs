import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agreementIdentity, assertSpecApproval } from "../runtime/core/user-decisions.mjs";
import { automaticRecoveryAction } from "../runtime/workflow/advance-recovery.mjs";
import {
  advanceLandOperation, createLandRuntime, landTransactionStarted
} from "../runtime/workflow/land-runtime.mjs";

const HASH = "workspacehash0000000000000000000000000000000000000000000000000000";

test("land advance handles single repositories and multi-repository resume states", async () => {
  const calls = [];
  const dependencies = (states, plan = {}, selected = [{ id: "root" }]) => ({
    loadRuntime: () => states.shift(),
    selectedRepositories: () => selected,
    landCheck: (id) => calls.push(["check", id]),
    archive: (id) => calls.push(["archive", id]),
    resumeLand: (id) => calls.push(["resume", id]),
    landPlanValue: (id) => { calls.push(["plan", id]); return plan; }
  });

  await advanceLandOperation(dependencies([{ repositories: {} }]), "single");
  assert.deepEqual(calls.splice(0), [["archive", "single"]]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "building" }
  ], {}, [{ id: "root" }, { id: "api" }]), "building");
  assert.deepEqual(calls.splice(0), [
    ["plan", "building"], ["resume", "building"], ["plan", "building"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "proven" }
  ], { readyToArchive: false }, [{ id: "root" }, { id: "api" }]), "waiting");
  assert.deepEqual(calls.splice(0), [
    ["plan", "waiting"], ["resume", "waiting"], ["plan", "waiting"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "proven" }
  ], { readyToArchive: true }, [{ id: "root" }, { id: "api" }]), "ready");
  assert.deepEqual(calls.splice(0), [
    ["plan", "ready"], ["resume", "ready"], ["plan", "ready"],
    ["archive", "ready"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { api: {} } }, { status: "proven" }
  ], { readyToArchive: true }, [{ id: "api" }]), "single-child");
  assert.deepEqual(calls.slice(-4), [
    ["plan", "single-child"], ["resume", "single-child"],
    ["plan", "single-child"], ["archive", "single-child"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }
  ], { strategy: "workspace-uncommitted" }, [
    { id: "root" }, { id: "api" }
  ]), "local-saga");
  assert.deepEqual(calls.slice(-2), [
    ["plan", "local-saga"], ["archive", "local-saga"]
  ]);
});

test("land advance automatically re-enters an interrupted internal transaction", async () => {
  let state = { status: "proven", repositories: {} };
  let archiveCalls = 0;
  const result = await advanceLandOperation({
    loadRuntime: () => state,
    selectedRepositories: () => [{ id: "root" }],
    landCheck: () => ({ archived: false }),
    landPlanValue: () => ({}),
    resumeLand: () => null,
    archive: () => {
      archiveCalls += 1;
      if (archiveCalls === 1) {
        state = { ...state, workspace: { applied: true }, land: { status: "code-applied" } };
        throw new Error("interrupted after Apply");
      }
      return { status: "ARCHIVED", archived: true };
    }
  }, "automatic-recovery");
  assert.equal(archiveCalls, 2);
  assert.equal(result.archived, true);
});

test("land automatic re-entry is limited to a started transaction", async () => {
  let archiveCalls = 0;
  await assert.rejects(() => advanceLandOperation({
    loadRuntime: () => ({ status: "proven", repositories: {} }),
    selectedRepositories: () => [{ id: "root" }],
    landCheck: () => ({ archived: false }),
    landPlanValue: () => ({}),
    resumeLand: () => null,
    archive: () => {
      archiveCalls += 1;
      throw new Error("readiness failed before mutation");
    }
  }, "pre-transaction-failure"), /readiness failed/);
  assert.equal(archiveCalls, 1);
  assert.equal(landTransactionStarted({ workspace: { applied: true } }), true);
  assert.equal(landTransactionStarted({ land: { status: "archive-prepared" } }), true);
  assert.equal(landTransactionStarted({ status: "proven" }), false);
});

test("land check phases preserve every refusal and ready route", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-check-phases-"));
  const bin = join(root, "bin");
  const proofs = join(root, "proofs");
  const receipts = join(root, "receipts");
  mkdirSync(bin, { recursive: true });
  mkdirSync(proofs, { recursive: true });
  mkdirSync(receipts, { recursive: true });
  writeFileSync(join(bin, "openspec"), "#!/bin/sh\nprintf '1.7.0\\n'\n");
  chmodSync(join(bin, "openspec"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  let sequence = 0;

  const make = (options = {}) => {
    sequence += 1;
    const id = `land-${sequence}`;
    const providers = options.providers || [];
    const state = {
      id,
      status: "proven",
      impact: "low",
      repositories: {},
      waivers: [],
      ...options.state
    };
    const proof = {
      status: "pass",
      proofRunId: `${id}-proof`,
      workspaceHash: options.hash || HASH,
      receipts: providers.map((provider) => ({ provider, sha256: "digest" })),
      ...options.proof
    };
    const proofFile = join(proofs, `${id}.json`);
    if (!options.proofMissing)
      writeFileSync(proofFile, `${JSON.stringify(proof)}\n`);
    for (const provider of providers)
      writeFileSync(join(receipts, `${id}-${provider}.json`), `${JSON.stringify({
        provenance: { source: options.signedCi ? "signed-ci:test" : "harness-test" }
      })}\n`);
    const written = [];
    const decisions = [];
    const runtime = createLandRuntime({
      assertApproval: options.assertApproval || (() => {}),
      root,
      transactions: join(root, "transactions"),
      loadRuntime: () => state,
      saveRuntime: () => {},
      pendingApplyTransactions: () => options.pending || [],
      recoverPendingApply: () => {},
      assertNoDroppedScenarios: () => {},
      blockingDrift: () => options.drift || [],
      proofAudit: () => options.audit || { valid: true },
      proofPath: () => proofFile,
      readJson: (path, fallback = null) => {
        try { return JSON.parse(readFileSync(path, "utf8")); }
        catch { return fallback; }
      },
      writeJson: (path, value) => written.push({ path, value }),
      clearSnapshotCache: () => {},
      relevantHash: () => options.currentHash || HASH,
      requiredProviders: () => providers,
      receiptValidity: (_id, provider) => ({
        validity: options.validity?.[provider] || "valid"
      }),
      fileDigest: () => options.receiptDigest || "digest",
      receiptPath: (_id, provider) => join(receipts, `${id}-${provider}.json`),
      handoffReadiness: () => options.handoffs || {
        operations: [], blocking: [], tracked: [], status: "COMPLETE"
      },
      telemetryReadiness: options.telemetry ? () => options.telemetry : null,
      verifyAppliedProjection: () => options.applied || { valid: true },
      selectedRepositories: () => options.selected || [],
      repositoryById: () => null,
      git: (args) => {
        if (args[0] === "status") return options.dirty || { status: 0, stdout: "", stderr: "" };
        if (args[0] === "rev-parse")
          return options.branch
            ? { status: 0, stdout: `${options.branch}\n`, stderr: "" }
            : { status: 1, stdout: "", stderr: "" };
        return { status: 1, stdout: "", stderr: "" };
      },
      gitHead: (path) => path === root
        ? (options.rootHead || state.workspace?.baseHead || "root-head")
        : (options.targetHead || "dependency-head"),
      ciEvidenceProtocolVersion: 1,
      stableHash: (value) => JSON.stringify(value),
      agentPlanValue: options.graph ? () => ({ graph: options.graph }) : null,
      executionContract: options.executionContract
        ? () => options.executionContract : null,
      now: () => "2026-08-26T00:00:00Z",
      blockWithDecision: (_id, code, decision) => {
        decisions.push({ code, decision });
        throw new Error(`decision:${code}`);
      },
      deliveryObservation: () => options.deliveryObservation || {
        observed: false, paths: [], reason: "target-does-not-match-change-projection"
      },
      landPreflight: options.landPreflight || null,
      fail: (message) => { throw new Error(message); }
    });
    return { id, runtime, state, proof, written, decisions };
  };

  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(String(message));
  try {
    const base = make();
    assert.equal(base.runtime.landCheck(base.id).archived, false);

    const archived = make({ state: { status: "archived", archivedAt: "today" } });
    assert.equal(archived.runtime.landCheck(archived.id).archived, true);
    const archivedBad = make({
      state: { status: "archived" }, audit: { valid: false, reason: "tampered" }
    });
    assert.equal(archivedBad.runtime.landCheck(archivedBad.id).archived, true);

    // A target kept during manual recovery is synchronized by the harness, not
    // handed to the agent as a command.
    const recovery = make({ state: { workspace: { recovery: { requiresSync: true } } } });
    assert.throws(() => recovery.runtime.landCheck(recovery.id), /decision:recovery-sync-required/);
    assert.equal(recovery.decisions[0].decision.automaticRecovery, "sync");
    assert.equal(automaticRecoveryAction(recovery.id, recovery.decisions[0].decision).kind,
      "sandbox-sync");
    const pending = make({ pending: [{
      transactionId: "tx-1", status: "applying", appliedPaths: ["a"],
      counts: { update: 1, create: 2, delete: 3 }
    }] });
    assert.throws(() => pending.runtime.landCheck(pending.id), /decision:apply-pending-recovery/);
    const moved = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "moved"
    });
    assert.throws(() => moved.runtime.landCheck(moved.id), /decision:control-head-moved/);
    assert.equal(moved.decisions[0].decision.kind, "control-head-moved");
    const delivered = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "moved",
      deliveryObservation: { observed: true, paths: ["changed.js"], expectedPathCount: 1 }
    });
    assert.throws(() => delivered.runtime.landCheck(delivered.id), /decision:control-head-moved/);
    assert.equal(delivered.decisions[0].decision.kind, "out-of-band-delivery-drift");
    assert.equal(delivered.decisions[0].decision.authoritative, false);
    assert.equal(delivered.decisions[0].decision.lifecycleStatus, "proven");
    assert.equal(delivered.decisions[0].decision.proofStatus, "unchanged");
    assert.match(delivered.decisions[0].decision.recoveryCommand,
      /sandbox sync land-/);
    const stableWorktree = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "base"
    });
    assert.equal(stableWorktree.runtime.landCheck(stableWorktree.id).archived, false);

    // `land check` and Land run the one shared pre-mutation preflight: read-only
    // for the check, recording for Land, and only after readiness passed. A
    // preflight stop is reported instead of LAND READY.
    const preflightCalls = [];
    const preflighted = make({
      landPreflight: (id, _state, options) => preflightCalls.push([id, options])
    });
    preflighted.runtime.landCheck(preflighted.id);
    assert.deepEqual(preflightCalls, [], "internal readiness callers keep the readiness-only check");
    preflighted.runtime.landCheck(preflighted.id, { preflight: "inspect" });
    preflighted.runtime.landCheck(preflighted.id, { preflight: "apply" });
    assert.deepEqual(preflightCalls, [
      [preflighted.id, { inspect: true }], [preflighted.id, { inspect: false }]
    ]);
    const readyBefore = output.length;
    const refused = make({
      landPreflight: () => { throw new Error("decision:target-edit-sync"); }
    });
    assert.throws(() => refused.runtime.landCheck(refused.id, { preflight: "inspect" }),
      /decision:target-edit-sync/);
    assert.equal(output.slice(readyBefore).some((line) => line.startsWith("LAND READY")), false);
    const notReached = make({
      state: { workspace: { recovery: { requiresSync: true } } },
      landPreflight: assert.fail
    });
    assert.throws(() => notReached.runtime.landCheck(notReached.id, { preflight: "inspect" }),
      /decision:recovery-sync-required/);

    const writeDependency = make({ selected: [{ id: "write", mode: "write" }] });
    assert.equal(writeDependency.runtime.landCheck(writeDependency.id).archived, false);
    const unisolated = make({
      state: { repositories: { dep: { mode: "copy", path: "/sandbox" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => unisolated.runtime.landCheck(unisolated.id), /not isolated/);
    // The stop names commands that exist, never a "recreate the sandbox" route.
    // The doctor stage it names must be one the registered usage accepts.
  const doctorUsage = JSON.parse(readFileSync(new URL("../commands.json", import.meta.url), "utf8"))
    .commands.find((row) => row.name === "doctor").usage;
  const doctorStages = doctorUsage.match(/--stage ([a-z|]+)/)[1].split("|");
  assert.throws(() => unisolated.runtime.landCheck(unisolated.id), (error) => {
    const stage = error.message.match(/claude-foundation doctor --stage (\S+) --change /)?.[1];
    return doctorStages.includes(stage) &&
      /claude-foundation advance .* --through archived/.test(error.message) &&
      !/recreate the sandbox/.test(error.message);
  });
    const dirty = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 0, stdout: " M changed", stderr: "" }
    });
    assert.throws(() => dirty.runtime.landCheck(dirty.id), /changed inside its sandbox/);
    const statusFailed = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 1, stdout: "", stderr: "status failed" }
    });
    assert.throws(() => statusFailed.runtime.landCheck(statusFailed.id), /status failed/);
    const statusFailedWithoutDetail = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 1, stdout: "", stderr: "" }
    });
    assert.throws(() => statusFailedWithoutDetail.runtime.landCheck(statusFailedWithoutDetail.id),
      /git status failed/);
    const dependencyMoved = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "old-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyMoved.runtime.landCheck(dependencyMoved.id), /moved after sandbox/);
    const dependencyWithoutRuntime = make({
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyWithoutRuntime.runtime.landCheck(dependencyWithoutRuntime.id),
      /not isolated/);
    const dependencyWithoutBase = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyWithoutBase.runtime.landCheck(dependencyWithoutBase.id),
      /moved after sandbox/);
    const cleanDependency = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.equal(cleanDependency.runtime.landCheck(cleanDependency.id).archived, false);

    // Spec approval that went stale after proof refuses Land even though the
    // proof itself is current: a Land grant is never consent to the agreement.
    const approvalId = `land-${sequence + 1}`;
    const packet = join(root, "openspec", "changes", approvalId);
    mkdirSync(packet, { recursive: true });
    writeFileSync(join(packet, "proposal.md"), "approved text\n");
    const approvedIdentity = agreementIdentity(root, approvalId);
    writeFileSync(join(packet, "proposal.md"), "edited after proof\n");
    const staleApproval = make({
      state: { contractRevision: 1, specApproval: {
        required: true, revision: 1, identity: approvedIdentity
      } },
      assertApproval: (id, state, options) => assertSpecApproval(root, id, state, options)
    });
    assert.equal(staleApproval.id, approvalId);
    assert.throws(() => staleApproval.runtime.landCheck(staleApproval.id),
      (error) => error.code === "SPEC_APPROVAL_REQUIRED");
    assert.throws(() => staleApproval.runtime.landCheck(staleApproval.id, { preflight: "apply" }),
      (error) => error.code === "SPEC_APPROVAL_REQUIRED");
    writeFileSync(join(packet, "proposal.md"), "approved text\n");
    assert.equal(staleApproval.runtime.landCheck(staleApproval.id).archived, false);

    // A matching proof hash does not make a change returned to Build landable.
    const rebuilt = make({ state: { status: "building" } });
    assert.throws(() => rebuilt.runtime.landCheck(rebuilt.id),
      /Land requires current passing proof .*lifecycle is 'building', not proven/);
    const legacyLanding = make({ state: { status: "landing" } });
    assert.equal(legacyLanding.runtime.landCheck(legacyLanding.id).archived, false);

    // Protected-path edits and deletions Prove recorded are presented at Land
    // as paths only.
    const surfaced = make({ state: { surfaceAdditions: [
      { repositoryId: "root", path: ".github/workflows/ci.yml", protected: true },
      { repositoryId: "api", path: "src/old.js", deleted: true },
      { repositoryId: "root", path: "src/plain.js" }
    ] } });
    const surfacedResult = surfaced.runtime.landCheck(surfaced.id);
    assert.deepEqual(surfacedResult.surface, {
      protected: [{ repositoryId: "root", path: ".github/workflows/ci.yml" }],
      deleted: [{ repositoryId: "api", path: "src/old.js" }],
      requiresPresentation: true
    });
    assert.ok(output.some((message) =>
      message.includes("protected paths changed: .github/workflows/ci.yml") &&
      message.includes("paths deleted: api:src/old.js")));
    assert.equal(base.runtime.landCheck(base.id).surface.requiresPresentation, false);

    const missingProof = make({ proofMissing: true });
    assert.throws(() => missingProof.runtime.landCheck(missingProof.id),
      /Land requires current passing proof .*assurance: missing/);
    const badAudit = make({ audit: { valid: false, reason: "bad audit" } });
    assert.throws(() => badAudit.runtime.landCheck(badAudit.id),
      /Land requires current passing proof .*assurance: invalid/);
    const stale = make({ currentHash: "different-hash" });
    assert.throws(() => stale.runtime.landCheck(stale.id),
      /Land requires current passing proof .*assurance: stale/);

    const graph = { identity: "graph-a", revision: "r1" };
    const graphMissing = make({ graph });
    assert.throws(() => graphMissing.runtime.landCheck(graphMissing.id),
      /Land requires current passing proof .*assurance: invalid/);
    const graphStale = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "other", graphRevision: "r1", workspaceHash: HASH
    } } });
    assert.throws(() => graphStale.runtime.landCheck(graphStale.id),
      /Land requires current passing proof .*assurance: invalid/);
    const graphIncomplete = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: [], requiredEdges: ["a>b"], coveredEdges: []
    } } });
    assert.throws(() => graphIncomplete.runtime.landCheck(graphIncomplete.id),
      /Land requires current passing proof .*assurance: invalid/);
    const graphNodesOnly = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: []
    } } });
    assert.throws(() => graphNodesOnly.runtime.landCheck(graphNodesOnly.id),
      /Land requires current passing proof .*assurance: invalid/);
    const graphEdgesOnly = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredEdges: ["a>b"], coveredEdges: []
    } } });
    assert.throws(() => graphEdgesOnly.runtime.landCheck(graphEdgesOnly.id),
      /Land requires current passing proof .*assurance: invalid/);
    const graphWithoutCoverageLists = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH
    } } });
    assert.equal(graphWithoutCoverageLists.runtime.landCheck(graphWithoutCoverageLists.id).archived,
      false);
    const graphComplete = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: ["a"], requiredEdges: ["a>b"], coveredEdges: ["a>b"]
    } } });
    assert.equal(graphComplete.runtime.landCheck(graphComplete.id).archived, false);

    const invalidReceipt = make({ providers: ["test"], validity: { test: "stale" } });
    assert.throws(() => invalidReceipt.runtime.landCheck(invalidReceipt.id),
      /Land requires current passing proof .*assurance: invalid/);
    const changedReceipt = make({ providers: ["test"], receiptDigest: "changed" });
    assert.throws(() => changedReceipt.runtime.landCheck(changedReceipt.id),
      /Land requires current passing proof .*assurance: invalid/);
    const compiled = make({
      providers: ["test"], executionContract: {
        evidence: { providers: ["test"] }, land: { signedCiRequired: false }
      }
    });
    assert.equal(compiled.runtime.landCheck(compiled.id).archived, false);
    const contractProviderMismatch = make({
      providers: ["test"], executionContract: {
        evidence: { providers: ["other"] }, land: { signedCiRequired: false }
      }
    });
    assert.throws(() => contractProviderMismatch.runtime.landCheck(contractProviderMismatch.id),
      /Land requires current passing proof .*assurance: invalid/);
    const signedCi = make({
      providers: ["ci"], signedCi: true,
      state: { riskBasedCiRequired: true, impact: "high" }
    });
    assert.equal(signedCi.runtime.landCheck(signedCi.id).archived, false);
    const missingCi = make({
      providers: ["test"], state: { riskBasedCiRequired: true, impact: "high" }
    });
    assert.throws(() => missingCi.runtime.landCheck(missingCi.id),
      /Land requires current passing proof .*assurance: invalid/);

    const blockedHandoff = make({ handoffs: {
      blocking: ["op"], tracked: [], status: "WAITING_EXTERNAL",
      operations: [{ id: "op", owner: "ops", environment: "prod", operation: "switch",
        validity: "valid", status: "pending", timing: "post-land", activation: "manual",
        landBlocking: true }]
    } });
    assert.throws(() => blockedHandoff.runtime.landCheck(blockedHandoff.id),
      /Land requires current passing proof .*assurance: inconclusive/);
    const invalidApplied = make({
      state: { workspace: { applied: true } }, applied: { valid: false, reason: "projection drift" }
    });
    assert.throws(() => invalidApplied.runtime.landCheck(invalidApplied.id), /projection drift/);
    const validApplied = make({ state: { workspace: { applied: true } } });
    assert.equal(validApplied.runtime.landCheck(validApplied.id).archived, false);
    const drifted = make({ drift: [{
      taskId: "T001", taskKind: "security", requestedTier: "deep",
      actualModel: "fast", reason: "downgrade"
    }] });
    assert.throws(() => drifted.runtime.landCheck(drifted.id),
      /Land requires current passing proof .*assurance: failed/);
    const fallbackDrift = make({ drift: [
      { blockingTasks: ["T002"], requestedTier: "deep", reason: "downgrade" },
      { blockingTasks: [], requestedTier: "standard", reason: "unknown actor" }
    ] });
    assert.throws(() => fallbackDrift.runtime.landCheck(fallbackDrift.id),
      /Land requires current passing proof .*assurance: failed/);

    const rich = make({
      branch: "main",
      state: { waivers: [{ capability: "review", authority: { reference: "DEC-1" } }] },
      handoffs: { blocking: [], tracked: [], status: "COMPLETE", operations: [{
        id: "post", owner: "ops", reference: "ticket-1",
        landDisposition: "tracked-post-land"
      }] },
      telemetry: {
        classification: "complete",
        recoveryActions: [{ command: "claude-foundation telemetry sync" }]
      }
    });
    assert.equal(rich.runtime.landCheck(rich.id).telemetry.classification, "complete");
    assert.ok(output.some((message) => message.includes("declared post-Land obligation")));
    assert.ok(output.some((message) => message.includes("branch: main")));
    assert.ok(output.some((message) => message.includes("telemetry: complete")));

    const declaredPostLand = make({ handoffs: {
      blocking: [], declared: ["post"], tracked: ["post"],
      status: "READY_WITH_TRACKED_HANDOFF",
      operations: [{
        id: "post", owner: "ops", reference: null,
        landDisposition: "declared-post-land"
      }]
    } });
    assert.equal(declaredPostLand.runtime.landCheck(declaredPostLand.id).archived, false);
    assert.ok(output.some((message) =>
      message.includes("declared post-Land obligation: post (ops)")));

    const multi = make({
      state: { repositories: { a: {}, b: {} } },
      selected: [{ id: "a" }, { id: "b" }]
    });
    assert.equal(multi.runtime.landCheck(multi.id).archived, false);
    assert.equal(multi.written.length, 1);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }
});
