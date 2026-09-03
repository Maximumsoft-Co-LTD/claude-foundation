import { repairActionForWorkspace } from "../evidence/repair-runtime.mjs";

export const ADVANCE_PROTOCOL_VERSION = 2;

const command = (value) => `claude-foundation ${value}`;

function buildAction(id, dispatch) {
  if (dispatch.action === "build-complete") return null;
  if (["run-in-session", "run-leased-in-session", "spawn-group"].includes(dispatch.action))
    return {
      version: ADVANCE_PROTOCOL_VERSION,
      changeId: id,
      action: dispatch.action === "spawn-group" ? "EXECUTE_TASK_GROUP" : "EXECUTE_TASK",
      boundary: "host-execution",
      dispatch,
      resumeCommand: command(`advance ${id}`)
    };
  if (dispatch.action === "wait") return {
    version: ADVANCE_PROTOCOL_VERSION,
    changeId: id,
    action: "WAIT_RESOURCE",
    boundary: "resource",
    dispatch,
    resumeCommand: command(`advance ${id}`)
  };
  return {
    version: ADVANCE_PROTOCOL_VERSION,
    changeId: id,
    action: "REPAIR_BUILD_PLAN",
    boundary: "contract",
    dispatch,
    resumeCommand: dispatch.nextCommand
  };
}

export function coordinatorAction({
  id, state, dispatch, workspaceHash, latestReview = null,
  proofCursor = {}, authorityRequests = [], stableHash, authorityActions = null,
  proofPreflight = null
}) {
  if (state.status === "archived") return {
    version: ADVANCE_PROTOCOL_VERSION, changeId: id,
    action: "ARCHIVED", boundary: null, resumeCommand: null
  };

  const pendingBuild = buildAction(id, dispatch);
  if (pendingBuild) return pendingBuild;

  // A successful proof supersedes earlier review failures. Without this
  // ordering, the last failed AI attempt could keep routing a proven change
  // back into repair after deterministic closure had already passed.
  const proofCurrent = proofCursor.workspaceHash === workspaceHash &&
    (["proven", "landing"].includes(state.status) || proofCursor.status === "PASS");
  if (proofCurrent)
    return {
      version: ADVANCE_PROTOCOL_VERSION,
      changeId: id,
      action: "LAND_READY",
      boundary: "land-authority",
      command: command(`land advance ${id}`),
      forbidden: ["commit", "push", "publish", "open-pr", "waive"],
      resumeCommand: command(`advance ${id}`)
    };

  // A new request is evidence that invalidated checks have already advanced
  // far enough to need the configured authority. Prefer it over a stale
  // failure from the previous workspace.
  const open = authorityRequests.find((request) =>
    ["requested", "dispatched", "pending"].includes(request.status));
  if (open) {
    const configuredReview = open.type === "review" && open.status === "requested";
    const authorityAction = authorityActions?.find((entry) => entry.requestId === open.requestId);
    return {
      version: ADVANCE_PROTOCOL_VERSION,
      changeId: id,
      action: configuredReview ? "RUN_CONFIGURED_REVIEW" : "WAIT_EXTERNAL",
      boundary: "external-authority",
      requestId: open.requestId,
      command: authorityAction?.command || (configuredReview
        ? command(`authority status ${id} --request ${open.requestId} --template`)
        : command(`authority status ${id} --request ${open.requestId}`)),
      resumeCommand: command(`advance ${id}`)
    };
  }

  const repair = repairActionForWorkspace(latestReview, workspaceHash, stableHash);
  if (repair) return {
    ...repair,
    changeId: id,
    boundary: repair.action === "EXECUTE_REPAIR_BATCH"
      ? "host-execution" : null,
    packetCommand: command(`packet ${id} --phase build`),
    command: repair.action === "RUN_INVALIDATED_EVIDENCE"
      ? command(`proof advance ${id}`) : null,
    resumeCommand: command(`advance ${id}`)
  };

  if (proofCursor.status === "NEEDS_USER_DECISION" ||
      proofCursor.route === "CONTRACT_DECISION_REQUIRED" ||
      proofCursor.route === "NO_PROGRESS_DECISION") return {
    version: ADVANCE_PROTOCOL_VERSION,
    changeId: id,
    action: "REQUEST_DECISION",
    boundary: "user-authority",
    decision: proofCursor.decision || null,
    resumeCommand: command(`advance ${id}`)
  };

  if (proofPreflight && proofPreflight.status !== "READY") {
    const first = proofPreflight.next?.[0] || null;
    const mapping = {
      NEEDS_CODE_CHANGE: ["EXECUTE_TASK", "host-execution"],
      CONFIGURATION_ERROR: ["REPAIR_PROOF_CONTRACT", "contract"],
      BLOCKED_BY_ACTIVE_WORK: ["WAIT_RESOURCE", "resource"],
      INFRASTRUCTURE_ERROR: ["REPAIR_PROVIDER_ENVIRONMENT", "resource"],
      NEEDS_USER_DECISION: ["REQUEST_DECISION", "user-authority"]
    };
    const [action, boundary] = mapping[proofPreflight.status] ||
      ["REPAIR_PROOF_PREFLIGHT", "contract"];
    return {
      version: ADVANCE_PROTOCOL_VERSION,
      changeId: id,
      action,
      boundary,
      preflight: proofPreflight,
      command: first?.command || command(`doctor --stage prove --change ${id}`),
      resumeCommand: command(`advance ${id}`)
    };
  }

  return {
    version: ADVANCE_PROTOCOL_VERSION,
    changeId: id,
    action: "RUN_PROOF",
    boundary: null,
    command: command(`proof advance ${id}`),
    resumeCommand: command(`advance ${id}`)
  };
}

export function createAdvanceRuntime({
  loadRuntime, agentDispatchValue, relevantHash, deliveredAiAttempts,
  authorityStatusValue, authorityNext, readJson, proofAdvancePath, stableHash,
  proofReadinessValue = null, output = console.log
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
    return coordinatorAction({
      id,
      state,
      dispatch,
      workspaceHash: relevantHash(id),
      latestReview: deliveredAiAttempts(id).at(-1) || null,
      proofCursor: readJson(proofAdvancePath(id), {}),
      authorityRequests: openRequests,
      proofPreflight,
      authorityActions: authorityNext
        ? authorityNext(id, openRequests[0]?.type || "review", openRequests) : null,
      stableHash
    });
  }

  function showAdvance(id, flags = {}) {
    const value = advanceValue(id);
    output(JSON.stringify(value, null, flags.pretty ? 2 : 0));
    return value;
  }

  return { advanceValue, showAdvance };
}
