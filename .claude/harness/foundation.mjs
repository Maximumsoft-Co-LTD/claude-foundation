#!/usr/bin/env node

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createMetricsRuntime } from "./runtime/observability/metrics-runtime.mjs";
import { createExecRuntime } from "./runtime/observability/exec-runtime.mjs";
import { createTelemetryRuntime } from "./runtime/observability/telemetry-runtime.mjs";
import {
  createHostExecutionStore, createModelDriftInspector, hostExecutionTelemetryRows
} from "./runtime/observability/host-execution-contract.mjs";
import { createHostAttestationRuntime } from "./runtime/evidence/attestation.mjs";
import { validateSignedCiEnvelope } from "./runtime/evidence/signed-ci.mjs";
import { createAuthorityStore } from "./runtime/workflow/authority.mjs";
import { createBudgetRuntime } from "./runtime/workflow/budget.mjs";
import {
  adapterResources as resultAdapterResources,
  configuredCommand,
  mutationProtocolResult,
  numericReportValue,
  parseJsonOutput,
  parseTapOutput,
  playwrightReportSummary,
  resourcesConflict
} from "./runtime/evidence/evidence-results.mjs";
import { createFlagParser } from "./runtime/core/cli-flags.mjs";
import {
  phaseForCommand, telemetryPhaseForCommand
} from "./runtime/core/lifecycle-phase.mjs";
import { createProcessRuntime } from "./runtime/core/process-runtime.mjs";
import { createInstructionManifest } from "./runtime/core/instruction-manifest.mjs";
import { createAgentPlanner } from "./runtime/workflow/agent-planning.mjs";
import { createSandboxRuntime } from "./runtime/workflow/sandbox-runtime.mjs";
import { createLandJournal } from "./runtime/workflow/land-journal.mjs";
import { createProofRuntime } from "./runtime/evidence/proof-runtime.mjs";
import { createRepositoryTopology } from "./runtime/workflow/repository-topology.mjs";
import { createPacketRuntime } from "./runtime/workflow/packet-runtime.mjs";
import { createChangeLifecycle } from "./runtime/workflow/change-lifecycle.mjs";
import { createLeaseRuntime } from "./runtime/workflow/lease-runtime.mjs";
import { createAuthorityRuntime } from "./runtime/workflow/authority-runtime.mjs";
import {
  assertOpenSpecCli, createLandRuntime, openSpecCliStatus
} from "./runtime/workflow/land-runtime.mjs";
import { createApplyRuntime } from "./runtime/workflow/apply-runtime.mjs";
import { createDiagnosticsRuntime } from "./runtime/core/diagnostics-runtime.mjs";
import { createStateRuntime } from "./runtime/core/state-runtime.mjs";
import {
  createEvidenceContract,
  REVIEW_FORCING_CAPABILITIES,
  REVIEW_DIVERSITY_CAPABILITIES
} from "./runtime/evidence/evidence-contract.mjs";
import { createChangeValidationRuntime } from "./runtime/workflow/change-validation.mjs";
import { routeRuntimeCommand } from "./runtime/core/cli-router.mjs";
import { createProviderScheduler } from "./runtime/evidence/provider-scheduler.mjs";
import { createReviewProtocol } from "./runtime/evidence/review-protocol.mjs";
import { createArtifactStore } from "./runtime/evidence/artifact-store.mjs";
import { createReviewAttemptStore } from "./runtime/evidence/review-attempt-store.mjs";
import { createProofReadinessRuntime } from "./runtime/evidence/proof-readiness.mjs";
import { createReceiptRuntime } from "./runtime/evidence/receipt-runtime.mjs";
import { createAdapterRuntime } from "./runtime/evidence/adapter-runtime.mjs";
import { createProofExecutionRuntime } from "./runtime/evidence/proof-execution-runtime.mjs";
import { createBlockedDecision } from "./runtime/core/blocked-decision.mjs";
import { createAbandonRuntime } from "./runtime/workflow/abandon-runtime.mjs";
import { RUNTIME_MODULE_API } from "./runtime/version.mjs";

const VERSION = "2.8.0";
const RUNTIME_API_VERSION = "18";
// Checked here, at load, rather than only inside `doctor`: a torn install —
// this file from one revision, runtime/** from another — otherwise passed
// every command up to `archive` and then threw partway through Land.
if (RUNTIME_MODULE_API !== RUNTIME_API_VERSION) {
  console.error(
    `BLOCKED: harness entrypoint API ${RUNTIME_API_VERSION} does not match ` +
    `runtime modules API ${RUNTIME_MODULE_API}; the installed .claude/harness ` +
    "is a mixture of two revisions. Reinstall it with 'claude-foundation init <project>'.");
  process.exit(1);
}
const PROVIDER_PROTOCOL_VERSION = "7";
const ADAPTER_PROTOCOL_VERSION = "4";
const PROOF_PROTOCOL_VERSION = "4";
const PACKET_SCHEMA_VERSION = "5";
const AGENT_PLAN_SCHEMA_VERSION = "3";
const CONTEXT_EVENT_SCHEMA_VERSION = "2";
const REVIEW_PROTOCOL_VERSION = "2";
const ACCEPTANCE_PROTOCOL_VERSION = "2";
const REVIEW_PACKET_SCHEMA_VERSION = "3";
const ATTESTATION_PROTOCOL_VERSION = "1";
const AUTHORITY_PROTOCOL_VERSION = "1";
const CI_EVIDENCE_PROTOCOL_VERSION = "1";
// `contract-digest` executes no command: it hashes the same declared contract
// artifact in two or more repositories and passes only when every side carries
// the identical bytes. It is what makes `cross-repo-contract` a check rather
// than an assertion.
const ADAPTERS = new Set([
  "command", "test-discovery", "playwright", "contract-digest", "external"
]);
const INPUT_MODES = new Set(["browser-automation", "dom-event", "os-input", "both"]);
// Directories that are never change surface: never hashed, never walked as
// evidence input, never projected back onto the target at apply.
//
// The generated-output entries below are deliberately limited to tool-owned
// directories whose names are unambiguous and conventionally ignored. `dist`,
// `build`, `out`, `target`, and `vendor` are NOT here on purpose: projects do
// commit source under those names, and excluding a directory removes it from
// the apply diff as well as the hash — a wrong guess here is silent data loss
// at Land, not a stale hash.
//
// This set names the directories; `runtime/core/workspace-surface.mjs` decides
// how a path is matched against it. Matching every segment at every depth was
// its own wrong guess: `.foundation` and `.workflow` mean something only at the
// project root, and a committed fixture is content whatever it is called.
const EXCLUDED_WORKSPACE_DIRS = new Set([
  ".git", ".foundation", ".workflow", "node_modules",
  "coverage", "test-results", "playwright-report",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".astro", ".parcel-cache",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__", ".tox",
  ".gradle", ".terraform"
]);
// The copy sandbox needs the same list minus `.git`. One set cannot answer both
// "what is change surface?" and "what does an isolated copy need to function?":
// `.git` must stay out of every hash and every apply diff, but a copy that
// lacks it stops being a git repository, and every git-aware path in the
// runtime then degrades to whole-tree behaviour without saying so.
const SANDBOX_COPY_EXCLUDED_DIRS = new Set(
  [...EXCLUDED_WORKSPACE_DIRS].filter((dir) => dir !== ".git")
);
const PROVIDER_CONTRACTS = {
  "test": "Executable behavioral checks for the declared claim.",
  "discovery": "Expected tests were found and the discovered count meets the floor.",
  "browser": "Rendered behavior in a real browser with the required input capability.",
  "mutation": "A deliberate behavioral fault is detected by the evidence suite.",
  "state-identity": "State before, during, or after the change belongs to the intended actor and revision.",
  "integration": "Multiple components or external boundaries work together.",
  "compatibility": "Public or persisted contracts remain compatible across supported versions.",
  "performance": "Measured latency, throughput, resource, or size budgets are met.",
  "security-static": "Static security checks cover the changed trust boundary and unsafe sinks.",
  "cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
  "review": "Independent risk review covers the declared claims and unresolved findings.",
  "acceptance": "A named human accepts an explicitly subjective product or experience decision.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes."
};
const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));
function providerCapability(provider, config = null) {
  return config?.capability || (PROVIDERS.has(provider) ? provider : null);
}
// Matched on whole words, not as substrings. As substrings these fired on
// "accessibility", "migration guide", and "permission dialog" — and missed
// "let users sign in with a passkey" entirely, which is the case that
// actually crosses a trust boundary. Multi-word entries match as phrases,
// and whitespace inside one also matches a hyphen ("auth-token").
//
// Bare "token", "session", "identity", "sensitive", and "escalation" used to
// be entries of their own. Whole-word matching does not save them: "reduce the
// token budget", "resume the session", "state-identity evidence",
// "case-sensitive paths", and "escalate to a human" are ordinary sentences that
// each bought an independent reviewer, the standard schema, and — because a
// security trigger also makes reviewer diversity mandatory — a second model or
// a person. They are carried here as the phrases that actually name a trust
// boundary. The auth/oauth/jwt/passkey/credential cluster below is untouched
// and still covers the same work described in the usual words; `--security`
// remains the explicit escape for a boundary no phrase here caught.
const SECURITY_TERMS = [
  "auth", "authn", "authz", "authentication", "authorization",
  "user identity", "identity provider",
  "access control", "permissions", "secret", "secrets", "credential",
  "credentials", "user session", "user sessions", "session cookie",
  "session id", "session token", "session fixation", "session hijack",
  "auth token", "access token", "refresh token", "bearer token", "api token",
  "csrf token", "password",
  "passwords", "passkey", "passkeys", "sign in", "sign-in", "signin", "login",
  "log in", "sso", "oauth", "saml", "jwt", "cookie", "cookies", "encryption",
  "decrypt", "encrypt", "crypto", "cross-user", "cross user", "tenant",
  "multi-tenant", "trust boundary", "irreversible", "sensitive data", "pii",
  "personal data", "command execution", "injection", "sql injection", "xss",
  "csrf", "ssrf", "sandbox escape", "privilege", "data migration",
  "schema migration", "payment", "billing", "refund", "webhook signature"
];

// A refusal is a lifecycle stop, not a crash. Recording it as a failure would
// bury real breakage under the guards that are working as designed.
let operationBlocked = false;
// A command that prints a structured non-ready result and returns has also
// ended in a refusal, not a crash — but it never reaches `die`. `block()` is
// that second spelling: it records the decision without exiting, so the exit
// handler reports what the command decided instead of inferring it.
function markBlocked() { operationBlocked = true; }
function die(message, code = 1) {
  markBlocked();
  console.error(`BLOCKED: ${message}`);
  process.exit(code);
}
const { parseFlags, parseStrictCommandFlags } = createFlagParser({ fail: die });
const { blockedDecisionValue, blockWithDecision } = createBlockedDecision({ fail: die });

function insideSandboxCopy(path) {
  const segments = path.split(sep);
  return segments.some((segment, index) => segment === ".foundation" &&
    ["sandboxes", "repository-sandboxes"].includes(segments[index + 1]));
}

function findRoot(start = process.cwd()) {
  const pinned = process.env.CLAUDE_FOUNDATION_PROJECT;
  let cursor = resolve(pinned || start);
  for (;;) {
    if (existsSync(join(cursor, "openspec", "config.yaml")) &&
        existsSync(join(cursor, ".claude", "harness", "foundation.mjs"))) {
      // A Build sandbox is a full copy of the project, marker files included.
      // Resolving to the copy would silently split runtime state between the
      // sandbox's .foundation/ and the project's, so resolution walks past a
      // sandbox unless CLAUDE_FOUNDATION_PROJECT deliberately pins one.
      if (pinned || !insideSandboxCopy(cursor)) return cursor;
      console.error(
        `claude-foundation: ignoring sandbox copy at ${cursor}; resolving the project root`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) die("not inside a Foundation project");
    cursor = parent;
  }
}

function canonicalPath(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

const ROOT = canonicalPath(findRoot());
const RUNTIME = join(ROOT, ".foundation", "runtime");
const RECEIPTS = join(ROOT, ".foundation", "receipts");
const LOGS = join(ROOT, ".foundation", "logs");
const EVIDENCE_VAULT = join(ROOT, ".foundation", "evidence");
const SNAPSHOTS = join(ROOT, ".foundation", "snapshots");
const TRANSACTIONS = join(ROOT, ".foundation", "transactions");
const PLANS = join(ROOT, ".foundation", "plans");
const LEASES = join(ROOT, ".foundation", "leases");
const PROTOTYPES = join(ROOT, ".foundation", "prototypes");
const ATTESTATIONS = join(ROOT, ".foundation", "attestations");
const AUTHORITY = join(ROOT, ".foundation", "authority");
const INSTRUCTION_MANIFESTS = join(ROOT, ".foundation", "instruction-manifests");
const RECOVERY = join(ROOT, ".foundation", "recovery");
const CHANGES = join(ROOT, "openspec", "changes");
mkdirSync(RUNTIME, { recursive: true });
mkdirSync(RECEIPTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
mkdirSync(EVIDENCE_VAULT, { recursive: true });
mkdirSync(SNAPSHOTS, { recursive: true });
mkdirSync(TRANSACTIONS, { recursive: true });
mkdirSync(PLANS, { recursive: true });
mkdirSync(LEASES, { recursive: true });
mkdirSync(ATTESTATIONS, { recursive: true });
mkdirSync(AUTHORITY, { recursive: true });
mkdirSync(INSTRUCTION_MANIFESTS, { recursive: true });
mkdirSync(CHANGES, { recursive: true });

const operationStartedAt = Date.now();
let operationChangeId = null;
let operationName = null;
let operationPhase = null;
// Commands that only read. `showMetrics` buckets every row of operations.jsonl
// and then this handler appended a row for the read itself, so each inspection
// permanently inflated the next one — and an archived change, which is
// finished evidence, still accumulated rows from sessions that only looked at
// it. A read is not an operation the change performed.
// Lifecycle commands stay: metrics derives rework and typed-stop signals from
// their rows, so proof-* and land-* are measurements, not inspections.
const READ_ONLY_OPERATIONS = new Set([
  "metrics", "hash", "changes", "providers", "repos", "models", "describe",
  "packet", "agent-task", "audit-change", "authority-status",
  "evidence-detect", "evidence-doctor", "doctor", "api-version", "version"
]);
process.on("exit", (code) => {
  if (process.env.FOUNDATION_TELEMETRY === "0" || !operationChangeId || !operationName) return;
  if (READ_ONLY_OPERATIONS.has(operationName)) return;
  // An archived change is finished. Nothing this session did belongs in it.
  if (readJson(runtimePath(operationChangeId), {}).status === "archived") return;
  try {
    const path = join(LOGS, operationChangeId, "operations.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 2, changeId: operationChangeId, operation: operationName,
      phase: process.env.FOUNDATION_PUBLIC_OPERATION || operationPhase || null,
      // Blocked is declared by the command through `block()`/`die()`, never
      // inferred here. The previous spelling guessed from (exit code 2,
      // operation name) against a hardcoded list, so any path that set an exit
      // code without going through `die` was filed as a failure: the same
      // `validate` refusal read `failed` in one change and `blocked` in
      // another, and `metrics` counted the difference as rework.
      status: code === 0 ? "completed"
        : operationBlocked ? "blocked" : "failed", exitCode: code,
      startedAt: new Date(operationStartedAt).toISOString(), finishedAt: now(),
      durationMs: Date.now() - operationStartedAt,
      requests: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, cacheTokens: null, cost: null,
      measurement: "command-observed; model usage requires host telemetry ingestion"
    })}\n`);
  } catch (error) {
    if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
      console.error(`WARNING: telemetry unavailable: ${error.message}`);
  }
});

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== null) return fallback;
    die(`invalid JSON: ${relative(ROOT, path)} (${error.message})`);
  }
}

// `readJson(path, null)` means "die on bad JSON", so a caller that wants to
// report a corrupt file rather than exit needs its own spelling. Used by
// `changes`, which must survive one unreadable state file among many.
function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

let commandRegistryCache = null;
function commandRegistry() {
  if (!commandRegistryCache) {
    const registry = readJson(join(dirname(fileURLToPath(import.meta.url)), "commands.json"));
    if (!registry || registry.version !== 1 || !Array.isArray(registry.commands) ||
        !Array.isArray(registry.runtimeCommands))
      die("invalid command registry: expected version 1 commands and runtimeCommands arrays");
    const audiences = new Set(["agent", "conditional", "admin", "host", "internal"]);
    const kinds = new Set(["read", "write", "authority"]);
    const names = new Set();
    for (const entry of registry.commands) {
      if (!entry || typeof entry.name !== "string" || !entry.name.trim() ||
          typeof entry.usage !== "string" || typeof entry.description !== "string" ||
          !audiences.has(entry.audience) || !kinds.has(entry.kind) ||
          typeof entry.idempotent !== "boolean")
        die("invalid command registry entry");
      if (names.has(entry.name)) die(`duplicate command registry entry '${entry.name}'`);
      names.add(entry.name);
    }
    const runtimeCommands = new Set();
    for (const runtimeCommand of registry.runtimeCommands) {
      if (typeof runtimeCommand !== "string" || !runtimeCommand.trim())
        die("invalid runtime command registry entry");
      if (runtimeCommands.has(runtimeCommand))
        die(`duplicate runtime command registry entry '${runtimeCommand}'`);
      runtimeCommands.add(runtimeCommand);
    }
    commandRegistryCache = registry;
  }
  return commandRegistryCache;
}

// Runtime spellings whose public name shares no token with them. Everything
// else resolves by shape; these would not.
const RUNTIME_COMMAND_ALIASES = {
  "audit-change": "change audit",
  "agent-plan": "agents plan",
  "agent-task": "agents task",
  "agent-acquire": "agents acquire",
  "agent-release": "agents release",
  receipt: "evidence record",
  "run-provider": "evidence run",
  prove: "proof finalize",
  "host-execution-import": "telemetry host-import",
  // The runtime command is the real implementation of `change validate`; the
  // bare public `validate` is the deprecated alias for it.
  validate: "change validate"
};

// The registry is the contract. Without a way to read it back, an agent that
// hits a rejection has only one route left — reading this file.
function describeCommand(name, options = {}) {
  const registry = commandRegistry();
  const entries = [...registry.commands].sort((left, right) =>
    left.name.localeCompare(right.name));
  if (!name) {
    if (options.json) { console.log(JSON.stringify(entries, null, 2)); return; }
    console.log("Commands (describe <command> for one):\n");
    for (const entry of entries)
      console.log(`  ${entry.name.padEnd(22)} ${entry.description}`);
    // File shapes are data, not runtime source. Say where they are so nobody
    // reconstructs them by reading the implementation.
    console.log("\nFile shapes:\n");
    console.log("  evidence.yaml, execution.yaml   openspec/schemas/<schema>/schema.yaml");
    console.log("  host execution, instruction     .claude/harness/runtime/contracts/");
    console.log("  authority response              authority status <change> --template");
    return;
  }
  // Callers arrive with either name: the public CLI spells it `change resolve`,
  // the runtime spells it `resolve`. Both must reach the same entry. The
  // shape-based rules below cover most of that, but a runtime name that shares
  // no token with its public spelling needs saying outright — guessing gave
  // `unknown command` for twelve of them and the wrong entry for two more.
  const normalize = (value) => value.replace(/[\s-]+/g, "-");
  const target = normalize(name);
  const aliased = RUNTIME_COMMAND_ALIASES[target];
  // A family name is not one command. Listing its members beats silently
  // picking whichever member happened to sort first.
  const exact = entries.find((candidate) => normalize(candidate.name) === target);
  const family = entries.filter((candidate) =>
    normalize(candidate.name).startsWith(`${target}-`));
  if (!aliased && !exact && family.length > 1) {
    if (options.json) { console.log(JSON.stringify(family, null, 2)); return; }
    console.log(`${name} — ${family.length} commands:\n`);
    for (const member of family)
      console.log(`  ${member.name.padEnd(22)} ${member.description}`);
    return;
  }
  const entry = entries.find((candidate) => candidate.name === aliased) ||
    entries.find((candidate) => normalize(candidate.name) === target) ||
    entries.find((candidate) => normalize(candidate.name).endsWith(`-${target}`)) ||
    entries.find((candidate) => normalize(candidate.name).split("-").includes(target));
  if (!entry) {
    const near = entries.filter((candidate) => target.split("-")
      .some((token) => normalize(candidate.name).includes(token)));
    die(`unknown command '${name}'\n  ${near.length ? "did you mean" : "known"}: ` +
      `${(near.length ? near : entries).map((candidate) => candidate.name).join(", ")}`);
  }
  if (options.json) { console.log(JSON.stringify(entry, null, 2)); return; }
  console.log(`${entry.name} — ${entry.description}\n`);
  console.log(`  usage:     ${entry.usage}`);
  console.log(`  audience:  ${entry.audience}`);
  console.log(`  kind:      ${entry.kind}${entry.idempotent ? " (idempotent)" : ""}`);
}

function assertRegisteredRuntimeCommand(command, values = []) {
  if (!command) return;
  const registry = commandRegistry().runtimeCommands;
  if (registry.includes(command)) return;
  // `describe` and `help` print the public two-word usage (`change new`,
  // `proof run`) because that is what `claude-foundation` accepts, but this
  // entrypoint dispatches on the internal single token (`new`, `proof-run`).
  // So the binary documented a form it then rejected, and said only that the
  // first word was unregistered — which is true and useless, because the first
  // word was never meant to be a command. When the joined form is real, name it.
  const word = values[0] && !values[0].startsWith("-") ? values[0] : null;
  const publicForm = word ? `${command} ${word}` : null;
  const known = publicForm &&
    commandRegistry().commands.some((entry) => entry.name === publicForm);
  // The internal token is either the hyphenated join (`proof run` → `proof-run`)
  // or the bare second word (`change new` → `new`). Ask the registry rather than
  // guessing a rule, so a future naming choice cannot make this advice wrong.
  const internal = known
    ? [`${command}-${word}`, word].find((candidate) => registry.includes(candidate))
    : null;
  if (internal)
    die(`runtime command '${command}' is not registered\n` +
      `  '${publicForm}' is the CLI form: claude-foundation ${publicForm}\n` +
      `  this entrypoint takes the internal name: ${internal}`);
  die(`runtime command '${command}' is not registered`);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  try {
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function now() { return new Date().toISOString(); }
function recordInstructionManifest(id, phase, options = {}) {
  const command = phase === "review" ? "prove" : phase;
  if (!["change", "build", "prove", "land"].includes(command)) return null;
  const instructionPaths = [
    `.claude/commands/${command}.md`,
    ".claude/orchestrator.md",
    ".claude/rules/fundamentals.md"
  ];
  // Minimal legacy/test installations may contain the runtime without the host
  // instruction surface. Preserve their lifecycle behavior and report absent
  // provenance instead of turning observability into a runtime blocker.
  if (instructionPaths.some((path) => !existsSync(join(ROOT, path)))) return null;
  const manifest = createInstructionManifest({
    root: ROOT,
    foundationVersion: VERSION,
    command,
    commandPath: instructionPaths[0],
    orchestratorPath: ".claude/orchestrator.md",
    rulePaths: [".claude/rules/fundamentals.md"],
    skills: [],
    requestedModel: options.requestedModel || null
  });
  const scope = String(options.scope || "global").replace(/[^A-Za-z0-9._-]/g, "-");
  writeJson(join(INSTRUCTION_MANIFESTS, id, `${command}-${scope}.json`), manifest);
  return manifest;
}
let repositoryTopology;
const stateRuntime = createStateRuntime({
  root: ROOT,
  runtime: RUNTIME,
  changes: CHANGES,
  receipts: RECEIPTS,
  evidenceVault: EVIDENCE_VAULT,
  snapshots: SNAPSHOTS,
  excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
  readJson,
  writeJson,
  canonicalPath,
  selectedRepositories: (...args) => repositoryTopology.selected(...args),
  now,
  fail: die
});
const {
  runtimePath,
  changePath,
  receiptPath,
  proofPath,
  proofRunRoot,
  snapshotPath,
  currentChangeRelativePath,
  isCurrentChangePath,
  activeChangePath,
  archivedChangeRelativePath,
  slugify,
  loadRuntime,
  saveRuntime,
  activeChanges,
  orphanRuntimeChanges,
  walk,
  filesystemEntryIdentity,
  directoryHash,
  stableHash,
  serializedJson,
  compactList,
  compactStrings,
  expandList,
  listCount,
  fileDigest,
  singleRelevantSnapshot,
  relevantSnapshot,
  relevantHash,
  clearSnapshotCache,
  workspaceManifest,
  preexistingDirty,
  git,
  gitHead
} = stateRuntime;
let evidenceContract;
let packetRuntime;
let changeValidationRuntime;
let receiptRuntime;
let adapterRuntime;
const {
  flagValues,
  provenanceResult: reviewProvenanceResult,
  receiptBinding: reviewReceiptBinding,
  subjectProvenance,
  attemptIsValid: reviewAttemptIsValid
} = createReviewProtocol({ stableHash, fail: die });
const {
  decodedEvidencePath,
  evidenceInputTargetsPrototype,
  rejectPrototypeEvidenceInputs,
  receiptPrototypeEvidence,
  durableArtifact,
  validateArtifact
} = createArtifactStore({
  root: ROOT,
  prototypesRoot: PROTOTYPES,
  evidenceVault: EVIDENCE_VAULT,
  canonicalPath,
  providerWorkspace: (...args) => evidenceContract.providerWorkspace(...args),
  proofRunRoot,
  pathInside,
  fileDigest,
  fail: die
});
const {
  reviewHistoryState,
  reviewAttemptByDigest,
  reviewHistoryChainValid,
  reserveReviewAttempt
} = createReviewAttemptStore({
  receiptsRoot: RECEIPTS,
  evidenceVault: EVIDENCE_VAULT,
  readJson,
  writeJson,
  loadRuntime,
  saveRuntime,
  stableHash,
  reviewReceiptBinding,
  now,
  blockWithDecision,
  fail: die
});
const hostAttestation = createHostAttestationRuntime({
  root: ROOT,
  attestations: ATTESTATIONS,
  protocolVersion: ATTESTATION_PROTOCOL_VERSION,
  loadRuntime,
  changePath,
  directoryHash,
  stableHash,
  readJson,
  writeJson,
  now
});
const authorityStore = createAuthorityStore({
  root: AUTHORITY,
  protocolVersion: AUTHORITY_PROTOCOL_VERSION,
  readJson,
  writeJson,
  now
});
const {
  eventTokenCount,
  budgetWindow,
  initialBudget,
  knownNumber,
  ensureBudgetState,
  activateBudgetWindow,
  budgetDecision,
  applyBudgetDecision,
  eventUsage,
  synchronizeBudgetUsage
} = createBudgetRuntime({ policy: foundationPolicy, now });
const { showMetrics } = createMetricsRuntime({
  logs: LOGS,
  receipts: RECEIPTS,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  instructionManifests: INSTRUCTION_MANIFESTS,
  activeChangePath,
  policy: foundationPolicy,
  taskBlocks: (...args) => changeValidationRuntime.taskBlocks(...args),
  taskMetadata: (...args) => changeValidationRuntime.taskMetadata(...args)
});
const { execObserved } = createExecRuntime({
  logs: LOGS,
  loadRuntime,
  now,
  fail: die
});
repositoryTopology = createRepositoryTopology({
  root: ROOT,
  slugify,
  readJson,
  canonicalPath,
  pathInside,
  activeChangePath,
  loadRuntime,
  git,
  gitHead,
  fail: die
});
const {
  catalog: repositoryCatalog,
  changeSelection: changeRepositorySelection,
  selectionIdsAt: repositorySelectionIdsAt,
  selected: selectedRepositories,
  byId: repositoryById,
  show: showRepositories
} = repositoryTopology;
const {
  appendTelemetryRows,
  bindClaudeSession,
  claudeHostContext,
  importTelemetry,
  prepareClaudeTelemetry,
  recordContextMetric,
  recordEvent,
  recordPhaseContext,
  syncClaudeTelemetry
} = createTelemetryRuntime({
  root: ROOT,
  logs: LOGS,
  contextEventSchemaVersion: CONTEXT_EVENT_SCHEMA_VERSION,
  stableHash,
  now,
  readJson,
  writeJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  saveRuntime,
  synchronizeBudgetUsage,
  reportBudget,
  snapshotPath,
  parseFlags,
  activeChangePath,
  repositoryById,
  taskBlocks: (...args) => changeValidationRuntime.taskBlocks(...args),
  fail: die
});
const hostExecutionStore = createHostExecutionStore({ root: ROOT, now });
function importHostExecution(id, source) {
  loadRuntime(id);
  const path = resolve(process.cwd(), source);
  if (!existsSync(path)) die(`host execution result not found: ${source}`);
  // A malformed host file is the host's input being wrong, not the harness
  // breaking. Letting the throw escape reported it as a crash and logged the
  // operation "failed" rather than "blocked".
  let result;
  try {
    result = hostExecutionStore.importExecution(id, readJson(path));
  } catch (error) {
    die(`host execution result is invalid: ${error.message}`);
  }
  const imported = appendTelemetryRows(
    id,
    hostExecutionTelemetryRows(result.execution),
    "host-execution",
    { snapshot: readJson(snapshotPath(id), {}) }
  );
  console.log(`HOST EXECUTION ${id}: ${result.duplicate ? "duplicate" : "recorded"}; imported ${imported}`);
}
packetRuntime = createPacketRuntime({
  ROOT,
  EXCLUDED_WORKSPACE_DIRS,
  PROVIDERS,
  PACKET_SCHEMA_VERSION,
  REVIEW_PACKET_SCHEMA_VERSION,
  gitHead,
  git,
  workspaceManifest,
  loadRuntime,
  selectedRepositories,
  isCurrentChangePath,
  readJson,
  activeChangePath,
  evidence: (...args) => evidenceContract.evidence(...args),
  taskBlocks: (...args) => changeValidationRuntime.taskBlocks(...args),
  taskMetadata: (...args) => changeValidationRuntime.taskMetadata(...args),
  repositoryById,
  claimsForProvider: (...args) => changeValidationRuntime.claimsForProvider(...args),
  relevantSnapshot,
  snapshotPath,
  singleRelevantSnapshot,
  requiredProviders: (...args) => changeValidationRuntime.requiredProviders(...args),
  receiptValidity,
  providerConfig: (...args) => evidenceContract.providerConfig(...args),
  adapterResources: (...args) => adapterRuntime.adapterResources(...args),
  stableHash,
  compactStrings,
  modelForTask: (...args) => modelForTask(...args),
  compactList,
  fileDigest,
  directoryHash,
  ensureBudgetState,
  budgetDecision,
  scopedReviewClaims: (...args) => evidenceContract.scopedReviewClaims(...args),
  relevantHash,
  providerCapability,
  receiptPath,
  contractFingerprint: (...args) => evidenceContract.contractFingerprint(...args),
  reviewPolicy: (...args) => evidenceContract.reviewPolicy(...args),
  resolvedAcceptance: (...args) => evidenceContract.resolvedAcceptance(...args),
  serializedJson,
  foundationPolicy,
  recordContextMetric,
  recordInstructionManifest,
  fail: die
});
const {
  changedFilesInWorkspace,
  changedFiles,
  canonicalChangedSurface,
  policyCapabilities,
  policyCapabilityTrigger,
  capabilitiesForPaths,
  forecastCapabilities,
  packetValue,
  reviewPacketValue,
  showPacket
} = packetRuntime;
evidenceContract = createEvidenceContract({
  ROOT,
  PROVIDERS,
  ADAPTERS,
  INPUT_MODES,
  EXCLUDED_WORKSPACE_DIRS,
  ADAPTER_PROTOCOL_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  activeChangePath,
  readJson,
  repositoryById,
  selectedRepositories,
  providerCapability,
  claimsForProvider: (...args) => changeValidationRuntime.claimsForProvider(...args),
  canonicalPath,
  loadRuntime,
  relevantHash,
  relevantSnapshot,
  singleRelevantSnapshot,
  fileDigest,
  stableHash,
  policyCapabilities,
  foundationPolicy,
  die
});
const {
  rawExecution,
  scopedReviewClaims,
  evidence,
  providerConfig,
  providerClaims,
  providerRepository,
  providerWorkspace,
  providerWorkspaceHash,
  providerInputIdentity,
  environmentDescriptor,
  adapterFingerprint,
  contractFingerprint,
  normalizedAcceptance,
  resolvedAcceptance,
  reviewPolicy,
  executionFingerprint
} = evidenceContract;
changeValidationRuntime = createChangeValidationRuntime({
  markBlocked,
  root: ROOT,
  activeChangePath,
  changePath,
  walk,
  loadRuntime,
  saveRuntime,
  evidence,
  selectedRepositories,
  providerCapability,
  providerConfig,
  resolvedAcceptance,
  reviewPolicy,
  policyCapabilities,
  forecastCapabilities,
  scopedReviewClaims,
  rawExecution,
  commandExists,
  stableHash,
  knownProviders: PROVIDERS,
  writeJson,
  now,
  fail: die
});
const {
  assertNoDroppedScenarios,
  changeArtifactGaps,
  changeSpecScenarios,
  claimsForProvider,
  evidenceDetectionValue,
  initializeEvidence,
  pendingTasks,
  requiredProviders,
  showEvidenceDetection,
  showEvidenceDoctor,
  showTraceabilityAudit,
  taskBlocks,
  taskMetadata,
  traceabilityAuditValue,
  validate
} = changeValidationRuntime;
const {
  authorityProvider,
  authorityPacket,
  requestAuthority,
  authorityStatusValue,
  showAuthorityStatus,
  recordAuthority,
  recordVerifiedCi
} = createAuthorityRuntime({
  root: ROOT,
  protocolVersion: AUTHORITY_PROTOCOL_VERSION,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  authorityStore,
  requiredProviders,
  providerCapability,
  providerConfig,
  reviewPacketValue,
  loadRuntime,
  evidence,
  resolvedAcceptance,
  relevantHash,
  validate,
  pendingTasks,
  claimsForProvider,
  stableHash,
  now,
  reviewPolicy,
  readJson,
  expandList,
  listCount,
  receiptPath,
  recordReceipt: (...args) => receiptRuntime.recordReceipt(...args),
  receiptValidity,
  fileDigest,
  providerWorkspaceHash,
  providerRepository,
  providerWorkspace,
  gitHead,
  validateSignedCiEnvelope,
  providerClaims,
  fail: die
});
const { runCommand, startServiceSession } = createProcessRuntime({
  root: ROOT,
  logs: LOGS,
  now,
  resolveServiceCwd(id, config) {
    const state = loadRuntime(id);
    return config.repository
      ? repositoryById(id, config.repository, state).workspacePath
      : state.workspace?.path || ROOT;
  }
});
receiptRuntime = createReceiptRuntime({
  ROOT,
  LOGS,
  PROVIDERS,
  INPUT_MODES,
  providerWorkspace,
  ADAPTER_PROTOCOL_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  REVIEW_PROTOCOL_VERSION,
  ACCEPTANCE_PROTOCOL_VERSION,
  validate,
  relevantHash,
  requiredProviders,
  receiptValidity,
  now,
  writeJson,
  receiptPath,
  providerConfig,
  providerCapability,
  loadRuntime,
  resolvedAcceptance,
  evidence,
  claimsForProvider,
  providerWorkspaceHash,
  providerRepository,
  rejectPrototypeEvidenceInputs,
  durableArtifact,
  providerInputIdentity,
  contractFingerprint,
  executionFingerprint,
  stableHash,
  adapterFingerprint,
  environmentDescriptor,
  reviewPolicy,
  subjectProvenance,
  reviewProvenanceResult,
  readJson,
  flagValues,
  reviewHistoryState,
  reserveReviewAttempt,
  reviewReceiptBinding,
  die
});
const { proofPlan, rebindReusableReceipt, recordReceipt } = receiptRuntime;
adapterRuntime = createAdapterRuntime({
  ROOT,
  LOGS,
  PROVIDERS,
  providerCapability,
  providerConfig,
  parseFlags,
  providerWorkspace,
  recordReceipt,
  startServiceSession,
  evidence,
  resultAdapterResources,
  loadRuntime,
  providerRepository,
  repositoryById,
  fileDigest,
  pathInside,
  configuredCommand,
  stableHash,
  runCommand,
  providerWorkspaceHash,
  providerClaims,
  parseJsonOutput,
  parseTapOutput,
  numericReportValue,
  playwrightReportSummary,
  requiredProviders,
  mutationProtocolResult,
  now,
  die
});
const {
  runProvider,
  startRequiredServices,
  executionLog,
  adapterResources,
  executeAdapter
} = adapterRuntime;
const {
  executionNodes,
  runExecutionDag,
  collectableExecutionNodes
} = createProviderScheduler({
  requiredProviders,
  receiptValidity,
  providerConfig,
  commandExists,
  providerWorkspace,
  playwrightAvailability,
  evidence,
  stableHash,
  providerCapability,
  adapterResources,
  resourcesConflict,
  executeAdapter,
  fail: die
});
const {
  modelForTask,
  planValue: agentPlanValue,
  showPlan: showAgentPlan,
  showTask: showAgentTask,
  activeRepositoryConflicts
} = createAgentPlanner({
  root: ROOT,
  plans: PLANS,
  runtime: RUNTIME,
  schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
  validate,
  loadRuntime,
  policy: foundationPolicy,
  selectedRepositories,
  // Reading *another* change's topology must not end this process when that
  // change's selection is stale — see activeRepositoryConflicts.
  safeSelectedRepositories: (id, state) => {
    try {
      return selectedRepositories(id, state, (message) => { throw new Error(message); });
    } catch { return null; }
  },
  taskBlocks,
  taskMetadata,
  activeChangePath,
  evidence,
  resourcesConflict,
  relevantHash,
  contractFingerprint,
  stableHash,
  now,
  readJson,
  writeJson,
  compactStrings,
  serializedJson,
  recordContextMetric,
  recordInstructionManifest,
  showPacket,
  fail: die
});
const {
  leasePath,
  acquire: acquireAgentLease,
  release: releaseAgentLease,
  active: activeChangeLeases,
  cleanup: cleanupChangeLeases
} = createLeaseRuntime({
  leases: LEASES,
  stableHash,
  agentPlanValue,
  policy: foundationPolicy,
  readJson,
  writeJson,
  now,
  fail: die
});
const {
  activeWorkRecovery,
  changedSurfaceIssues,
  codeChangeRecovery,
  configurationRecovery,
  externalEvidenceRecovery,
  proofPreflight,
  proofReadiness,
  proofReadinessValue,
  readinessBudgetPolicy,
  topologyIssues,
  unavailableProviderRecovery,
  upgradeEvidence
} = createProofReadinessRuntime({
  markBlocked,
  evidence,
  loadRuntime,
  taskBlocks,
  activeChangePath,
  taskMetadata,
  canonicalChangedSurface,
  selectedRepositories,
  providerCapability,
  providerConfig,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  activeChangeLeases,
  activeRepositoryConflicts,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  fail: die
});
let applyRuntime;
const sandboxRuntime = createSandboxRuntime({
  markBlocked,
  root: ROOT,
  excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
  sandboxCopyExcludedDirs: SANDBOX_COPY_EXCLUDED_DIRS,
  hostAttestation,
  loadRuntime,
  saveRuntime,
  canonicalPath,
  workspaceManifest,
  directoryHash,
  fileDigest,
  changePath,
  gitHead,
  git,
  selectedRepositories,
  cleanupRepositorySandboxes: (...args) => applyRuntime.cleanupRepositorySandboxes(...args),
  cleanupAppliedSandbox: (...args) => applyRuntime.cleanupAppliedSandbox(...args),
  clearSnapshotCache,
  validate,
  repositorySelectionIdsAt,
  contractFingerprint,
  executionFingerprint,
  taskBlocks,
  proofPath,
  relevantHash,
  fail: die
});
const {
  createChallenge: createAttestationChallenge,
  workspaceInspection: workspaceIsolationInspection,
  inspect: isolationInspection,
  showInspection: showSandboxInspection,
  createSingle: createSingleSandbox,
  create: createSandbox,
  mergeTaskProgress,
  sync: syncSandbox
} = sandboxRuntime;
const {
  templateDir,
  instantiate,
  loadDraft,
  materializeDraft,
  createChange,
  rapidStartTemplate,
  startAtomic,
  resolveChange
} = createChangeLifecycle({
  root: ROOT,
  securityTerms: SECURITY_TERMS,
  fail: die,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId(id) { operationChangeId = id; },
  initialBudget,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  createSandbox,
  showPacket
});
let abandonRuntime;
// The apply guard now stops on an unresolved transaction instead of silently
// opening a new one over it, so doctor has to be able to see that state coming.
function unresolvedApplyTransactions(id) {
  if (!abandonRuntime) return [];
  return abandonRuntime.transactionJournals(id).filter((journal) =>
    ["prepared", "applying", "rolling-back", "manual-recovery"].includes(journal.status));
}
const {
  doctor,
  migrate,
  showChanges,
  showProviders,
  usage
} = createDiagnosticsRuntime({
  root: ROOT,
  unresolvedApplyTransactions,
  version: VERSION,
  runtimeApiVersion: RUNTIME_API_VERSION,
  providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
  adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
  proofProtocolVersion: PROOF_PROTOCOL_VERSION,
  packetSchemaVersion: PACKET_SCHEMA_VERSION,
  agentPlanSchemaVersion: AGENT_PLAN_SCHEMA_VERSION,
  contextEventSchemaVersion: CONTEXT_EVENT_SCHEMA_VERSION,
  reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
  acceptanceProtocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
  reviewPacketSchemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
  attestationProtocolVersion: ATTESTATION_PROTOCOL_VERSION,
  authorityProtocolVersion: AUTHORITY_PROTOCOL_VERSION,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  providerContracts: PROVIDER_CONTRACTS,
  activeChanges,
  orphanRuntimeChanges,
  runtimePath,
  proofPath,
  readJson,
  readJsonOrNull,
  relevantHash,
  protocolDescriptor,
  repositoryCatalog,
  foundationPolicy,
  isolationInspection,
  openSpecCliStatus,
  loadRuntime,
  evidence,
  selectedRepositories,
  gitHead,
  playwrightAvailability,
  requiredProviders,
  providerConfig,
  receiptValidity,
  providerWorkspace,
  commandExists,
  topologyIssues,
  policyCapabilities,
  policyCapabilityTrigger,
  forecastCapabilities: (...args) => packetRuntime.forecastCapabilities(...args),
  reviewForcingCapabilities: REVIEW_FORCING_CAPABILITIES,
  reviewDiversityCapabilities: REVIEW_DIVERSITY_CAPABILITIES,
  providerCapability,
  unverifiedDrift: (id) => modelDriftInspector.changeDrift(id).unverified,
  parseFlags,
  parseStrictCommandFlags,
  fail: die
});
const {
  pathIdentity,
  safeRootPath,
  copyPath,
  transactionRoot: applyTransactionRoot,
  journalPath: transactionJournalPath,
  save: saveApplyJournal,
  applyEntry: applyTransactionEntry,
  rollback: rollbackApplyTransaction,
  verify: verifyAppliedProjection,
  cleanup: cleanupApplyTransaction
} = createLandJournal({
  root: ROOT,
  transactions: TRANSACTIONS,
  fileDigest,
  directoryHash,
  pathInside,
  readJson,
  writeJson,
  now
});
const { finalize: prove, audit: proofAudit } = createProofRuntime({
  root: ROOT,
  protocolVersion: PROOF_PROTOCOL_VERSION,
  loadRuntime,
  saveRuntime,
  validate,
  changedSurfaceIssues,
  activeChangeLeases,
  pendingTasks,
  clearSnapshotCache,
  relevantSnapshot,
  requiredProviders,
  receiptValidity,
  proofRunRoot,
  receiptPath,
  fileDigest,
  protocolDescriptor,
  contractFingerprint,
  executionFingerprint,
  proofPath,
  writeJson,
  readJson,
  pathInside,
  validateArtifact,
  instructionProvenance: (id) => {
    const manifest = recordInstructionManifest(id, "prove", { scope: "proof" });
    return manifest ? {
      schemaVersion: manifest.schemaVersion,
      manifestDigest: manifest.manifestDigest
    } : null;
  },
  now,
  fail: die
});
const {
  proofCollect,
  proofExecute,
  proofRun
} = createProofExecutionRuntime({
  markBlocked,
  proofReadinessValue,
  relevantSnapshot,
  loadRuntime,
  saveRuntime,
  now,
  requiredProviders,
  receiptValidity,
  rebindReusableReceipt,
  executionNodes,
  collectableExecutionNodes,
  startRequiredServices,
  runExecutionDag,
  durableArtifact,
  pendingTasks,
  proofPreflight,
  prove,
  proofAudit,
  readJson,
  proofPath,
  die
});
const modelDriftInspector = createModelDriftInspector({
  logs: LOGS,
  instructionManifests: INSTRUCTION_MANIFESTS,
  activeChangePath,
  policy: foundationPolicy,
  taskBlocks: (...args) => changeValidationRuntime.taskBlocks(...args),
  taskMetadata: (...args) => changeValidationRuntime.taskMetadata(...args)
});
const {
  landCheck,
  orderedRepositories,
  repositoryCommitLanded,
  rootGitlink,
  landPlanValue,
  showLandPlan,
  recordRepositoryLand,
  stageRootPointers,
  resumeLand,
  assertMultiRepositoryArchiveReady
} = createLandRuntime({
  root: ROOT,
  transactions: TRANSACTIONS,
  loadRuntime,
  saveRuntime,
  recoverPendingApply: (...args) => applyRuntime.recoverPendingApply(...args),
  assertNoDroppedScenarios,
  blockingDrift: (...args) => modelDriftInspector.blockingDrift(...args),
  proofAudit,
  proofPath,
  readJson,
  writeJson,
  clearSnapshotCache,
  relevantHash,
  requiredProviders,
  receiptValidity,
  fileDigest,
  receiptPath,
  verifyAppliedProjection,
  selectedRepositories,
  repositoryById,
  git,
  gitHead,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  now,
  blockWithDecision,
  fail: die
});
applyRuntime = createApplyRuntime({
  root: ROOT,
  transactions: TRANSACTIONS,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  workspaceManifest,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  directoryHash,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  stableHash,
  saveApplyJournal,
  transactionJournalPath,
  verifyAppliedProjection,
  rollbackApplyTransaction,
  applyTransactionEntry,
  cleanupApplyTransaction,
  canonicalPath,
  git,
  gitHead,
  landCheck,
  assertMultiRepositoryArchiveReady,
  archivedChangeRelativePath,
  pendingTasks,
  assertOpenSpecCli,
  proofAudit,
  cleanupChangeLeases,
  now,
  blockWithDecision,
  fail: die
});
const {
  gitApplyInputs,
  buildApplyEntries,
  prepareApplyTransaction,
  recoverPendingApply,
  refreshAppliedProjection,
  applySandbox,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  archive
} = applyRuntime;
abandonRuntime = createAbandonRuntime({
  root: ROOT,
  paths: {
    recovery: RECOVERY,
    runtime: RUNTIME,
    receipts: RECEIPTS,
    evidenceVault: EVIDENCE_VAULT,
    transactions: TRANSACTIONS,
    snapshots: SNAPSHOTS,
    plans: PLANS,
    logs: LOGS,
    changes: CHANGES
  },
  loadRuntime,
  cleanupChangeLeases,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  rollbackApplyTransaction,
  readJson,
  writeJson,
  now,
  blockWithDecision,
  fail: die
});
const { abandonChange } = abandonRuntime;
function protocolDescriptor() {
  return readJson(join(ROOT, ".claude", "harness", "protocol.json"), {
    runtime: VERSION,
    runtimeApi: RUNTIME_API_VERSION,
    providerProtocol: PROVIDER_PROTOCOL_VERSION,
    adapterProtocol: ADAPTER_PROTOCOL_VERSION,
    proofProtocol: PROOF_PROTOCOL_VERSION,
    packetSchema: PACKET_SCHEMA_VERSION,
    agentPlanSchema: AGENT_PLAN_SCHEMA_VERSION,
    contextEventSchema: CONTEXT_EVENT_SCHEMA_VERSION,
    reviewProtocol: REVIEW_PROTOCOL_VERSION,
    acceptanceProtocol: ACCEPTANCE_PROTOCOL_VERSION,
    reviewPacketSchema: REVIEW_PACKET_SCHEMA_VERSION,
    attestationProtocol: ATTESTATION_PROTOCOL_VERSION,
    authorityProtocol: AUTHORITY_PROTOCOL_VERSION,
    ciEvidenceProtocol: CI_EVIDENCE_PROTOCOL_VERSION
  });
}
function commandExists(command, cwd = ROOT) {
  if (!command) return false;
  if (command.includes("/") || isAbsolute(command))
    return existsSync(resolve(cwd, command));
  return String(process.env.PATH || "").split(delimiter)
    .some((directory) => existsSync(join(directory, command)));
}
function playwrightAvailability(workspace) {
  const packageJson = readJson(join(workspace, "package.json"), {});
  const packages = {
    ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {})
  };
  const packageOwned = Boolean(packages["@playwright/test"] || packages.playwright);
  const binary = join(workspace, "node_modules", ".bin", "playwright");
  const config = [
    "playwright.config.ts", "playwright.config.js", "playwright.config.mjs",
    "playwright.config.cjs"
  ].find((name) => existsSync(join(workspace, name))) || null;
  return { packageOwned, binary, binaryAvailable: existsSync(binary), config };
}
function foundationPolicy() {
  const path = join(ROOT, "foundation.json");
  const configured = existsSync(path) ? readJson(path) : {};
  const defaults = {
    version: 1,
    execution: {
      maxParallelAgents: 3,
      packetBytes: { task: 8192, review: 8192, repository: 12288, global: 16384 },
      tokenBudgets: { rapid: 800000, standard: 1600000 },
      // Re-derived from the archived runs rather than set by feel: standard
      // changes with real implementation cost 100-170 model turns, and one
      // landed on exactly the old 160 target while its tokens sat near half.
      // The lane funds the work now; `--size` widens it further from here.
      requestBudgets: { rapid: 100, standard: 200 },
      planSummaryBytes: 4096,
      leaseMinutes: 45
    },
    models: {
      fast: { family: "haiku", fallbackTier: "standard", purposes: ["inventory", "logs", "mechanical-docs"] },
      standard: { family: "sonnet", fallbackTier: "deep", purposes: ["implementation", "tests", "focused-investigation"] },
      deep: { family: "opus", fallbackTier: null, purposes: ["architecture", "security", "migration", "independent-review"] }
    },
    escalation: [
      "ambiguous-contract", "auth-or-sensitive-data", "migration",
      "concurrency", "public-compatibility", "cross-repository-conflict",
      "evidence-anomaly", "two-failed-attempts"
    ],
    review: { diversity: "required", independence: "required" }
  };
  if (configured.version !== undefined && configured.version !== 1)
    die("foundation.json requires version 1");
  const policy = {
    ...defaults, ...configured,
    execution: { ...defaults.execution, ...(configured.execution || {}) },
    models: Object.fromEntries(["fast", "standard", "deep"].map((tier) => [
      tier, { ...defaults.models[tier], ...(configured.models?.[tier] || {}) }
    ])),
    review: { ...defaults.review, ...(configured.review || {}) }
  };
  if (typeof policy.execution.packetBytes === "number") {
    policy.execution.legacyNumericPacketBytes = policy.execution.packetBytes;
    policy.execution.packetBytes = {
      task: policy.execution.packetBytes,
      review: policy.execution.packetBytes,
      repository: policy.execution.packetBytes,
      global: policy.execution.packetBytes
    };
  } else {
    policy.execution.packetBytes = {
      ...defaults.execution.packetBytes,
      ...(policy.execution.packetBytes || {})
    };
  }
  policy.execution.tokenBudgets = {
    ...defaults.execution.tokenBudgets,
    ...(policy.execution.tokenBudgets || {})
  };
  policy.execution.requestBudgets = {
    ...defaults.execution.requestBudgets,
    ...(policy.execution.requestBudgets || {})
  };
  for (const type of ["task", "review", "repository", "global"]) {
    const bytes = Number(policy.execution.packetBytes?.[type]);
    if (!Number.isInteger(bytes) || bytes < 2048 || bytes > 65536)
      die(`foundation.json execution.packetBytes.${type} must be 2048..65536`);
  }
  const summaryBytes = Number(policy.execution.planSummaryBytes);
  if (!Number.isInteger(summaryBytes) || summaryBytes < 1024 || summaryBytes > 16384)
    die("foundation.json execution.planSummaryBytes must be 1024..16384");
  for (const type of ["rapid", "standard"]) {
    const tokens = Number(policy.execution.tokenBudgets[type]);
    if (!Number.isInteger(tokens) || tokens < 10000 || tokens > 100000000)
      die(`foundation.json execution.tokenBudgets.${type} must be 10000..100000000`);
  }
  for (const type of ["rapid", "standard"]) {
    const requests = Number(policy.execution.requestBudgets[type]);
    if (!Number.isInteger(requests) || requests < 10 || requests > 100000)
      die(`foundation.json execution.requestBudgets.${type} must be 10..100000`);
  }
  const parallel = Number(policy.execution.maxParallelAgents);
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16)
    die("foundation.json execution.maxParallelAgents must be an integer from 1 to 16");
  const leaseMinutes = Number(policy.execution.leaseMinutes);
  if (!Number.isFinite(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 1440)
    die("foundation.json execution.leaseMinutes must be from 1 to 1440");
  // "single-model" is a project declaring, in a committed file, that it has one
  // model available — so critical work cannot be reviewed by a second provider
  // and would otherwise always fall to a person. It relaxes reviewer diversity,
  // never reviewer independence. It deliberately is not a command flag: a flag
  // would let the party being reviewed write its own exemption at the moment it
  // is caught, which is the pattern the attestation trust root exists to refuse.
  if (!["required", "single-model"].includes(policy.review.diversity))
    die("foundation.json review.diversity must be required|single-model");
  // "self" is the same bargain for the other review property. A project driven
  // from a single session has no second session to hand the packet to, so every
  // change that forces review stalls — and the ways out are all worse than the
  // gate: abandon the change, understate its impact until review stops being
  // required, or write the receipt outside the harness. Declaring the waiver in
  // the same committed file keeps it a decision on the record instead. It stays
  // out of the flag surface for the reason above: an exemption the reviewed
  // party can write at the moment it is caught is not an exemption.
  if (!["required", "self"].includes(policy.review.independence))
    die("foundation.json review.independence must be required|self");
  for (const tier of ["fast", "standard", "deep"])
    if (!policy.models[tier] || typeof policy.models[tier].family !== "string")
      die(`foundation.json models.${tier}.family is required`);
  for (const tier of ["fast", "standard", "deep"]) {
    const fallback = policy.models[tier].fallbackTier;
    if (fallback !== null && fallback !== undefined &&
        !["fast", "standard", "deep"].includes(fallback))
      die(`foundation.json models.${tier}.fallbackTier is invalid`);
    if (tier === "deep" && fallback && fallback !== "deep")
      die("deep model tier cannot downgrade when unavailable");
  }
  return policy;
}

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function receiptValidity(id, provider, hash = relevantHash(id)) {
  const path = receiptPath(id, provider);
  if (!existsSync(path)) return { provider, validity: "missing" };
  const value = readJson(path);
  if (String(value.providerProtocolVersion || "") !== PROVIDER_PROTOCOL_VERSION)
    return { provider, validity: "provider-version-stale", status: value.status };
  if (receiptPrototypeEvidence(id, provider, value))
    return { provider, validity: "prototype-evidence", status: value.status };
  if (value.contractFingerprint !== contractFingerprint(id))
    return { provider, validity: "contract-stale", status: value.status };
  const config = providerConfig(id, provider);
  const capability = providerCapability(provider, config);
  if (capability === "review") {
    if (String(value.reviewProtocolVersion || "") !== REVIEW_PROTOCOL_VERSION)
      return { provider, validity: "review-version-stale", status: value.status };
    const provenance = reviewProvenanceResult(value.review);
    // Read against the policy in force now, not the one stamped on the receipt.
    // Dropping `review.independence` from foundation.json has to invalidate the
    // self-reviews it allowed, the same way the diversity check below already
    // re-decides on every read.
    if (!provenance.complete ||
        (!provenance.independent && reviewPolicy(id).independence !== "self"))
      return { provider, validity: "review-not-independent", status: value.status };
    const attemptDigest = String(value.review?.attemptDigest || "");
    const attemptDir = join(EVIDENCE_VAULT, id, "review-attempts");
    const attemptPath = attemptDigest && existsSync(attemptDir)
      ? readdirSync(attemptDir).find((name) => name.includes(attemptDigest.slice(0, 12))) : null;
    if (!attemptPath) return { provider, validity: "review-attempt-history-missing", status: value.status };
    const attempt = reviewAttemptByDigest(id, attemptDigest);
    if (!reviewAttemptIsValid(value, attempt))
      return { provider, validity: "review-attempt-history-invalid", status: value.status };
    if (reviewPolicy(id).diversity === "required" && !provenance.diverse)
      return { provider, validity: "review-not-diverse", status: value.status };
    if (Number(value.review?.findings?.unresolvedBlockers || 0) > 0)
      return { provider, validity: "review-blockers", status: value.status };
  }
  if (capability === "acceptance") {
    if (String(value.acceptanceProtocolVersion || "") !== ACCEPTANCE_PROTOCOL_VERSION)
      return { provider, validity: "acceptance-version-stale", status: value.status };
    const currentAcceptance = resolvedAcceptance(id);
    const criteria = value.acceptance?.criteria;
    const actualClaims = Array.isArray(value.claims) ? [...value.claims].sort() : [];
    const expectedClaims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
    if (value.acceptance?.actor?.type !== "human" ||
        !String(value.acceptance?.actor?.identity || "").trim() ||
        value.acceptance?.decision !== "accept" ||
        !Array.isArray(criteria) || criteria.length === 0 ||
        criteria.some((criterion) => !String(criterion).trim()) ||
        new Set(criteria.map((criterion) => String(criterion).trim())).size !== criteria.length ||
        stableHash(actualClaims) !== stableHash(expectedClaims) ||
        value.acceptance?.subjectWorkspaceHash !== value.workspaceHash ||
        value.acceptance?.reason !== currentAcceptance.reason)
      return { provider, validity: "acceptance-invalid", status: value.status };
  }
  const expectedFingerprint = config
    ? adapterFingerprint(id, provider, config)
    : stableHash({
      adapterProtocolVersion: value.adapterProtocolVersion || ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      provider,
      adapter: value.adapter || "external",
      adapterVersion: String(value.providerVersion || "1"),
      command: value.command || null,
      claims: value.claims || [],
      environment: value.environment || null,
      inputMode: value.capability?.inputMode || null,
      project: value.project || null
    });
  if (value.providerFingerprint !== expectedFingerprint)
    return { provider, validity: "provider-fingerprint-stale", status: value.status };
  const expectedWorkspaceHash = providerWorkspaceHash(id, provider, hash);
  const expectedInputs = providerInputIdentity(
    id, provider, config, expectedWorkspaceHash
  );
  let reusableInputs = false;
  if (value.workspaceHash !== expectedWorkspaceHash) {
    if (expectedInputs.mode === "declared" &&
        value.inputIdentity?.mode === "declared" &&
        value.inputIdentity.fingerprint === expectedInputs.fingerprint)
      reusableInputs = true;
    else return { provider, validity: "stale", status: value.status };
  }
  if (value.inputIdentity?.fingerprint !== expectedInputs.fingerprint)
    return { provider, validity: "provider-inputs-stale", status: value.status };
  if (value.status !== "pass") return { provider, validity: value.status };
  const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
  const covered = new Set(value.claims || []);
  if (requiredClaims.some((claim) => !covered.has(claim)))
    return { provider, validity: "incomplete-claims", status: value.status };
  const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
    artifact.required !== false && !validateArtifact(artifact));
  if (invalidArtifacts.length)
    return { provider, validity: "invalid-artifacts", status: value.status };
  // The floor keys off how the receipt was produced, not off `adapter`, which
  // the caller chooses. An executed receipt is corroborated by its command log
  // (digest-checked above); everything else owes observation and provenance.
  if (value.status === "pass" && value.execution === "harness") {
    if (!(value.artifacts || []).some((artifact) => artifact.type === "command-log"))
      return { provider, validity: "execution-log-missing", status: value.status };
  } else if (value.status === "pass") {
    if (!String(value.observed || "").trim())
      return { provider, validity: "external-observation-missing", status: value.status };
    if (!String(value.provenance?.source || "").trim())
      return { provider, validity: "external-provenance-missing", status: value.status };
    if ((value.artifacts || []).length === 0 &&
        (value.references || []).length === 0)
      return { provider, validity: "external-evidence-missing", status: value.status };
  }
  return reusableInputs
    ? {
      provider, validity: "reusable-inputs", status: value.status,
      receipt: value, expectedWorkspaceHash, expectedInputs
    }
    : { provider, validity: "valid", receipt: value };
}

function reportBudget(id, state, quiet = false) {
  const decision = applyBudgetDecision(state);
  const spent = decision.measured
    ? `${(decision.ratio * 100).toFixed(1)}%` : "unmeasured";
  const message = `BUDGET ${id}: ${spent} ` +
    `${decision.action} ${decision.recommendation} (${decision.limiter || "unknown"})`;
  if (!quiet) console.log(message);
  else if (decision.ratio >= 0.7 || decision.mode === "operator-required")
    console.error(`WARNING: ${message}`);
  return decision;
}

function budgetAuditPath(id) {
  return join(LOGS, id, "budget-events.jsonl");
}

function appendBudgetAudit(id, action, reason, decisionRef, previous, current) {
  const path = budgetAuditPath(id);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({
    version: 1,
    changeId: id,
    action,
    reason,
    decisionRef,
    previous,
    current,
    actor: process.env.USER || process.env.LOGNAME || "operator",
    timestamp: now()
  })}\n`);
}

function continueBudget(id, flags) {
  const reason = String(flags.reason || "").trim();
  if (!reason) die("budget continue requires --reason <reason>");
  const decisionRef = String(flags["decision-ref"] || "").trim();
  if (!decisionRef)
    die("budget continue requires --decision-ref <host-user-decision>; ask the user whether to continue, rescope, or pause before opening another window");
  const state = loadRuntime(id);
  const budget = ensureBudgetState(state);
  const decision = applyBudgetDecision(state);
  if (!["completion-only", "operator-required"].includes(decision.mode))
    die("budget continue is available only after the active run reaches a completion boundary");
  const extensionNumber = Number(budget.window.extensionNumber || 0);
  // "Split or rescope" names no command, so the refusal has to carry the shape
  // of both, plus the exit for work that should simply stop.
  if (extensionNumber >= 1)
    blockWithDecision(id, "budget-continuation-spent", {
      kind: "budget-continuation-spent",
      summary: "This run already used its one extra budget window, so continuing again would hide how much the change actually costs.",
      options: [
        {
          id: "rescope",
          outcome: "Narrow this change to what is already provable and carry the remainder into a new change."
        },
        {
          id: "split",
          outcome: "Create a follow-up change for the unfinished tasks and finish this one at its current scope."
        },
        {
          id: "abandon",
          outcome: "Retire this change without landing it."
        },
        { id: "pause", outcome: "Spend nothing further and leave the change as it stands." }
      ],
      recommended: "rescope",
      window: {
        used: budget.window.usedTokens,
        target: budget.window.targetTokens
      }
    });
  const artifactGaps = changeArtifactGaps(state, activeChangePath(id, state));
  const pending = artifactGaps.length ? [] : pendingTasks(id);
  const readiness = pending.length ? {
    status: "NEEDS_CODE_CHANGE",
    pendingTasks: pending.map((task) => task.id || task.text),
    externalProviders: [],
    unavailableProviders: [],
    budget: readinessBudgetPolicy("NEEDS_CODE_CHANGE")
  } : artifactGaps.length ? {
    status: "CONFIGURATION_ERROR",
    pendingTasks: [],
    externalProviders: [],
    unavailableProviders: [],
    issues: artifactGaps.map((artifact) => `missing change artifact: ${artifact}`),
    budget: readinessBudgetPolicy("CONFIGURATION_ERROR")
  } : proofReadinessValue(id, "prove");
  // Refusing a continuation is right when no model work remains, but the state
  // it leaves behind still has a way forward — usually one that costs no model
  // budget at all. Saying so is the difference between a gate and a wall.
  if (!readiness.budget?.eligible) {
    const unblockByClass = {
      "external-authority": {
        id: "external-evidence",
        outcome: "Provide the external review, acceptance, or evidence the proof is waiting on; this needs no model budget."
      },
      infrastructure: {
        id: "restore-provider",
        outcome: "Restore or reconfigure the unavailable provider, then re-run proof; this needs no model budget."
      },
      "active-work": {
        id: "wait",
        outcome: "Let the active workers finish or release their expired leases, then re-check readiness."
      },
      deterministic: {
        id: "run-proof",
        outcome: "Run the ready deterministic proof operation; no further model work is required."
      }
    };
    const unblock = unblockByClass[readiness.budget?.class] || unblockByClass.deterministic;
    blockWithDecision(id, "budget-continuation-rejected", {
      kind: "budget-continuation-rejected",
      summary: `A larger model budget would not move this change: ${
        readiness.budget?.reason || "no model-completable work remains"}.`,
      options: [
        unblock,
        {
          id: "rescope",
          outcome: "Narrow the change to what is provable here and carry the remainder into a new change."
        },
        { id: "abandon", outcome: "Retire this change without landing it." },
        { id: "pause", outcome: "Spend nothing further and leave the change as it stands." }
      ],
      recommended: unblock.id,
      readinessStatus: readiness.status,
      budgetClass: readiness.budget?.class || readiness.status
    });
  }
  const previous = structuredClone(budget.window);
  const targets = {
    requests: Number(budget.targetRequests),
    tokens: Number(budget.targetTokens)
  };
  const runId = String(flags.run || process.env.FOUNDATION_RUN_ID ||
    process.env.FOUNDATION_CLAUDE_SESSION_ID ||
    previous.id);
  const events = readJsonLines(join(LOGS, id, "events.jsonl"));
  const currentRunUsage = eventUsage(events.filter((event) => event.runId === runId));
  budget.window = budgetWindow(runId, targets, currentRunUsage,
    Number(previous.sequence || 0) + 1, "operator-continue");
  budget.window.extensionRootId = previous.extensionRootId || previous.id;
  budget.window.extensionNumber = extensionNumber + 1;
  const auditWindow = {
    ...budget.window,
    requiredStatus: readiness.status,
    pendingTasks: readiness.pendingTasks,
    missingExternalProviders: readiness.externalProviders,
    unavailableProviders: readiness.unavailableProviders
  };
  try {
    saveRuntime(state);
    appendBudgetAudit(id, "continue", reason, decisionRef, previous, auditWindow);
  } catch (error) {
    budget.window = previous;
    try { saveRuntime(state); } catch { /* preserve the original failure */ }
    throw error;
  }
  console.log(`BUDGET CONTINUED ${id}\n  run: ${runId}\n  reason: ${reason}\n  decision: ${decisionRef}`);
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); }
    catch (error) { die(`invalid JSONL: ${relative(ROOT, path)} (${error.message})`); }
  });
}

function readJsonLinesTolerant(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try { rows.push(JSON.parse(line)); }
    catch {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: skipped invalid telemetry row in ${relative(ROOT, path)}`);
    }
  }
  return rows;
}

const [command, ...values] = process.argv.slice(2);
// Help is answered before anything else. It must never be parsed as a change
// id, and it must never depend on the command's arguments being valid.
if (command === "--help" || command === "-h" || command === "help") {
  describeCommand(values.find((value) => !value.startsWith("-")) || null,
    { json: values.includes("--json") });
  process.exit(0);
}
assertRegisteredRuntimeCommand(command, values);
if (values.includes("--help") || values.includes("-h")) {
  describeCommand(command, { json: values.includes("--json") });
  process.exit(0);
}
const unattendedMentioned = command === "sandbox" &&
  ["create", "inspect"].includes(values[0]) &&
  values.slice(1).some((value) =>
    value === "--unattended" || value.startsWith("--unattended="));
const telemetrySuppressed = command === "sandbox" && (
  values[0] === "inspect" ||
  (values[0] === "create" && unattendedMentioned)
);
if (telemetrySuppressed) process.env.FOUNDATION_TELEMETRY = "0";
operationName = command || null;
// Positional, so a flag in the change slot became a directory name:
// `sandbox create --all <change>` created `.foundation/logs/--all/`.
const namedChange = (value) =>
  typeof value === "string" && !value.startsWith("-") ? value : null;
operationChangeId = command === "sandbox" ? namedChange(values[1]) :
  ["resolve", "validate", "audit-change", "hash", "packet", "agent-plan", "agent-task", "agent-acquire", "agent-release", "metrics", "budget-continue", "proof-plan", "proof-readiness", "proof-run", "proof-collect", "proof-preflight", "proof-execute", "proof-audit", "evidence-upgrade", "evidence-verify-ci", "authority-request", "authority-status", "authority-record", "receipt", "run-provider", "prove",
    "evidence-detect", "evidence-init", "evidence-doctor", "land-check", "land-plan", "land-record", "land-pointers", "land-resume", "archive", "event", "telemetry-sync", "telemetry-import"].includes(command) ? namedChange(values[0]) : null;

// One table, in `runtime/core/lifecycle-phase.mjs`, shared with the operations
// row written on exit. The phase is derived here rather than read only from
// FOUNDATION_PUBLIC_OPERATION so a direct runtime invocation buckets the same
// way a `cli.sh` one does.
operationPhase = phaseForCommand(command);
const telemetryPhase = telemetryPhaseForCommand(command);
// An archived change is finished evidence. Reading it back — `metrics` on a
// landed run, say — must never append this session's telemetry to its log.
const telemetryWritable = (id) => Boolean(id) && existsSync(runtimePath(id)) &&
  readJson(runtimePath(id), {}).status !== "archived";
if (!telemetrySuppressed && telemetryPhase && telemetryWritable(operationChangeId))
  prepareClaudeTelemetry(operationChangeId, telemetryPhase);
if (command === "metrics" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });
if (command === "budget-continue" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });

await routeRuntimeCommand(command, values, {
  parseFlags,
  parseStrictCommandFlags,
  fail: die,
  createChange,
  rapidStartTemplate,
  startAtomic,
  resolveChange,
  abandonChange,
  showChanges,
  showProviders,
  showRepositories,
  foundationPolicy,
  showAgentPlan,
  showAgentTask,
  acquireAgentLease,
  releaseAgentLease,
  prepareClaudeTelemetry,
  recordPhaseContext,
  showPacket,
  showMetrics,
  execObserved,
  continueBudget,
  doctor,
  validate,
  showTraceabilityAudit,
  relevantHash,
  proofPlan,
  proofReadiness,
  proofRun,
  proofCollect,
  proofPreflight,
  proofExecute,
  proofAudit,
  showEvidenceDetection,
  initializeEvidence,
  showEvidenceDoctor,
  recordVerifiedCi,
  requestAuthority,
  showAuthorityStatus,
  recordAuthority,
  upgradeEvidence,
  recordReceipt,
  runProvider,
  prove,
  landCheck,
  showLandPlan,
  recordRepositoryLand,
  stageRootPointers,
  resumeLand,
  createAttestationChallenge,
  showSandboxInspection,
  createSandbox,
  syncSandbox,
  applySandbox,
  archive,
  recordEvent,
  syncClaudeTelemetry,
  importTelemetry,
  importHostExecution,
  migrate,
  usage,
  describeCommand,
  runtimeApiVersion: RUNTIME_API_VERSION,
  version: VERSION
});
