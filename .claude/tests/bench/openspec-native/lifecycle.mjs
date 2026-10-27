// Scripted lifecycle lane: one disposable consumer carries two real changes
// through an amendment, SIGKILL interruptions in Build and Land, and a stacked
// Land. The harness owns lifecycle truth; this driver only injects the user's
// requirement update and the crashes, observes state, and grades the result.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const LIFECYCLE_PROTOCOL = "foundation-openspec-native-lifecycle-v1";

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}
const runtimeState = (project, changeId) =>
  readJson(join(project, ".foundation/runtime", `${changeId}.json`), {});

export function runtimeIds(project) {
  const runtime = join(project, ".foundation/runtime");
  if (!existsSync(runtime)) return [];
  return readdirSync(runtime, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") &&
      !entry.name.startsWith("latest") && !entry.name.endsWith(".prev"))
    .map((entry) => entry.name.slice(0, -5)).sort();
}

// Mid-Build: the backend repository sandbox already holds product work that
// the control root does not. T001 (backend) is underway or done, while the SDK
// and web tasks that depend on it are not finished.
export function midBuildTrigger(project) {
  const root = join(project, ".foundation/repository-sandboxes");
  if (!existsSync(root)) return false;
  const base = readText(join(project, "backend/server.mjs"));
  if (base === null) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sandbox = readText(join(root, entry.name, "backend/server.mjs"));
    if (sandbox !== null && sandbox !== base) return true;
  }
  return false;
}

// Mid-Land: at least one repository projection reached `applied-uncommitted`
// (or the change itself is `applied`) while the change is not yet archived.
export function midLandTrigger(project, changeId) {
  const state = runtimeState(project, changeId);
  if (!state.status || state.status === "archived") return false;
  if (state.status === "applied") return true;
  return Object.values(state.repositories || {}).some((repository) =>
    repository?.delivery?.status === "applied-uncommitted");
}

export function amendmentPrompt(changeId, file) {
  return [
    `Resume existing change ${changeId}. The previous host session ended unexpectedly in the middle of Build.`,
    `The product owner has since approved requirement update 1, written in ${file} at the project root. Read it.`,
    "Apply it to this same change with claude-foundation change amend (change amend --template is the schema contract); do not start a new change.",
    "Keep every still-valid completed task and its evidence, build the remainder, add meaningful tests for the new and revised behavior, and verify each task only through its returned checkCommand (claude-foundation exec ...).",
    `Then run claude-foundation advance ${changeId} --through proven. Never run a test runner (npm test, node --test, pytest) directly; it is not pre-allowed. Do not Land.`,
    "If Prove's reviewer stops on an infrastructure error and the only offered fix is authority reset-infra, this disposable benchmark's main-session self-review waiver is the user decision: run it with --decision-ref user-prompt:main-session-self-review-waiver and continue."
  ].join(" ");
}

export function stackedPrompt(file, waitingChangeId) {
  return [
    `/dev implement ${file} as a new, separate change in this project.`,
    `Change ${waitingChangeId} is already proven and waiting to Land in the same repositories; do not modify, amend, abandon or Land it.`,
    "Build this feature against the code as it exists now and add meaningful tests."
  ].join(" ");
}

// What the harness itself said when Land of this change did not archive: the
// agent works from that route, as it would in a user's session.
export function describeLandRoute(stdout) {
  let value = null;
  try { value = JSON.parse(String(stdout || "").trim()); } catch { /* not JSON */ }
  if (!value || typeof value !== "object") return String(stdout || "").trim().slice(0, 600) || "no output";
  return [value.action && `action ${value.action}`, value.errorCode && `error ${value.errorCode}`,
    value.reason && `reason: ${value.reason}`, value.instruction && `instruction: ${value.instruction}`,
    value.resumeCommand && `resume: ${value.resumeCommand}`].filter(Boolean).join("; ").slice(0, 1200);
}

export function landPrompt(changeId, landedChangeId, landRoute) {
  return [
    `Land existing change ${changeId}. Change ${landedChangeId} has already landed (uncommitted) in the target repositories; its landed edits are part of the target and must be kept.`,
    `Run claude-foundation advance ${changeId} --through archived. A previous attempt returned: ${landRoute}`,
    "If Land returns a repair route, follow it inside the approved agreement: reconcile your sandbox copy with the landed target content (keep the landed content and apply your change's behavior on top of it), re-verify each task only through its returned checkCommand, then resume the same advance command until the change is archived.",
    `Never run a test runner directly. Do not modify, undo or re-land ${landedChangeId}.`
  ].join(" ");
}

function withScope(scope, fn) {
  const previous = process.env.ORDER_ORACLE_SCOPE;
  process.env.ORDER_ORACLE_SCOPE = scope;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env.ORDER_ORACLE_SCOPE;
    else process.env.ORDER_ORACLE_SCOPE = previous;
  }
}

function git(cwd, args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

function archivedPacket(project, changeId) {
  const state = runtimeState(project, changeId);
  const recorded = state.archivedChangePath ? join(project, state.archivedChangePath) : null;
  if (recorded && existsSync(recorded)) return recorded;
  const archive = join(project, "openspec/changes/archive");
  if (!existsSync(archive)) return null;
  const match = readdirSync(archive).filter((name) => name.endsWith(`-${changeId}`)).sort().at(-1);
  return match ? join(archive, match) : null;
}

function check(status, detail) { return { status, detail }; }

export async function runLifecycle({ project, args, config, deps }) {
  const {
    runClaude, runBenchmarkOracle, mergeHostExecutions, remainingTimeoutMs,
    oracleRepairPrompt, changeLoopAuthority, backendLandArgs, hostSessionRecords
  } = deps;
  const phasesDir = resolve(config.phases_dir);
  const totalTimeoutMs = Number(args["timeout-ms"] || 1800000);
  const maxRepairs = Number(config.max_oracle_repairs ?? 3);
  const maxMerges = Number(config.max_merge_sessions ?? 3);
  const costCap = args["max-cost-usd"] ? Number(args["max-cost-usd"]) : null;
  const requestCap = args["max-model-requests"] ? Number(args["max-model-requests"]) : null;
  const toolCap = args["max-tool-calls"] ? Number(args["max-tool-calls"]) : null;
  const oraclePath = args.oracle;
  const harness = join(project, ".claude/harness/foundation.mjs");
  const authority = changeLoopAuthority({
    selfReviewAuthorized: args["test-self-review"] === "true",
    landAuthorized: args["test-land"] === "true", oracleConfigured: true
  });
  const phases = [];
  const interruptions = [];
  const seedHeads = Object.fromEntries(["backend", "sdk", "web"].map((id) =>
    [id, git(join(project, id), ["rev-parse", "HEAD"])]));
  let execution = null;
  let stop = null;
  const startedClock = performance.now();

  // A session with no result envelope (SIGKILLed, or stopped by the runner
  // before the host wrote it) has unknown cost. For budgeting only, it is
  // charged at the smaller of its own allowance and a reserve; the scorecard
  // keeps it unmeasured, never zero.
  const reserveUsd = Number(config.unmeasured_session_reserve_usd ?? 8);
  const spentUsd = () => {
    if (!execution) return 0;
    let total = 0;
    for (const record of hostSessionRecords(execution)) {
      if (Number.isFinite(record.cost?.value)) total += record.cost.value;
      else total += Number.isFinite(record.unmeasuredChargeUsd) ? record.unmeasuredChargeUsd : reserveUsd;
    }
    return total;
  };
  const budgetLeft = () => {
    const used = performance.now() - startedClock;
    const remainingMs = remainingTimeoutMs(totalTimeoutMs, used);
    const spent = spentUsd();
    const cost = costCap === null ? undefined : spent === null ? null : Math.max(0, costCap - spent);
    const requests = requestCap !== null
      ? requestCap - Number(execution?.observedModelRequests || 0) : null;
    const tools = toolCap !== null ? toolCap - Number(execution?.observedToolCalls || 0) : null;
    const exhausted = used >= totalTimeoutMs - 5000 || cost === null || cost === 0 ||
      (requests !== null && requests <= 0) || (tools !== null && tools <= 0);
    return { remainingMs, cost, requests, tools, exhausted };
  };

  const session = async (name, prompt, options = {}) => {
    const left = budgetLeft();
    if (left.exhausted) {
      stop = { kind: left.cost === null ? "cost-measurement" : "budget", phase: name };
      phases.push({ name, status: "not-run", reason: "budget" });
      return null;
    }
    const allowance = Number.isFinite(options.allowanceUsd)
      ? (left.cost === undefined ? options.allowanceUsd : Math.min(options.allowanceUsd, left.cost)) : left.cost;
    const claudeArgs = allowance !== undefined
      ? [...args["claude-arg"], "--max-budget-usd", String(allowance)] : args["claude-arg"];
    const { allowanceUsd, landAuthority, ...hostOptions } = options;
    // The stacked Land is the one place the host holds Land authority, as a
    // user's `/land` would.
    const sessionAuthority = landAuthority ? changeLoopAuthority({
      selfReviewAuthorized: args["test-self-review"] === "true", landAuthorized: true,
      oracleConfigured: false }) : authority;
    const result = await runClaude({
      project, prompt: [prompt, sessionAuthority].filter(Boolean).join("\n\n"),
      claudeBin: args["claude-bin"] || "claude", claudeArgs,
      timeoutMs: left.remainingMs, maxModelRequests: left.requests, maxToolCalls: left.tools,
      selfReviewAuthorized: args["test-self-review"] === "true",
      finalEnvelopeGraceMs: args["final-envelope-grace-ms"] !== undefined
        ? Number(args["final-envelope-grace-ms"]) : 15000,
      ...hostOptions
    });
    execution = execution ? mergeHostExecutions(execution, result) : result;
    execution.hostSessions = hostSessionRecords(execution);
    const last = execution.hostSessions.length - 1;
    if (!Number.isFinite(execution.hostSessions[last].cost?.value))
      execution.hostSessions[last] = { ...execution.hostSessions[last],
        unmeasuredChargeUsd: Math.min(allowance ?? reserveUsd, reserveUsd) };
    if (result.interrupted) interruptions.push({ phase: name, ...result.interrupted });
    phases.push({ name, status: result.terminalReached?.status || (result.interrupted ? "interrupted" : "ended"),
      exitCode: result.exitCode, wallMs: result.stopwatch?.wallMs ?? null });
    if (result.budgetExhausted || result.decisionBoundary || result.timedOut)
      stop = { kind: result.budgetExhausted?.kind || (result.timedOut ? "timeout" : "decision"), phase: name };
    return result;
  };

  const newChange = (before) => runtimeIds(project).filter((id) => !before.includes(id));

  // The oracle gates Land; a failing pre-Land oracle sends the failed cases
  // back to the host as one repair batch, the same route the single-change
  // lane uses, bounded by the run's budget.
  const gate = async (name, changeId, scope) => {
    let oracle = withScope(scope, () => runBenchmarkOracle({ project, changeId, oraclePath,
      timeoutMs: Number(args["oracle-timeout-ms"] || 120000) }));
    let repairs = 0;
    while (oracle.verdict !== "pass" && repairs < maxRepairs && !stop &&
        runtimeState(project, changeId).status === "proven") {
      const failed = Object.entries(oracle.results || {}).filter(([, v]) => v !== "pass").map(([id]) => id);
      if (!failed.length) break;
      repairs += 1;
      const result = await session(`${name}-repair-${repairs}`, [oracleRepairPrompt(changeId, failed),
        "Use packets and returned repair plans only; do not inspect managed harness or schema files."].join("\n\n"),
      { stopOnProven: true, changeId });
      if (!result) break;
      oracle = withScope(scope, () => runBenchmarkOracle({ project, changeId, oraclePath,
        timeoutMs: Number(args["oracle-timeout-ms"] || 120000) }));
    }
    phases.push({ name: `${name}-oracle`, status: oracle.verdict || "unavailable", repairs,
      score: oracle.score, max: oracle.max, scope });
    return { oracle, repairs };
  };

  const landSync = (changeId) => spawnSync(process.execPath, [harness, ...backendLandArgs(changeId)], {
    cwd: project, encoding: "utf8", env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    timeout: budgetLeft().remainingMs, maxBuffer: 10 * 1024 * 1024
  });

  // Land with a SIGKILL once a repository projection is applied, then the
  // documented resume route (the same advance command) finishes it.
  const landInterrupted = (changeId) => new Promise((resolveLand) => {
    const child = spawn(process.execPath, [harness, ...backendLandArgs(changeId)], {
      cwd: project, env: { ...process.env, FOUNDATION_TELEMETRY: "0" }, detached: true,
      stdio: ["ignore", "ignore", "ignore"]
    });
    let killed = null;
    const poll = setInterval(() => {
      if (killed || !midLandTrigger(project, changeId)) return;
      killed = { observedAt: new Date().toISOString(), status: runtimeState(project, changeId).status,
        repositories: Object.fromEntries(Object.entries(runtimeState(project, changeId).repositories || {})
          .map(([id, r]) => [id, r?.delivery?.status ?? null])) };
      clearInterval(poll);
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, 15);
    child.on("close", () => { clearInterval(poll); resolveLand(killed); });
  });

  const result = { changeIds: { a: null, b: null }, oracle: null };
  const known0 = runtimeIds(project);

  // 1. Change A: build until the first backend work exists, then crash.
  // `interruptions` selects the crashes to inject; a control run drops one to
  // tell a crash-related failure from a defect the same flow has without it.
  const injected = new Set(config.interruptions ?? ["mid-build", "mid-land"]);
  await session("a-build", args.prompt, injected.has("mid-build")
    ? { killWhen: ({ project: p }) => midBuildTrigger(p),
      allowanceUsd: Number(config.interrupted_session_budget_usd ?? 8) }
    : { stopOnProven: true });
  result.changeIds.a = newChange(known0)[0] ?? null;
  const midBuild = interruptions.find((row) => row.phase === "a-build") || null;

  // 2. The product owner's update arrives; resume the same change with it.
  if (result.changeIds.a && !stop) {
    cpSync(join(phasesDir, config.amendment.file), join(project, config.amendment.file));
    await session("a-amend-resume", amendmentPrompt(result.changeIds.a, config.amendment.file),
      { stopOnProven: true, changeId: result.changeIds.a });
  }
  let gateA = null;
  if (result.changeIds.a && !stop && runtimeState(project, result.changeIds.a).status === "proven")
    gateA = await gate("a", result.changeIds.a, "a");

  // 3. Stack: Change B branches while A is proven and unlanded.
  const knownBeforeB = runtimeIds(project);
  let gateB = null;
  const aProvenAtStack = result.changeIds.a ? runtimeState(project, result.changeIds.a).status : null;
  if (result.changeIds.a && gateA?.oracle.verdict === "pass" && !stop) {
    cpSync(join(phasesDir, config.stacked.file), join(project, config.stacked.file));
    await session("b-build", stackedPrompt(config.stacked.file, result.changeIds.a), { stopOnProven: true });
    result.changeIds.b = newChange(knownBeforeB)[0] ?? null;
    if (result.changeIds.b && !stop && runtimeState(project, result.changeIds.b).status === "proven")
      gateB = await gate("b", result.changeIds.b, "b");
  }

  // 4. Land A with a crash, resume it, then Land B onto A's landed bytes.
  let landA = null;
  const landOrder = [];
  if (gateA?.oracle.verdict === "pass" && gateB?.oracle.verdict === "pass" && !stop) {
    const killed = injected.has("mid-land") ? await landInterrupted(result.changeIds.a) : null;
    if (killed) interruptions.push({ phase: "a-land", ...killed });
    let attempt = landSync(result.changeIds.a);
    landA = { killed: Boolean(killed), resumeExit: attempt.status,
      status: runtimeState(project, result.changeIds.a).status };
    phases.push({ name: "a-land", status: landA.status, interrupted: Boolean(killed) });
    if (landA.status === "archived") landOrder.push(result.changeIds.a);
  }
  // B lands onto A's uncommitted bytes. The backend tries first; whatever the
  // harness answers is the route a user's agent would be handed, so a session
  // with Land authority for B works from it until B archives.
  let landB = null;
  if (landOrder.length && !stop) {
    let attempts = 0;
    let attempt = landSync(result.changeIds.b);
    const firstRoute = runtimeState(project, result.changeIds.b).status === "archived"
      ? null : describeLandRoute(attempt.stdout);
    while (runtimeState(project, result.changeIds.b).status !== "archived" && attempts < maxMerges && !stop) {
      attempts += 1;
      const landed = await session(`b-land-${attempts}`,
        landPrompt(result.changeIds.b, result.changeIds.a, describeLandRoute(attempt.stdout)),
        { stopOnArchived: true, changeId: result.changeIds.b, landAuthority: true });
      if (!landed) break;
      if (runtimeState(project, result.changeIds.b).status !== "archived") attempt = landSync(result.changeIds.b);
    }
    const status = runtimeState(project, result.changeIds.b).status;
    if (status === "archived") landOrder.push(result.changeIds.b);
    landB = { status, agentSessions: attempts, firstRoute };
    phases.push({ name: "b-land", status, agentSessions: attempts });
  }

  // 5. Grade the landed tree and the lifecycle facts.
  const archivedBoth = landOrder.length === 2;
  const final = withScope("full", () => runBenchmarkOracle({ project, changeId: result.changeIds.b ?? result.changeIds.a,
    oraclePath, timeoutMs: Number(args["oracle-timeout-ms"] || 120000) }));
  result.oracle = final;
  const packetA = result.changeIds.a ? archivedPacket(project, result.changeIds.a) : null;
  const packetB = result.changeIds.b ? archivedPacket(project, result.changeIds.b) : null;
  const proposalA = packetA ? readText(join(packetA, "proposal.md")) : null;
  const archivedAt = (id) => runtimeState(project, id).archivedAt ?? null;
  const unchecked = (packet) => {
    const text = packet ? readText(join(packet, "tasks.md")) : null;
    return text === null ? null : text.split(/\r?\n/).filter((l) => /^\s*-\s*\[\s\]/.test(l)).length;
  };
  const expectedIds = [result.changeIds.a, result.changeIds.b].filter(Boolean).sort();
  const checks = {
    "interrupt-mid-build-injected": !injected.has("mid-build") ? check("unavailable", "not requested (control run)")
      : midBuild ? check("pass", { requests: midBuild.requests, wallMs: Math.round(midBuild.wallMs) })
      : check("fail", "the host ended before the mid-Build trigger fired"),
    "resumed-same-change": result.changeIds.a && phases.some((p) => p.name === "a-amend-resume") &&
        JSON.stringify(runtimeIds(project)) === JSON.stringify(expectedIds)
      ? check("pass", expectedIds) : check("fail", { runtimeIds: runtimeIds(project) }),
    // The harness records the amendment in its runtime state; the archived
    // proposal is expected to carry it as its Amendment history appendix.
    "amendment-recorded": Array.isArray(runtimeState(project, result.changeIds.a).amendments) &&
        runtimeState(project, result.changeIds.a).amendments.length > 0
      ? check("pass", { amendments: runtimeState(project, result.changeIds.a).amendments.length })
      : check("fail", "the runtime state has no amendment record"),
    "amendment-in-archived-packet": proposalA
      ? (/Amendment history/i.test(proposalA) ? check("pass") : check("fail", "no Amendment history in the archived proposal"))
      : check("unavailable", "change A has no archived packet"),
    "stacked-before-land": aProvenAtStack === "proven" && result.changeIds.b && gateB
      ? check("pass") : check("fail", { aStatusWhenBBranched: aProvenAtStack }),
    "interrupt-mid-land-injected": !injected.has("mid-land") ? check("unavailable", "not requested (control run)")
      : landA ? (landA.killed ? check("pass") : check("fail", "Land finished before the mid-Land trigger fired"))
      : check("unavailable", "Land of change A did not start"),
    "land-resumed-to-archived": landA?.status === "archived" ? check("pass") : check("fail", landA),
    "land-order": archivedBoth && landOrder[0] === result.changeIds.a && landOrder[1] === result.changeIds.b &&
        (!archivedAt(landOrder[0]) || !archivedAt(landOrder[1]) || archivedAt(landOrder[0]) <= archivedAt(landOrder[1]))
      ? check("pass", landOrder) : check("fail", landOrder),
    "tasks-complete": archivedBoth && unchecked(packetA) === 0 && unchecked(packetB) === 0
      ? check("pass") : check(archivedBoth ? "fail" : "unavailable", { a: unchecked(packetA), b: unchecked(packetB) }),
    "no-commit": Object.entries(seedHeads).every(([id, head]) => head && git(join(project, id), ["rev-parse", "HEAD"]) === head)
      ? check("pass") : check("fail", "a repository HEAD moved"),
    "final-oracle": final.verdict === "pass" ? check("pass", { score: final.score, max: final.max })
      : check(final.verdict ? "fail" : "unavailable", final.reason ?? final.results)
  };
  const strict = archivedBoth && Object.values(checks).every((row) => row.status === "pass");
  // The lane's wall time is the whole elapsed lifecycle (sessions, oracle
  // gates and Land), not just the sum of host sessions.
  if (execution) execution.stopwatch = { ...execution.stopwatch,
    wallMs: performance.now() - startedClock, finishedAt: new Date().toISOString() };
  return {
    ...result, execution, stop,
    summary: {
      protocol: LIFECYCLE_PROTOCOL, strict, phases, interruptions, landOrder,
      repairs: { a: gateA?.repairs ?? null, b: gateB?.repairs ?? null },
      landB, checks
    }
  };
}
