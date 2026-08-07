export function createBudgetRuntime({ policy, now }) {
  // Spend is new work: what the model read fresh, wrote, and cached for later.
  // Cache reads are excluded on purpose. Every turn re-reads the whole
  // conversation, so counting them makes measured spend grow with session
  // length rather than with the work done, and the budget stops meaning
  // anything. Context re-read is reported separately by `metrics`.
  function eventTokenCount(event) {
    // `Number(null)` is 0 and 0 is finite, so an event that explicitly reports
    // "unknown" as null used to derive a cache write of 0 and then a total of
    // 0 — a measured zero where nothing was measured. Unknown is never zero.
    const known = (value) =>
      value !== null && value !== undefined && Number.isFinite(Number(value));
    const cacheWrite = event.cacheCreationTokens ?? (
      known(event.cacheTokens) && known(event.cacheReadTokens)
        ? Number(event.cacheTokens) - Number(event.cacheReadTokens) : null);
    const values = [event.inputTokens, event.outputTokens, cacheWrite].filter(known);
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  }

  function budgetTargets(schema) {
    const configured = policy().execution.tokenBudgets;
    return {
      requests: schema === "foundation-rapid" ? 80 : 160,
      tokens: schema === "foundation-rapid" ? configured.rapid : configured.standard
    };
  }

  function budgetWindow(id, targets, baseline = {}, sequence = 1, reason = "initial-run") {
    return {
      id,
      extensionRootId: id,
      extensionNumber: 0,
      sequence,
      targetRequests: targets.requests,
      targetTokens: targets.tokens,
      baselineRequests: Number(baseline.requests || 0),
      baselineTokens: Number(baseline.tokens || 0),
      usedRequests: 0,
      usedTokens: 0,
      mode: "normal",
      reason,
      startedAt: now(),
      exhaustedAt: null,
      closedAt: null
    };
  }

  function initialBudget(schema, id) {
    const targets = budgetTargets(schema);
    const runId = process.env.FOUNDATION_RUN_ID ||
      process.env.FOUNDATION_CLAUDE_SESSION_ID || id;
    return {
      version: 3,
      measures: "input+output+cache-write; cache reads excluded",
      targetRequests: targets.requests,
      targetTokens: targets.tokens,
      usedRequests: null,
      usedTokens: null,
      measurement: "unavailable-until-external-events",
      lifetime: { usedRequests: null, usedTokens: null },
      window: budgetWindow(runId, targets)
    };
  }

  function knownNumber(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function ensureBudgetState(state) {
    const existing = state.budget || {};
    const defaults = budgetTargets(state.schema);
    const targets = {
      requests: knownNumber(existing.targetRequests)
        ? Number(existing.targetRequests) : defaults.requests,
      tokens: knownNumber(existing.targetTokens)
        ? Number(existing.targetTokens) : defaults.tokens
    };
    if (existing.version !== 3 || !existing.lifetime || !existing.window) {
      const legacyRequests = knownNumber(existing.usedRequests)
        ? Number(existing.usedRequests) : null;
      // Version 2 counted cache reads as spend. Those totals do not mean the
      // same thing here, so they are dropped rather than carried forward; the
      // next telemetry sync recomputes them from the retained events.
      const legacyTokens = existing.version === 2 ? null
        : knownNumber(existing.usedTokens) ? Number(existing.usedTokens) : null;
      state.budget = {
        version: 3,
        measures: "input+output+cache-write; cache reads excluded",
        targetRequests: targets.requests,
        targetTokens: targets.tokens,
        usedRequests: legacyRequests,
        usedTokens: legacyTokens,
        measurement: existing.measurement || "unavailable-until-external-events",
        lifetime: { usedRequests: legacyRequests, usedTokens: legacyTokens },
        window: budgetWindow(`${state.id}:post-upgrade`, targets, {}, 1, "runtime-upgrade")
      };
    } else {
      state.budget.targetRequests = targets.requests;
      state.budget.targetTokens = targets.tokens;
      state.budget.lifetime.usedRequests = knownNumber(state.budget.lifetime.usedRequests)
        ? Number(state.budget.lifetime.usedRequests) : null;
      state.budget.lifetime.usedTokens = knownNumber(state.budget.lifetime.usedTokens)
        ? Number(state.budget.lifetime.usedTokens) : null;
      state.budget.usedRequests = state.budget.lifetime.usedRequests;
      state.budget.usedTokens = state.budget.lifetime.usedTokens;
      if (!knownNumber(state.budget.window.targetRequests))
        state.budget.window.targetRequests = targets.requests;
      if (!knownNumber(state.budget.window.targetTokens))
        state.budget.window.targetTokens = targets.tokens;
    }
    return state.budget;
  }

  function eventUsage(events) {
    const knownTokens = events.map(eventTokenCount).filter((value) => value !== null);
    return {
      requests: events.length,
      tokens: knownTokens.length
        ? knownTokens.reduce((sum, value) => sum + value, 0)
        : events.length ? null : 0
    };
  }

  function activateBudgetWindow(state, runId, reason = "new-run", priorEvents = []) {
    const budget = ensureBudgetState(state);
    if (!runId || budget.window.id === runId) return budget.window;
    const targets = {
      requests: Number(budget.targetRequests),
      tokens: Number(budget.targetTokens)
    };
    const previous = budget.window;
    const priorRunUsage = eventUsage(priorEvents.filter((event) => event.runId === runId));
    budget.window = budgetWindow(runId, targets, priorRunUsage,
      Number(previous.sequence || 0) + 1, reason);
    // A new run id resets this window's usage — that is what a genuine host
    // session rollover means. It must not also hand back the *allowance*: the
    // run id is caller-supplied, so clearing an operator stop or the
    // one-extension cap here would let `--run anything-new` re-arm the gate
    // indefinitely with no decision recorded. Only `budget continue` widens
    // the allowance, and it records why.
    budget.window.extensionRootId = previous.extensionRootId || previous.id || null;
    budget.window.extensionNumber = Number(previous.extensionNumber || 0);
    if (previous.mode === "operator-required") budget.window.mode = "operator-required";
    return budget.window;
  }

  function budgetDecision(state) {
    const budget = ensureBudgetState(state);
    const window = budget.window;
    const requestRatio = knownNumber(window.usedRequests)
      ? Number(window.usedRequests) / Number(window.targetRequests || 1) : 0;
    const tokenRatio = knownNumber(window.usedTokens)
      ? Number(window.usedTokens) / Number(window.targetTokens || 1) : 0;
    const ratio = Math.max(requestRatio, tokenRatio);
    const limiter = tokenRatio > requestRatio ? "tokens" : "requests";
    const operatorRequired = window.mode === "operator-required";
    const mode = operatorRequired ? "operator-required" :
      ratio >= 0.85 ? "completion-only" : ratio >= 0.7 ? "conserve" : "normal";
    const action = operatorRequired ? "OPERATOR_REQUIRED" :
      ratio >= 1 ? "COMPLETION_ONLY" : ratio >= 0.85 ? "COMPLETION_ONLY" :
        ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
    const recommendation = operatorRequired ? "CONTINUE_OR_RESCOPE" :
      ratio >= 1 ? "STOP_AND_RESCOPE" : ratio >= 0.85 ? "STOP_EXPLORATION" :
        ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
    return {
      ratio, limiter, mode, action, recommendation,
      allowed: mode === "completion-only" ? [
        "focused-fix", "provider-run", "receipt-reuse", "proof-resume",
        "metrics", "land-recovery", "archive"
      ] : mode === "operator-required" ? [
        "packet", "readiness", "receipt-reuse", "metrics", "budget-continue", "archive"
      ] : ["scoped-execution"],
      forbidden: mode === "completion-only" ? [
        "scope-expansion", "speculative-investigation", "new-subagent", "optional-refactor"
      ] : mode === "operator-required" ? [
        "model-exploration", "new-subagent", "scope-expansion"
      ] : []
    };
  }

  function applyBudgetDecision(state) {
    const decision = budgetDecision(state);
    const window = state.budget.window;
    if (window.mode !== "operator-required") window.mode = decision.mode;
    if (decision.ratio >= 1 && !window.exhaustedAt) window.exhaustedAt = now();
    return decision;
  }

  function synchronizeBudgetUsage(state, events, runId, measurement, newEventCount = 0) {
    const budget = ensureBudgetState(state);
    const priorEvents = newEventCount > 0
      ? events.slice(0, Math.max(0, events.length - newEventCount)) : events;
    activateBudgetWindow(state, runId, "new-run", priorEvents);
    const lifetimeUsage = eventUsage(events);
    const activeRunUsage = eventUsage(events.filter((event) => event.runId === budget.window.id));
    const requestTotal = events.length ? lifetimeUsage.requests : null;
    const tokenTotal = events.length ? lifetimeUsage.tokens : null;
    budget.lifetime.usedRequests = requestTotal;
    budget.lifetime.usedTokens = tokenTotal;
    budget.usedRequests = requestTotal;
    budget.usedTokens = tokenTotal;
    budget.measurement = measurement;
    budget.window.usedRequests = Math.max(0,
      activeRunUsage.requests - Number(budget.window.baselineRequests || 0));
    budget.window.usedTokens = activeRunUsage.tokens === null ? null : Math.max(0,
      activeRunUsage.tokens - Number(budget.window.baselineTokens || 0));
    return applyBudgetDecision(state);
  }

  return {
    eventTokenCount, budgetWindow, initialBudget, knownNumber, ensureBudgetState, eventUsage,
    activateBudgetWindow, budgetDecision, applyBudgetDecision, synchronizeBudgetUsage
  };
}
