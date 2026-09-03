import { repairActionForWorkspace } from "../evidence/repair-runtime.mjs";

export const ADVANCE_PROTOCOL_VERSION = 3;

const command = (value) => `claude-foundation ${value}`;

const resume = (id, through = null) => command(
  `advance ${id}${through ? ` --through ${through}` : ""}`);

function envelope(id, action, values = {}) {
  const {
    legacyAction = null, boundary = null, actor = "harness", reason = null,
    resumeCommand = resume(id), recoveryType = null, alternatives = [], ...rest
  } = values;
  return {
    protocol: ADVANCE_PROTOCOL_VERSION,
    version: ADVANCE_PROTOCOL_VERSION,
    action,
    changeId: id,
    actor,
    boundary,
    reason,
    ...(legacyAction ? { legacyAction } : {}),
    ...rest,
    recovery: recoveryType ? {
      type: recoveryType,
      alternatives,
      statePreserved: true
    } : null,
    resume: resumeCommand,
    // Kept for v2 host adapters during the protocol migration.
    resumeCommand
  };
}

function taskVerification(text) {
  return String(text || "").match(/—\s*verify:\s*`([^`]+)`/i)?.[1] || null;
}

function compactRepairGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return null;
  return {
    nodes: graph.nodes.slice(0, 20).map((node) => ({
      id: node.id,
      findingIds: node.findingIds || [],
      dependsOn: node.dependsOn || [],
      paths: node.paths || node.files || [],
      claimIds: node.claimIds || [],
      verificationCaseIds: node.verificationCaseIds || [],
      sourceAttemptDigest: node.sourceAttemptDigest || null
    })),
    truncated: graph.nodes.length > 20
  };
}

function compactPreflight(value) {
  if (!value) return null;
  return {
    status: value.status,
    issues: (value.issues || []).slice(0, 20),
    unavailableProviders: (value.unavailableProviders || []).slice(0, 20),
    activeWorkers: (value.activeWorkers || []).slice(0, 20),
    truncated: (value.issues || []).length > 20 ||
      (value.unavailableProviders || []).length > 20 ||
      (value.activeWorkers || []).length > 20
  };
}

function selectedBuildTasks(dispatch, plan) {
  const ids = dispatch.action === "spawn-group"
    ? (dispatch.workers || []).map((worker) => worker.taskId)
    : dispatch.task?.taskId ? [dispatch.task.taskId]
      : (plan?.groups?.[0] || plan?.tasks?.slice(0, 1).map((task) => task.id) || []);
  return ids.map((id) => plan?.tasks?.find((task) => task.id === id))
    .filter(Boolean).map((task) => ({
      id: task.id,
      instruction: task.text,
      repository: task.repository,
      allowedPaths: task.paths || [],
      verification: [taskVerification(task.text)].filter(Boolean)
    }));
}

function buildAction(id, dispatch, state, plan = null) {
  if (dispatch.action === "build-complete") return null;
  if (["run-in-session", "run-leased-in-session", "spawn-group"].includes(dispatch.action)) {
    const tasks = selectedBuildTasks(dispatch, plan);
    return envelope(id, "EDIT", {
      legacyAction: dispatch.action === "spawn-group" ? "EXECUTE_TASK_GROUP" : "EXECUTE_TASK",
      actor: "agent",
      boundary: "host-execution",
      reason: dispatch.reason,
      workspace: state.workspace?.path || null,
      tasks,
      allowedPaths: [...new Set(tasks.flatMap((task) => task.allowedPaths))],
      verification: [...new Set(tasks.flatMap((task) => task.verification))],
      execution: {
        mode: dispatch.action === "spawn-group" ? "parallel" : "session",
        leases: dispatch.action === "spawn-group" ? dispatch.workers :
          dispatch.task ? [dispatch.task] : []
      },
      recoveryType: "EDIT",
      alternatives: ["amend the agreement if Build discovers new behavior"]
    });
  }
  if (dispatch.action === "wait") return envelope(id, "WAIT", {
    legacyAction: "WAIT_RESOURCE", actor: "resource-owner", boundary: "resource",
    reason: dispatch.reason, wait: { workers: dispatch.activeWorkers || [] },
    recoveryType: "PAUSE",
    alternatives: ["wait for the active lease", "release an abandoned lease after inspection"]
  });
  return envelope(id, "REPAIR", {
    legacyAction: "REPAIR_BUILD_PLAN", actor: "agent",
    boundary: "contract",
    reason: dispatch.reason || "the Build graph is not dispatchable",
    findings: dispatch.reasons || null,
    command: dispatch.nextCommand,
    recoveryType: "RECONFIGURE",
    alternatives: ["repair the agreement or task graph", "inspect the Build diagnostic"]
  });
}

export function coordinatorAction({
  id, state, dispatch, workspaceHash, latestReview = null,
  proofCursor = {}, authorityRequests = [], stableHash, authorityActions = null,
  proofPreflight = null, plan = null
}) {
  if (state.status === "archived") return envelope(id, "DONE", {
    legacyAction: "ARCHIVED", boundary: null, reason: "change is archived",
    completed: true, reached: "archived", resumeCommand: null
  });

  const pendingBuild = buildAction(id, dispatch, state, plan);
  if (pendingBuild) return pendingBuild;

  // A successful proof supersedes earlier review failures. Without this
  // ordering, the last failed AI attempt could keep routing a proven change
  // back into repair after deterministic closure had already passed.
  const proofCurrent = proofCursor.workspaceHash === workspaceHash &&
    (["proven", "landing"].includes(state.status) || proofCursor.status === "PASS");
  if (proofCurrent)
    return envelope(id, "ASK_USER", {
      legacyAction: "LAND_READY", actor: "user", 
      boundary: "land-authority",
      reason: "proof is current; explicit Land authority is required",
      command: command(`land advance ${id}`),
      forbidden: ["commit", "push", "publish", "open-pr", "waive"],
      recoveryType: "ASK_USER",
      alternatives: ["invoke /land to apply and archive", "leave the proven change pending"]
    });

  // A new request is evidence that invalidated checks have already advanced
  // far enough to need the configured authority. Prefer it over a stale
  // failure from the previous workspace.
  const open = authorityRequests.find((request) =>
    ["requested", "dispatched", "pending"].includes(request.status));
  if (open) {
    const configuredReview = open.type === "review" && open.status === "requested";
    const authorityAction = authorityActions?.find((entry) => entry.requestId === open.requestId);
    return envelope(id, configuredReview ? "RUN_EXTERNAL" : "WAIT", {
      legacyAction: configuredReview ? "RUN_CONFIGURED_REVIEW" : "WAIT_EXTERNAL",
      actor: configuredReview ? "configured-reviewer" : "external-authority",
      boundary: "external-authority",
      reason: configuredReview ? "configured review is ready" : "external authority is pending",
      requestId: open.requestId,
      command: authorityAction?.command || (configuredReview
        ? command(`authority status ${id} --request ${open.requestId} --template`)
        : command(`authority status ${id} --request ${open.requestId}`)),
      recoveryType: configuredReview ? "HANDOFF" : "PAUSE",
      alternatives: configuredReview
        ? ["run the configured reviewer", "record an authorized external verdict"]
        : ["wait for the requested verdict", "record the external verdict when available"]
    });
  }

  const repair = repairActionForWorkspace(latestReview, workspaceHash, stableHash);
  if (repair) return envelope(id,
    repair.action === "RUN_INVALIDATED_EVIDENCE" ? "RUN_EXTERNAL" : "REPAIR", {
    legacyAction: repair.action,
    actor: repair.action === "RUN_INVALIDATED_EVIDENCE" ? "harness" : "agent",
    boundary: repair.action === "EXECUTE_REPAIR_BATCH"
      ? "host-execution" : null,
    reason: repair.reason || "review findings require a bounded repair",
    repairGraph: compactRepairGraph(repair.repairGraph),
    command: repair.action === "RUN_INVALIDATED_EVIDENCE"
      ? command(`proof advance ${id}`) : null,
    recoveryType: repair.action === "RUN_INVALIDATED_EVIDENCE" ? "AUTO_RECOVER" : "EDIT",
    alternatives: repair.action === "RUN_INVALIDATED_EVIDENCE"
      ? ["rerun only invalidated evidence"] : ["apply the dependency-ordered repair batch"]
  });

  if (proofCursor.status === "NEEDS_USER_DECISION" ||
      proofCursor.route === "CONTRACT_DECISION_REQUIRED" ||
      proofCursor.route === "NO_PROGRESS_DECISION") return envelope(id, "ASK_USER", {
    legacyAction: "REQUEST_DECISION", actor: "user",
    boundary: "user-authority",
    reason: "proof reached a material decision boundary",
    decision: proofCursor.decision || null,
    recoveryType: "ASK_USER",
    alternatives: proofCursor.decision?.alternatives || []
  });

  if (proofPreflight && proofPreflight.status !== "READY") {
    const first = proofPreflight.next?.[0] || null;
    const mapping = {
      NEEDS_CODE_CHANGE: ["EDIT", "EXECUTE_TASK", "agent", "host-execution", "EDIT"],
      CONFIGURATION_ERROR: ["REPAIR", "REPAIR_PROOF_CONTRACT", "agent", "contract", "RECONFIGURE"],
      BLOCKED_BY_ACTIVE_WORK: ["WAIT", "WAIT_RESOURCE", "resource-owner", "resource", "PAUSE"],
      INFRASTRUCTURE_ERROR: ["REPAIR", "REPAIR_PROVIDER_ENVIRONMENT", "operator", "resource", "RECONFIGURE"],
      NEEDS_USER_DECISION: ["ASK_USER", "REQUEST_DECISION", "user", "user-authority", "ASK_USER"]
    };
    const [action, legacyAction, actor, boundary, recoveryType] = mapping[proofPreflight.status] ||
      ["REPAIR", "REPAIR_PROOF_PREFLIGHT", "agent", "contract", "RECONFIGURE"];
    return envelope(id, action, {
      legacyAction,
      actor,
      action,
      boundary,
      reason: proofPreflight.issues?.[0] || proofPreflight.status,
      preflight: compactPreflight(proofPreflight),
      command: first?.command || command(`doctor --stage prove --change ${id}`),
      recoveryType,
      alternatives: (proofPreflight.next || []).map((row) => row.reason || row.command)
    });
  }

  return envelope(id, "RUN_EXTERNAL", {
    legacyAction: "RUN_PROOF", actor: "harness",
    boundary: null,
    reason: "deterministic evidence is ready to run",
    command: command(`proof advance ${id}`),
    automatic: true,
    recoveryType: "AUTO_RECOVER",
    alternatives: ["run the deterministic proof chain"]
  });
}

export function createAdvanceRuntime({
  loadRuntime, agentDispatchValue, relevantHash, deliveredAiAttempts,
  authorityStatusValue, authorityNext, readJson, proofAdvancePath, stableHash,
  proofReadinessValue = null, agentPlanValue = null,
  prepareBuild = null, runProof = null, runLand = null,
  recordPhase = null, output = console.log
}) {
  function advanceValue(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") return coordinatorAction({
      id, state, dispatch: { action: "build-complete" }, workspaceHash: null,
      stableHash
    });
    const authority = authorityStatusValue(id);
    let dispatch;
    try { dispatch = agentDispatchValue(id); }
    catch (error) {
      dispatch = { action: "unavailable", reason: "build-dispatch-unavailable",
        nextCommand: command(`doctor --stage build --change ${id}`) };
    }
    let proofPreflight = null;
    if (dispatch.action === "build-complete" && proofReadinessValue) {
      try { proofPreflight = proofReadinessValue(id, "prove"); }
      catch (error) {
        proofPreflight = {
          version: 1, changeId: id, stage: "prove", status: "CONFIGURATION_ERROR",
          issues: [error?.message || String(error)],
          next: [{
            kind: "diagnose-proof",
            command: command(`doctor --stage prove --change ${id}`)
          }]
        };
      }
    }
    const openRequests = authority.requests || [];
    let plan = null;
    if (agentPlanValue && ["run-in-session", "run-leased-in-session", "spawn-group"]
      .includes(dispatch.action)) {
      try { plan = agentPlanValue(id); }
      catch { /* dispatch still carries an exact compatibility route */ }
    }
    return coordinatorAction({
      id,
      state,
      dispatch,
      workspaceHash: relevantHash(id),
      latestReview: deliveredAiAttempts(id).at(-1) || null,
      proofCursor: readJson(proofAdvancePath(id), {}),
      authorityRequests: openRequests,
      proofPreflight,
      plan,
      authorityActions: authorityNext
        ? authorityNext(id, openRequests[0]?.type || "review", openRequests) : null,
      stableHash
    });
  }

  function phaseForAction(value) {
    if (value.action === "EDIT" || value.action === "REPAIR") return "build";
    if (value.legacyAction === "LAND_READY" || value.reached === "archived") return "land";
    if (["RUN_PROOF", "RUN_INVALIDATED_EVIDENCE", "RUN_CONFIGURED_REVIEW",
      "WAIT_EXTERNAL", "REQUEST_DECISION"].includes(value.legacyAction)) return "prove";
    return null;
  }

  function reached(id, through) {
    const state = loadRuntime(id);
    if (state.status === "archived") return "archived";
    if (through === "proven" && ["proven", "landing"].includes(state.status)) return "proven";
    return null;
  }

  function done(id, stage, through) {
    const next = stage === "build" ? resume(id, "proven")
      : stage === "proven" ? resume(id, "archived") : null;
    return envelope(id, "DONE", {
      legacyAction: stage === "archived" ? "ARCHIVED" : "TARGET_REACHED",
      reason: `${stage} target reached`, completed: true, reached: stage,
      resumeCommand: null,
      next
    });
  }

  async function advanceThrough(id, through) {
    if (!through) return advanceValue(id);
    if (!["build", "proven", "archived"].includes(through))
      throw new Error("advance --through must be build|proven|archived");
    const initial = loadRuntime(id);
    if (initial.status === "change" && prepareBuild) await prepareBuild(id);
    const targetResume = (value) => ({
      ...value,
      resume: resume(id, through),
      resumeCommand: resume(id, through)
    });
    for (let cycle = 0; cycle < 32; cycle += 1) {
      const completed = reached(id, through);
      if (completed) return done(id, completed, through);
      const value = advanceValue(id);
      if (through === "build" && ["RUN_PROOF", "LAND_READY"].includes(value.legacyAction)) {
        if (recordPhase) recordPhase(id, "build");
        return done(id, "build", through);
      }
      const phase = phaseForAction(value);
      if (phase && recordPhase) recordPhase(id, phase);
      if (value.legacyAction === "RUN_PROOF" && ["proven", "archived"].includes(through)) {
        if (!runProof) return targetResume(value);
        const outcome = await runProof(id);
        if (!outcome?.progressed && !outcome?.completed)
          return targetResume(advanceValue(id));
        continue;
      }
      if (value.legacyAction === "RUN_INVALIDATED_EVIDENCE" &&
          ["proven", "archived"].includes(through)) {
        if (!runProof) return targetResume(value);
        await runProof(id);
        continue;
      }
      if (value.legacyAction === "LAND_READY" && through === "archived") {
        if (!runLand) return targetResume(value);
        await runLand(id);
        continue;
      }
      return targetResume(value);
    }
    return envelope(id, "WAIT", {
      legacyAction: "NO_PROGRESS_BOUNDARY", actor: "operator",
      boundary: "repeated-no-progress",
      reason: "advance reached its convergence safety boundary",
      recoveryType: "PAUSE",
      alternatives: ["inspect feedback and resume with the same command"],
      resumeCommand: resume(id, through)
    });
  }

  async function showAdvance(id, flags = {}) {
    const value = await advanceThrough(id, flags.through || null);
    if (!flags.through) {
      const phase = phaseForAction(value);
      if (phase && recordPhase) recordPhase(id, phase);
    }
    output(JSON.stringify(value, null, flags.pretty ? 2 : 0));
    return value;
  }

  return { advanceValue, advanceThrough, showAdvance };
}
