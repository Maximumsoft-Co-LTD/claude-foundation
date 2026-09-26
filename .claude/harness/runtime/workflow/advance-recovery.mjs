import { gateDigest } from "../core/convergent-gate.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

// Complete legacy diagnostic packets at the lifecycle boundary. Missing detail
// offers investigation, never a fabricated approval, waiver, or successful run.
export function actionableGuidance(value) {
  if (value.action === "ASK_USER") {
    const supplied = value.decision || {};
    const options = [...new Map((Array.isArray(supplied.options) ? supplied.options : [])
      .filter((row) => text(row?.id) && text(row?.outcome))
      .map((row) => [row.id, row])).values()];
    if (!options.length) options.push(value.boundary === "land-authority"
      ? { id: "land", outcome: "Authorize applying and archiving this exact proven change." }
      : { id: "investigate", outcome: "Investigate the reported cause and choose a concrete repair before resuming." });
    if (!options.some((row) => row.id === "pause"))
      options.push({ id: "pause", outcome: "Preserve the work and pause until a decision is made." });
    if (options.length < 2)
      options.unshift({ id: "investigate", outcome: "Inspect the cause and available recovery before choosing." });
    return { ...value, decision: {
      ...supplied,
      kind: supplied.kind || (value.boundary === "land-authority" ? "land-authority" : "work-decision"),
      summary: supplied.summary || value.reason || "Choose how to continue the preserved work.",
      options,
      recommended: options.some((row) => row.id === supplied.recommended)
        ? supplied.recommended : options.find((row) => ["investigate", "retry"].includes(row.id))?.id || "pause"
    } };
  }
  if (value.action === "WAIT" || value.legacyAction === "PROOF_IN_PROGRESS") {
    const request = value.requests?.[0];
    const worker = value.wait?.workers?.[0];
    return { ...value, wait: {
      ...value.wait,
      owner: value.wait?.owner || request?.reviewer || request?.owner || worker?.owner || value.actor,
      condition: value.wait?.condition || value.reason || "The current operation finishes and its result becomes available.",
      checkCommand: value.wait?.checkCommand || value.command || value.resume,
      requestId: value.wait?.requestId || value.requestId || request?.requestId || null
    } };
  }
  return value;
}

export function automaticRecoveryAction(id, decision) {
  // Only typed, known recovery routes can execute. Never execute a command
  // extracted from reviewer text, exception messages, or arbitrary options.
  if (decision?.kind !== "control-head-moved" || decision.automaticRecovery !== "sync") return null;
  return {
    kind: "sandbox-sync",
    command: `claude-foundation sandbox sync ${id}`,
    reason: decision.summary
  };
}

export function currentDeliveryProof({ proofAudit, relevantHash, requiredProviders,
  receiptValidity, receiptPath, fileDigest }, id) {
  const audit = proofAudit(id, true);
  if (!audit.valid) return false;
  const hash = relevantHash(id, null, true);
  if (audit.proof.workspaceHash !== hash) return false;
  return requiredProviders(id).every((provider) => {
    if (receiptValidity(id, provider, hash).validity !== "valid") return false;
    const manifest = audit.proof.receipts.find((row) => row.provider === provider);
    return manifest && manifest.sha256 === fileDigest(receiptPath(id, provider));
  });
}

export function recoveryBoundaryKey(value) {
  // Diagnostic prose can contain timestamps, attempt counters or transport
  // details. It describes an observation, not a new recovery boundary.
  return gateDigest({
    action: value.action, route: value.legacyAction || null,
    boundary: value.boundary || null,
    decision: value.decision?.kind || null,
    command: value.command || null,
    ...(value.action === "WAIT" ? { wait: {
      owner: value.wait?.owner || null,
      condition: value.wait?.condition || null,
      checkCommand: value.wait?.checkCommand || null
    } } : {}),
    requests: (value.requests || []).map((row) => ({
      id: row.requestId, status: row.status
    }))
  });
}

export function createAdvanceRecovery({ loadRuntime, saveRuntime, subject, now = () => new Date().toISOString() }) {
  function read(id, state = loadRuntime(id)) {
    const binding = subject(id);
    const current = state.advanceRecovery;
    const record = current?.version === 1 && current.subject === binding
      ? current : { version: 1, subject: binding, attempts: [], answers: current?.answers || [] };
    return { state, binding, record };
  }

  function save(state, record) {
    state.advanceRecovery = record;
    saveRuntime(state);
  }

  function decision(id, value, record) {
    const key = recoveryBoundaryKey(value);
    const kind = "repair-no-progress";
    const fingerprint = gateDigest({ subject: record.subject, key, kind });
    const options = [
      { id: "retry", outcome: "Choose a different repair strategy or explain what changed, then retry within the existing scope." },
      { id: "pause", outcome: "Keep all work and evidence and pause this delivery attempt." }
    ].map((row) => ({ ...row,
      command: `claude-foundation advance ${id} --decision ${row.id} --decision-fingerprint ${fingerprint} --decision-ref <user-answer> --reason <chosen-approach>`
    }));
    return {
      kind, fingerprint,
      summary: `Recovery has not changed the delivery state: ${value.reason}`,
      options, recommended: "retry",
      attemptedStrategies: record.attempts.slice(-8).map(({ action, reason, command, count }) =>
        ({ action, reason, command, observations: count })),
      wait: null
    };
  }

  function observe(id, value, { force = false } = {}) {
    const { state, record } = read(id);
    if (value.action === "DONE") {
      if (state.advanceRecovery) save(state, { ...record, attempts: [], pending: null });
      return value;
    }
    const key = recoveryBoundaryKey(value);
    // Only repeated repair can become a question. Waiting on a named external
    // owner is the default, not a question: the WAIT already carries the
    // owner, condition, and resume route.
    if (value.action !== "REPAIR") return value;
    const prior = record.attempts.find((row) => row.key === key);
    const attempt = {
      key, action: value.action, reason: value.reason, command: value.command || null,
      count: (prior?.count || 0) + 1, observedAt: now(),
      ...(prior?.alternateRequested ? { alternateRequested: prior.alternateRequested } : {})
    };
    record.attempts = [...record.attempts.filter((row) => row.key !== key), attempt].slice(-16);
    // Before asking, the agent gets one turn to try a materially different
    // repair inside the approved agreement. Recorded so it happens once per key.
    if (!force && attempt.count >= 3 && !attempt.alternateRequested) {
      attempt.alternateRequested = now();
      save(state, record);
      return { ...value, action: "REPAIR", actor: "agent", owner: "agent",
        legacyAction: "TRY_ALTERNATE_APPROACH", boundary: "alternate-approach",
        reason: `The same repair returned ${attempt.count} times without progress: ${value.reason}. ` +
          "Try a materially different approach inside the approved agreement, then resume.",
        attemptedStrategies: record.attempts.slice(-8).map(({ action, reason, command, count }) =>
          ({ action, reason, command, observations: count })),
        recoveryType: "EDIT"
      };
    }
    if (force || attempt.count >= 3) {
      const pending = record.pending?.key === key ? record.pending : {
        key, decision: decision(id, value, record),
        through: value.resume?.match(/--through (build|proven|archived)/)?.[1] || null
      };
      record.pending = pending;
      save(state, record);
      return { ...value, action: "ASK_USER", actor: "user", owner: "user",
        legacyAction: "NO_PROGRESS_BOUNDARY",
        boundary: "repeated-no-progress",
        reason: pending.decision.summary, decision: pending.decision,
        recovery: { type: "ASK_USER", statePreserved: true,
          alternatives: pending.decision.options.map((row) => row.outcome) }
      };
    }
    save(state, record);
    return value;
  }

  function pending(id) {
    const state = loadRuntime(id);
    // A fresh/legacy runtime has nothing to validate. Hashing it here would
    // require complete repository bindings before Build can repair them.
    if (!state.advanceRecovery?.pending) return null;
    const { record } = read(id, state);
    return record.pending || null;
  }

  function resolve(id, flags) {
    const { state, record } = read(id);
    const current = record.pending;
    const choice = text(flags.decision);
    const reference = text(flags["decision-ref"]);
    const reason = text(flags.reason);
    const previous = record.answers.find((row) => row.reference === reference);
    if (previous) {
      if (previous.subject === record.subject && previous.fingerprint === flags["decision-fingerprint"] &&
          previous.choice === choice && previous.reason === reason)
        return { choice, through: previous.through };
      throw new Error("This decision reference already records a different or stale recovery answer.");
    }
    if (!current || flags["decision-fingerprint"] !== current.decision.fingerprint)
      throw new Error("Recovery decision is stale or absent; inspect the current action before recording an answer.");
    if (!reference || !reason) throw new Error("Recovery decisions require an explicit user decision-ref and reason.");
    if (reference.length > 160 || reason.length > 2000)
      throw new Error("Recovery decision references are limited to 160 characters and reasons to 2000 characters.");
    if (!current.decision.options.some((row) => row.id === choice))
      throw new Error("Recovery choice is not offered by the current decision.");
    record.answers.push({ subject: record.subject, key: current.key,
      fingerprint: current.decision.fingerprint, choice, reference, reason,
      through: current.through, recordedAt: now() });
    if (choice !== "pause") {
      record.attempts = record.attempts.filter((row) => row.key !== current.key);
      record.pending = null;
    } else record.pending.paused = true;
    save(state, record);
    return { choice, through: current.through };
  }

  return { observe, pending, resolve };
}
