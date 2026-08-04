export function createProofExecutionRuntime({
  proofReadinessValue, relevantSnapshot, loadRuntime, saveRuntime, now,
  requiredProviders, receiptValidity, rebindReusableReceipt, executionNodes,
  collectableExecutionNodes, startRequiredServices, runExecutionDag,
  durableArtifact, pendingTasks, proofPreflight, prove, proofAudit,
  readJson, proofPath, die
}) {
  async function proofCollect(id) {
    const readiness = proofReadinessValue(id, "prove");
    if (!["READY", "NEEDS_EXTERNAL_EVIDENCE"].includes(readiness.status)) {
      console.log(JSON.stringify({
        ...readiness,
        command: "proof collect",
        completed: false
      }, null, 2));
      process.exitCode = 2;
      return readiness;
    }
    const snapshot = relevantSnapshot(id, null, true);
    const state = loadRuntime(id);
    const proofRunId = `collect-${Date.now()}`;
    state.activeProofRun = {
      id: proofRunId,
      snapshotId: snapshot.id,
      workspaceHash: snapshot.workspaceHash,
      startedAt: now(),
      mode: "collect"
    };
    saveRuntime(state);
    for (const provider of requiredProviders(id)) {
      const row = receiptValidity(id, provider, snapshot.workspaceHash);
      if (row.validity === "reusable-inputs")
        rebindReusableReceipt(id, row, snapshot, proofRunId);
    }
    let sessions = [];
    try {
      const { nodes, unavailable } = executionNodes(id, snapshot.workspaceHash);
      if (unavailable.length)
        die(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
      const collectable = collectableExecutionNodes(id, nodes, snapshot.workspaceHash);
      sessions = await startRequiredServices(id, collectable.nodes, proofRunId);
      const outcomes = collectable.nodes.length
        ? await runExecutionDag(id, collectable.nodes, proofRunId)
        : [];
      const failed = outcomes.filter((row) => row.status !== "pass");
      if (failed.length)
        die(`evidence collection failed: ${failed.map((row) => `${row.provider}:${row.status}`).join(", ")}`);
      const serviceArtifacts = sessions.reverse()
        .map((session) => session.stop())
        .map((artifact) => durableArtifact(id, "service", proofRunId, {
          path: artifact.path,
          type: "service-log",
          required: true
        }));
      const withServices = loadRuntime(id);
      withServices.activeProofRun.serviceArtifacts = serviceArtifacts;
      saveRuntime(withServices);
      sessions = [];
      const after = proofReadinessValue(id, "prove");
      const outcome = {
        version: 1,
        changeId: id,
        command: "proof collect",
        status: after.status,
        completed: true,
        proofFinalized: false,
        proofRunId,
        workspaceHash: snapshot.workspaceHash,
        executedProviders: outcomes.map((row) => row.provider),
        blockedExecutableProviders: collectable.blocked,
        remainingExternalProviders: after.externalProviders
      };
      console.log(JSON.stringify(outcome, null, 2));
      return outcome;
    } catch (error) {
      sessions.reverse().forEach((session) => session.stop());
      die(error.message);
    } finally {
      const current = loadRuntime(id);
      delete current.activeProofRun;
      saveRuntime(current);
    }
  }
  
  async function proofExecute(id) {
    proofPreflight(id, "prove", true);
    const pending = pendingTasks(id);
    if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
    const snapshot = relevantSnapshot(id, null, true);
    const state = loadRuntime(id);
    const proofRunId = `proof-${Date.now()}`;
    state.activeProofRun = {
      id: proofRunId,
      snapshotId: snapshot.id,
      workspaceHash: snapshot.workspaceHash,
      startedAt: now()
    };
    saveRuntime(state);
    for (const provider of requiredProviders(id)) {
      const row = receiptValidity(id, provider, snapshot.workspaceHash);
      if (row.validity === "reusable-inputs")
        rebindReusableReceipt(id, row, snapshot, proofRunId);
    }
    let sessions = [];
    try {
      const hash = snapshot.workspaceHash;
      const { nodes, unconfigured, unavailable } = executionNodes(id, hash);
      if (unconfigured.length)
        die(`missing executable adapter for provider(s): ${unconfigured.join(", ")}; record external receipts or configure evidence v2`);
      if (unavailable.length)
        die(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
      sessions = await startRequiredServices(id, nodes, proofRunId);
      if (nodes.length) await runExecutionDag(id, nodes, proofRunId);
      else console.log(`EXECUTION ${proofRunId}: all receipts reused`);
      const serviceArtifacts = sessions.reverse()
        .map((session) => session.stop())
        .map((artifact) => durableArtifact(id, "service", proofRunId, {
          path: artifact.path,
          type: "service-log",
          required: true
        }));
      const withServices = loadRuntime(id);
      withServices.activeProofRun.serviceArtifacts = serviceArtifacts;
      saveRuntime(withServices);
      sessions = [];
      prove(id, proofRunId);
    } catch (error) {
      sessions.reverse().forEach((session) => session.stop());
      const current = loadRuntime(id);
      delete current.activeProofRun;
      saveRuntime(current);
      die(error.message);
    } finally {
      const current = loadRuntime(id);
      delete current.activeProofRun;
      saveRuntime(current);
    }
  }
  
  async function proofRun(id) {
    const readiness = proofReadinessValue(id, "prove");
    if (readiness.status !== "READY") {
      console.log(JSON.stringify({
        ...readiness,
        command: "proof run",
        completed: false
      }, null, 2));
      process.exitCode = 2;
      return readiness;
    }
    await proofExecute(id);
    const audit = proofAudit(id, true);
    if (!audit.valid)
      die(`proof run audit failed: ${audit.reason}`);
    const proof = readJson(proofPath(id));
    const outcome = {
      version: 1,
      changeId: id,
      command: "proof run",
      status: "PASS",
      completed: true,
      proofRunId: proof.proofRunId || null,
      workspaceHash: proof.workspaceHash,
      providers: proof.providers || []
    };
    console.log(JSON.stringify(outcome, null, 2));
    return outcome;
  }

  return { proofCollect, proofExecute, proofRun };
}

