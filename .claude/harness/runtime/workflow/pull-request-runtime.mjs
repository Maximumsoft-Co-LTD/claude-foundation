import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryDeliveryOrder } from "./repository-delivery-saga.mjs";
import { createDeliveryIntegrity, deliveryProjectionEntry } from "./delivery-integrity.mjs";

export const DELIVERY_PROTOCOL_VERSION = 1;
export const DELIVERY_RECEIPT_SCHEMA_VERSION = 1;

export const PULL_REQUEST_TYPES = [
  "feature-frontend",
  "feature-backend",
  "bug-fix",
  "refactor-technical-debt",
  "database-migration",
  "infrastructure-devops",
  "performance",
  "security-hotfix"
];

const TYPE_LABELS = {
  "feature-frontend": "Feature — Frontend",
  "feature-backend": "Feature — Backend",
  "bug-fix": "Bug Fix",
  "refactor-technical-debt": "Refactor / Technical Debt",
  "database-migration": "Database / Migration",
  "infrastructure-devops": "Infrastructure / DevOps",
  performance: "Performance",
  "security-hotfix": "Security / Hotfix"
};

const TYPE_SECTIONS = {
  "feature-frontend": ["Design and visual evidence", "Responsive and states", "Accessibility and analytics"],
  "feature-backend": ["API contract", "Data and authorization", "Idempotency and concurrency"],
  "bug-fix": ["Problem", "Root cause", "Fix", "Regression evidence"],
  "refactor-technical-debt": ["Objective", "Behavior change", "Before and after", "Quality metrics"],
  "database-migration": ["Schema change", "Migration execution", "Compatibility", "Backup and rollback"],
  "infrastructure-devops": ["Infrastructure change", "Expected result", "Operational verification"],
  performance: ["Benchmark method", "Before and after metrics", "Capacity impact"],
  "security-hotfix": ["Threat or incident", "Attack or failure path", "Mitigation", "Security regression evidence"]
};

const SECRET_FIELD = /(?:password|passwd|private[_-]?key|secret|credential|access[_-]?token|refresh[_-]?token|api[_-]?key)/i;
const SECRET_VALUE = /(?:AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{16,}|https?:\/\/[^\s/:@]+:[^\s@]+@)/i;

function clean(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function deliveryPolicy(policy = {}) {
  const configured = policy?.deliver || {};
  return {
    provider: clean(configured.provider) || "auto",
    remote: clean(configured.remote) || "origin",
    defaultBaseBranch: clean(configured.defaultBaseBranch) || null,
    branchPattern: clean(configured.branchPattern) || "change/{changeId}",
    missingPresentationEvidence: clean(configured.missingPresentationEvidence) || "draft",
    missingRequiredEvidence: clean(configured.missingRequiredEvidence) || "block",
    updateOwnedPullRequest: configured.updateOwnedPullRequest !== false,
    allowForcePush: false,
    allowDefaultBranchPush: false,
    allowedHosts: Array.isArray(configured.allowedHosts)
      ? configured.allowedHosts.map(clean).filter(Boolean) : ["github.com"]
  };
}

export function safeBranchComponent(value) {
  return clean(value).toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/(?:^|\/)\.+(?:\/|$)/g, "/")
    .replace(/^[-/.]+|[-/.]+$/g, "")
    .slice(0, 120) || "change";
}

export function deliveryBranchName(pattern, changeId) {
  const substituted = clean(pattern || "change/{changeId}")
    .replaceAll("{changeId}", safeBranchComponent(changeId));
  return safeBranchComponent(substituted);
}

export function parseGitHubRemote(value) {
  const raw = clean(value);
  const https = raw.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  const ssh = raw.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  const match = https || ssh;
  if (!match) return null;
  return { host: match[1].toLowerCase(), owner: match[2], repository: match[3], slug: `${match[2]}/${match[3]}` };
}

export function classifyPullRequest({ text = "", paths = [] } = {}) {
  const source = `${text}\n${paths.join("\n")}`.toLowerCase();
  const matches = (pattern) => pattern.test(source);
  if (matches(/\b(security|vulnerab|cve|idor|xss|csrf|auth(?:entication|orization)?|hotfix|incident)\b/))
    return "security-hotfix";
  if (matches(/\b(database|migration|migrate|schema|index|backfill|postgres|mysql|mongo)\b/))
    return "database-migration";
  if (matches(/\b(terraform|kubernetes|k8s|docker|helm|cloudflare|ci\/cd|workflow|infrastructure|devops)\b/))
    return "infrastructure-devops";
  if (matches(/\b(performance|latency|throughput|benchmark|p50|p95|p99|rps|capacity)\b/))
    return "performance";
  if (matches(/\b(bug|fix|incorrect|regression|root cause|failure|broken)\b/))
    return "bug-fix";
  if (matches(/\b(refactor|technical debt|complexity|crap score|mutation score|cleanup)\b/))
    return "refactor-technical-debt";
  if (paths.some((path) => /(?:^|\/)(?:app|pages|components|web|frontend|ui)(?:\/|$)|\.(?:css|scss|tsx|jsx|vue|svelte)$/i.test(path)))
    return "feature-frontend";
  return "feature-backend";
}

export function markdownSection(source, heading) {
  const lines = String(source || "").split(/\r?\n/);
  const wanted = clean(heading).toLowerCase();
  const start = lines.findIndex((line) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    return match && clean(match[1]).toLowerCase() === wanted;
  });
  if (start < 0) return "";
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const marker = line.match(/^(#+)\s+/);
    if (marker && marker[1].length <= level) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

function bullets(source) {
  return String(source || "").split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(?:\*\*[^*]+\*\*\s*)?(.+)$/)?.[1])
    .map(clean).filter(Boolean);
}

function taskTitles(source) {
  return String(source || "").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*-\s+\[[ xX]\]\s+\*\*(T\d+)\*\*\s+(.+?)(?:\s+—|\s+\[repo:|$)/);
    return match ? [`${match[1]} — ${clean(match[2])}`] : [];
  });
}

function relatedReferences(source) {
  const urls = String(source || "").match(/https?:\/\/[^\s)>]+/g) || [];
  return unique(urls).slice(0, 20);
}

export function pullRequestNarrative({ changeId, state, proposal, design, tasks, proof, paths }) {
  const why = markdownSection(proposal, "Why") || clean(state.intent) || `Deliver ${changeId}`;
  const changes = markdownSection(proposal, "What changes") || markdownSection(proposal, "What Changes");
  const nonGoals = markdownSection(proposal, "Non-goals") || markdownSection(proposal, "Non-Goals");
  const included = bullets(changes).length ? bullets(changes) : taskTitles(tasks);
  const excluded = bullets(nonGoals);
  const titleSource = included[0] || clean(state.intent) || changeId;
  const title = titleSource.replace(/[`*_]/g, "").replace(/[.!]$/, "").slice(0, 120);
  const type = classifyPullRequest({ text: `${proposal}\n${design}\n${tasks}`, paths });
  const receipts = Array.isArray(proof?.receipts) ? proof.receipts : [];
  return {
    changeId,
    title,
    summary: included.length ? included.join("\n") : clean(changes) || title,
    why,
    relatedWork: relatedReferences(`${proposal}\n${design}`),
    included,
    excluded,
    type,
    testEvidence: receipts.map((receipt) => ({
      provider: receipt.provider,
      repositoryId: receipt.repositoryId || null,
      reference: receipt.path,
      digest: receipt.sha256 || null
    })),
    risk: `Impact: ${state.impact || "unknown"}; coupling: ${state.coupling || "unknown"}.`,
    rollback: markdownSection(design, "Rollback") ||
      markdownSection(design, "Compatibility and migration") ||
      "Revert the delivery commit; no deployment or merge is performed by Deliver.",
    monitoring: markdownSection(design, "Monitoring") ||
      "No runtime monitoring plan was declared in the archived change.",
    paths
  };
}

function receiptEvidenceText(root, proof, readJson) {
  return (proof?.receipts || []).flatMap((entry) => {
    const receipt = entry?.path ? readJson(join(root, entry.path), {}) : {};
    return [entry.provider, receipt.observed,
      ...(receipt.references || []),
      ...(receipt.artifacts || []).flatMap((artifact) =>
        [artifact.type, artifact.path, artifact.name, artifact.description])]
      .map(clean).filter(Boolean);
  }).join("\n").toLowerCase();
}

export function deliveryEvidenceAssessment({ root, lifecycle, proof, narrative, readJson }) {
  const requiredIssues = [];
  if (proof?.status !== "pass") requiredIssues.push("finalized proof is missing or not passing");
  if (!proof?.proofRunId || proof.proofRunId !== lifecycle?.land?.proofRunId)
    requiredIssues.push("proof run does not match the Land binding");
  if (!Array.isArray(proof?.receipts) || proof.receipts.length === 0)
    requiredIssues.push("proof has no durable receipt manifest");
  for (const entry of proof?.receipts || []) {
    const path = entry?.path ? join(root, entry.path) : null;
    if (!path || !existsSync(path) || pathIdentityForEvidence(path) !== entry.sha256)
      requiredIssues.push(`proof receipt is missing or changed: ${entry?.provider || "unknown"}`);
  }

  const evidenceText = receiptEvidenceText(root, proof, readJson);
  const presentationPatterns = {
    "feature-frontend": /screenshot|visual|image|\.png\b|\.jpe?g\b|\.webp\b|\.gif\b|video|\.webm\b|\.mp4\b/,
    "feature-backend": /request|response|api|integration|contract/,
    "bug-fix": /regression|before|after|reproduc|root.?cause/,
    "refactor-technical-debt": /coverage|complexity|mutation|crap|behavior|test/,
    "database-migration": /migration|schema|backfill|record|lock|database/,
    "infrastructure-devops": /metric|grafana|terraform|plan|docker|kubernetes|helm|infrastructure/,
    performance: /benchmark|k6|latency|throughput|p50|p95|p99|rps|cpu|memory/,
    "security-hotfix": /attack|security|vulnerab|authorization|authentication|incident|idor|xss|csrf/
  };
  const pattern = presentationPatterns[narrative.type];
  const presentationComplete = Boolean(pattern?.test(evidenceText));
  const scoreParts = {
    summary: Boolean(clean(narrative.summary)),
    why: Boolean(clean(narrative.why)),
    scope: narrative.paths.length > 0,
    evidence: requiredIssues.length === 0,
    risk: Boolean(clean(narrative.risk)),
    rollback: Boolean(clean(narrative.rollback)),
    monitoring: Boolean(clean(narrative.monitoring)),
    typeEvidence: presentationComplete
  };
  const score = Math.round(Object.values(scoreParts).filter(Boolean).length /
    Object.keys(scoreParts).length * 100);
  return {
    requiredComplete: requiredIssues.length === 0,
    requiredIssues,
    presentationComplete,
    presentationIssue: presentationComplete ? null :
      `No ${TYPE_LABELS[narrative.type] || narrative.type} presentation evidence was identified in the proven receipts.`,
    quality: { score, checks: scoreParts }
  };
}

function pathIdentityForEvidence(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function markdownList(values, empty) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

export function renderPullRequestBody(narrative, { draft = false } = {}) {
  const typeSections = TYPE_SECTIONS[narrative.type] || [];
  const evidence = narrative.testEvidence.map((row) =>
    `- **${row.provider}**${row.repositoryId ? ` (${row.repositoryId})` : ""}: \`${row.reference}\`${row.digest ? ` — \`${row.digest.slice(0, 12)}\`` : ""}`);
  const related = narrative.relatedWork.length ? narrative.relatedWork : [`OpenSpec change: \`${narrative.changeId}\``];
  const extra = typeSections.map((heading) =>
    `## ${heading}\n\nNot separately declared; see the verified evidence and archived design above.`).join("\n\n");
  return [
    "## Summary", "", narrative.summary, "",
    "## Why", "", narrative.why, "",
    "## Related Work", "", markdownList(related, `OpenSpec change: \`${narrative.changeId}\``), "",
    "## Type", "", TYPE_LABELS[narrative.type] || narrative.type, "",
    "## Scope", "", "### Included", "",
    markdownList(narrative.included, "See the proven path projection below."), "",
    "### Not Included", "", markdownList(narrative.excluded, "No explicit non-goals were declared."), "",
    "### Proven paths", "", markdownList(narrative.paths.map((path) => `\`${path}\``), "No product path changes."), "",
    "## Test & Evidence", "", markdownList(evidence, "No receipt references were available."), "",
    "## Risk", "", narrative.risk, "",
    "## Rollback", "", narrative.rollback, "",
    "## Monitoring", "", narrative.monitoring,
    narrative.quality ? `\n\n## PR Quality\n\nScore: **${narrative.quality.score}/100**` : "",
    extra ? `\n\n${extra}` : "",
    draft ? "\n\n> This pull request is a draft because presentation evidence is incomplete." : "",
    "\n\n---\nGenerated from archived OpenSpec and content-bound Foundation proof."
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function containsSecretMaterial(value) {
  if (SECRET_VALUE.test(String(value || ""))) return true;
  return String(value || "").split(/\r?\n/).some((line) => {
    const match = line.match(/^\s*([^:=]+)\s*[:=]\s*(.+)$/);
    return match && SECRET_FIELD.test(match[1].replace(/[^a-z0-9]/gi, "")) && clean(match[2]) &&
      !/^(?:none|not applicable|redacted|\*+|x+)$/i.test(clean(match[2]));
  });
}

function resultText(result) {
  return clean(result?.stderr || result?.stdout || result?.error?.message);
}

function runChecked(run, executable, args, options, label) {
  const result = run(executable, args, options);
  if (result.status !== 0) {
    const error = new Error(`${label}: ${resultText(result) || `exit ${result.status}`}`);
    error.code = "DELIVERY_EXTERNAL_COMMAND_FAILED";
    error.command = executable;
    error.result = result;
    throw error;
  }
  return result;
}

function copyEntry(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  if (!existsSync(source)) return;
  const stat = lstatSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
  else cpSync(source, destination, {
    recursive: stat.isDirectory(), dereference: false, verbatimSymlinks: true,
    preserveTimestamps: true
  });
}

function filesUnder(root, rel) {
  const absolute = join(root, rel);
  if (!existsSync(absolute)) return [rel];
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return [rel];
  const rows = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path);
      else rows.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(absolute);
  return rows.length ? rows : [rel];
}

function archivedSpecPaths(root, archivedChangePath) {
  const specs = join(root, archivedChangePath, "specs");
  if (!existsSync(specs)) return [];
  return readdirSync(specs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `openspec/specs/${entry.name}/spec.md`);
}

function safeRepositoryId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function repositoryDeliveryProjection({
  repository, lifecycle, transactions, readJson, pathIdentity
}) {
  const runtime = lifecycle.repositories?.[repository.id];
  const transactionId = runtime?.delivery?.transactionId;
  if (!transactionId)
    throw new Error(`repository '${repository.id}' has no Land delivery transaction`);
  const journalPath = join(transactions, "repository-delivery",
    safeRepositoryId(repository.id), lifecycle.id, transactionId, "journal.json");
  const journal = readJson(journalPath, {});
  if (!journal || !["verified", "committed"].includes(journal.status) ||
      !Array.isArray(journal.entries))
    throw new Error(`repository '${repository.id}' has no verified Land journal`);
  const entries = journal.entries.filter((entry) =>
    !(entry.before === entry.after &&
      (entry.beforeMode === undefined || entry.beforeMode === entry.afterMode)));
  for (const entry of entries) {
    const observed = pathIdentity(join(repository.path, entry.path));
    if (observed !== entry.after) {
      const error = new Error(`proven path changed after Land in '${repository.id}': ${entry.path}`);
      error.code = "DELIVERY_PROJECTION_DRIFT";
      error.path = entry.path;
      throw error;
    }
  }
  const roots = unique(entries.map((entry) => entry.path)).sort();
  return {
    version: 1,
    changeId: lifecycle.id,
    repositoryId: repository.id,
    baseHead: runtime.baseHead || journal.baseHead || null,
    sourceProjectionHash: runtime.delivery.projectionHash || journal.projectionHash,
    integrity: "land-bound",
    roots,
    entries: unique(roots.flatMap((path) => filesUnder(repository.path, path))).sort()
      .map((path) => deliveryProjectionEntry(repository.path, path, pathIdentity))
  };
}

export function deliveryProjection({ root, state, readJson, transactionJournalPath, pathIdentity }) {
  if (state.status !== "archived") {
    const error = new Error(`change '${state.id}' is not archived`);
    error.code = "DELIVERY_REQUIRES_ARCHIVED";
    throw error;
  }
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) throw new Error(`archived change '${state.id}' has no applied projection`);
  const journal = readJson(transactionJournalPath(state.id, transactionId), {});
  if (!journal || !Array.isArray(journal.entries) || journal.status !== "committed")
    throw new Error(`archived change '${state.id}' has no committed apply journal`);
  const activeChange = `openspec/changes/${state.id}`;
  const productEntries = journal.entries.filter((entry) => entry.path !== activeChange &&
    !(entry.before === entry.after && (entry.beforeMode === undefined || entry.beforeMode === entry.afterMode)));
  for (const entry of productEntries) {
    const observed = pathIdentity(join(root, entry.path));
    if (observed !== entry.after) {
      const error = new Error(`proven path changed after Land: ${entry.path}`);
      error.code = "DELIVERY_PROJECTION_DRIFT";
      error.path = entry.path;
      throw error;
    }
  }
  const archive = clean(state.archivedChangePath);
  if (!archive || !existsSync(join(root, archive)))
    throw new Error(`archived OpenSpec packet for '${state.id}' is unavailable`);
  for (const entry of state.deliveryIntegrity?.entries || []) {
    if (pathIdentity(join(root, entry.path)) !== entry.identity) {
      const error = new Error(`archived delivery input changed after Land: ${entry.path}`);
      error.code = "DELIVERY_PROJECTION_DRIFT";
      error.path = entry.path;
      throw error;
    }
  }
  const roots = unique([
    ...productEntries.map((entry) => entry.path),
    activeChange,
    archive,
    ...archivedSpecPaths(root, archive)
  ]).sort();
  const paths = unique(roots.flatMap((path) => filesUnder(root, path))).sort();
  const entries = paths.map((path) => deliveryProjectionEntry(root, path, pathIdentity));
  const projectionHash = state.workspace?.apply?.projectionHash || journal.projectionHash;
  return {
    version: 1,
    changeId: state.id,
    baseHead: state.workspace?.baseHead || journal.baseHead || null,
    sourceProjectionHash: projectionHash,
    integrity: state.deliveryIntegrity ? "land-bound" : "legacy-observed",
    roots,
    entries
  };
}

function gitOutput(git, args, cwd, label) {
  const result = git(args, cwd);
  if (result.status !== 0) throw new Error(`${label}: ${resultText(result)}`);
  return clean(result.stdout);
}

function deliveryEnvelope(changeId, action, fields = {}) {
  return { version: DELIVERY_PROTOCOL_VERSION, changeId, action, ...fields };
}

export function createPullRequestRuntime({
  root,
  deliveriesRoot,
  loadRuntime,
  activeChangePath,
  proofPath,
  transactionJournalPath,
  pathIdentity,
  readJson,
  writeJson,
  stableHash,
  git,
  transactions = null,
  selectedRepositories = null,
  foundationPolicy = () => ({}),
  now = () => new Date().toISOString(),
  run = spawnSync,
  fail = (message) => { throw new Error(message); }
}) {
  const integrity = createDeliveryIntegrity({ git, run, runChecked, gitOutput });
  const statePath = (id) => join(deliveriesRoot, id, "state.json");
  const receiptPath = (id) => join(deliveriesRoot, id, "receipt.json");
  const bodyPath = (id) => join(deliveriesRoot, id, "pull-request.md");
  const eventsPath = (id) => join(deliveriesRoot, id, "events.jsonl");
  const workspacePath = (id) => join(deliveriesRoot, id, "workspace");
  const repositoryWorkspacePath = (id, repositoryId) => repositoryId === "root"
    ? workspacePath(id)
    : join(deliveriesRoot, id, "repositories", safeRepositoryId(repositoryId), "workspace");
  const repositoryBodyPath = (id, repositoryId) => repositoryId === "root"
    ? bodyPath(id)
    : join(deliveriesRoot, id, "repositories", safeRepositoryId(repositoryId), "pull-request.md");

  function saveDelivery(value) {
    value.updatedAt = now();
    writeJson(statePath(value.changeId), value);
    return value;
  }

  function loadDelivery(id) {
    return readJson(statePath(id), {
      version: DELIVERY_PROTOCOL_VERSION,
      changeId: id,
      status: "new",
      history: []
    });
  }

  function checkpoint(state, status, details = {}) {
    state.status = status;
    Object.assign(state, details);
    state.history = [...(state.history || []), { status, at: now() }].slice(-50);
    const saved = saveDelivery(state);
    mkdirSync(dirname(eventsPath(state.changeId)), { recursive: true });
    appendFileSync(eventsPath(state.changeId), `${JSON.stringify({
      version: 1, changeId: state.changeId, status, at: saved.updatedAt
    })}\n`);
    return saved;
  }

  function archivedSources(id, lifecycle) {
    const changeRoot = activeChangePath(id, lifecycle);
    const read = (name) => existsSync(join(changeRoot, name))
      ? readFileSync(join(changeRoot, name), "utf8") : "";
    return { proposal: read("proposal.md"), design: read("design.md"), tasks: read("tasks.md") };
  }

  function providerContext(policy, repositoryRoot = root) {
    const remoteUrl = gitOutput(git, ["remote", "get-url", policy.remote], repositoryRoot,
      `cannot resolve Git remote '${policy.remote}'`);
    const remote = parseGitHubRemote(remoteUrl);
    if (!remote || (policy.provider !== "auto" && policy.provider !== "github"))
      throw new Error(`Deliver currently requires a GitHub remote; found '${remoteUrl}'`);
    if (!policy.allowedHosts.includes(remote.host))
      throw new Error(`Git remote host '${remote.host}' is not allowed by delivery policy`);
    const defaultBase = policy.defaultBaseBranch ||
      gitOutput(git, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${policy.remote}/HEAD`], repositoryRoot,
        "cannot determine default branch").replace(`${policy.remote}/`, "");
    if (!defaultBase) throw new Error("Deliver cannot determine a base branch");
    return { remote, remoteName: policy.remote, baseBranch: defaultBase };
  }

  function prepareWorkspace(id, state, projection, branch, repositoryRoot = root,
    workspace = workspacePath(id)) {
    const currentHead = gitOutput(git, ["rev-parse", "HEAD"], repositoryRoot,
      "cannot inspect target HEAD");
    if (!projection.baseHead || currentHead !== projection.baseHead) {
      const error = new Error(`target HEAD moved after Land (expected ${projection.baseHead || "unknown"}, observed ${currentHead})`);
      error.code = "DELIVERY_TARGET_MOVED";
      throw error;
    }
    if (!existsSync(workspace)) {
      mkdirSync(dirname(workspace), { recursive: true });
      const branchExists = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repositoryRoot).status === 0;
      if (branchExists && state.branch === branch) {
        runChecked(run, "git", ["worktree", "add", workspace, branch],
          { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot restore delivery worktree");
      } else {
        runChecked(run, "git", ["worktree", "add", "--detach", workspace, projection.baseHead],
          { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery worktree");
        runChecked(run, "git", ["switch", "-c", branch],
          { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery branch");
        for (const path of projection.roots)
          copyEntry(join(repositoryRoot, path), join(workspace, path));
        if (repositoryRoot === root)
          rmSync(join(workspace, "openspec", "changes", id), { recursive: true, force: true });
      }
    }
    const observedBranch = gitOutput(git, ["branch", "--show-current"], workspace,
      "cannot inspect delivery branch");
    if (observedBranch !== branch)
      throw new Error(`delivery workspace uses unexpected branch '${observedBranch || "detached"}'`);
    return workspace;
  }

  function stageProjection(workspace, projection, gitlinks = []) {
    const stageable = projection.roots.filter((path) => {
      if (existsSync(join(workspace, path))) return true;
      const tracked = git(["ls-files", "-z", "--", path], workspace);
      return tracked.status === 0 && Boolean(tracked.stdout);
    });
    if (!stageable.length) throw new Error("delivery projection has no stageable paths");
    const result = git(["add", "-A", "--", ...stageable], workspace);
    if (result.status !== 0) throw new Error(`cannot stage delivery projection: ${resultText(result)}`);
    for (const link of gitlinks) {
      const update = git(["update-index", "--add", "--cacheinfo",
        `160000,${link.commit},${link.path}`], workspace);
      if (update.status !== 0)
        throw new Error(`cannot stage delivered gitlink '${link.path}': ${resultText(update)}`);
    }
    const staged = gitOutput(git, ["diff", "--cached", "--name-only", "-z"], workspace,
      "cannot inspect staged projection").split("\0").filter(Boolean).sort();
    const allowedGitlinks = new Set(gitlinks.map((link) => link.path));
    const outside = staged.filter((path) => !allowedGitlinks.has(path) &&
      !projection.roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`)));
    if (outside.length) throw new Error(`delivery staged paths outside the proven projection: ${outside.join(", ")}`);
    if (!staged.length) throw new Error("delivery projection produces no commit");
    integrity.assertTree(workspace, projection,
      gitOutput(git, ["write-tree"], workspace, "cannot inspect staged delivery tree"), gitlinks);
    return staged;
  }

  function createCommit(workspace, title) {
    const message = `${title.toLowerCase().startsWith("fix") ? "fix" : "feat"}: ${title}`.slice(0, 180);
    runChecked(run, "git", ["commit", "-m", message],
      { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot create delivery commit");
    return gitOutput(git, ["rev-parse", "HEAD"], workspace, "cannot resolve delivery commit");
  }

  function recoverCommit(workspace, projection, gitlinks = []) {
    const head = gitOutput(git, ["rev-parse", "HEAD"], workspace,
      "cannot inspect delivery workspace HEAD");
    if (head === projection.baseHead) return null;
    const count = Number(gitOutput(git,
      ["rev-list", "--count", `${projection.baseHead}..${head}`], workspace,
      "cannot inspect delivery commit history"));
    if (count !== 1) throw new Error("delivery branch contains an unexpected commit history");
    const changed = gitOutput(git,
      ["diff", "--name-only", "-z", projection.baseHead, head], workspace,
      "cannot inspect recovered delivery commit").split("\0").filter(Boolean);
    const allowedGitlinks = new Set(gitlinks.map((link) => link.path));
    const outside = changed.filter((path) => !allowedGitlinks.has(path) &&
      !projection.roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`)));
    if (outside.length)
      throw new Error(`delivery commit contains paths outside the proven projection: ${outside.join(", ")}`);
    const dirty = gitOutput(git, ["status", "--porcelain"], workspace,
      "cannot inspect recovered delivery workspace");
    const unexpectedDirty = dirty.split("\n").filter(Boolean).filter((line) => {
      const path = line.slice(3).split(" -> ").at(-1);
      return !allowedGitlinks.has(path);
    });
    if (unexpectedDirty.length)
      throw new Error("delivery workspace changed after its commit");
    return { commit: head, stagedPaths: changed, recovered: true };
  }

  function findPullRequest(provider, branch, baseBranch) {
    const result = run("gh", ["pr", "list", "--repo", provider.remote.slug,
      "--head", branch, "--base", baseBranch, "--state", "open",
      "--json", "number,url,state,isDraft,headRefOid", "--limit", "10"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`cannot query pull requests: ${resultText(result)}`);
    let rows;
    try { rows = JSON.parse(result.stdout || "[]"); }
    catch { throw new Error("GitHub returned invalid pull-request JSON"); }
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  function openPullRequest(provider, branch, narrative, body, draft,
    pullRequestBodyPath = bodyPath(narrative.changeId)) {
    mkdirSync(dirname(pullRequestBodyPath), { recursive: true });
    writeFileSync(pullRequestBodyPath, body);
    const args = ["pr", "create", "--repo", provider.remote.slug,
      "--head", branch, "--base", provider.baseBranch,
      "--title", narrative.title, "--body-file", pullRequestBodyPath];
    if (draft) args.push("--draft");
    const result = runChecked(run, "gh", args,
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, "cannot open pull request");
    return clean(result.stdout).split(/\s+/).find((value) => /^https:\/\//.test(value)) || null;
  }

  function verifyPullRequest(provider, url, commit) {
    if (!url) throw new Error("GitHub did not return a pull-request URL");
    const result = run("gh", ["pr", "view", url, "--repo", provider.remote.slug,
      "--json", "number,url,state,isDraft,headRefName,baseRefName,headRefOid"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`cannot verify pull request: ${resultText(result)}`);
    let value;
    try { value = JSON.parse(result.stdout || "{}"); }
    catch { throw new Error("GitHub returned invalid pull-request verification JSON"); }
    if (value.state !== "OPEN" || value.headRefOid !== commit ||
        value.baseRefName !== provider.baseBranch)
      throw new Error("pull-request read-back does not match the delivered commit and base branch");
    if (!clean(value.url).startsWith(`https://${provider.remote.host}/`))
      throw new Error("pull-request URL is outside the approved Git host");
    return value;
  }

  function existingReceipt(id, lifecycle) {
    if (!existsSync(receiptPath(id))) return null;
    const receipt = readJson(receiptPath(id));
    if (!receipt) return null;
    if (receipt.version !== DELIVERY_RECEIPT_SCHEMA_VERSION ||
        receipt.changeId !== id || receipt.archivedAt !== lifecycle.archivedAt)
      return null;
    return receipt;
  }

  function archivedRepositories(id, lifecycle) {
    if (!selectedRepositories) return [{
      id: "root", path: root, mode: "write", dependsOn: [], relativePath: "."
    }];
    return selectedRepositories(id, lifecycle, fail, {
      changeDir: join(root, lifecycle.archivedChangePath), useTargetPaths: true
    }).filter((repository) => repository.mode === "write");
  }

  async function advanceMulti(id, lifecycle, delivery, policy, repositories) {
    if (!transactions) throw new Error("multi-repository Deliver has no transaction store");
    if (delivery.status === "new") checkpoint(delivery, "requested", {
      requestedAt: now(), authority: {
        kind: "explicit-deliver-command",
        allowed: ["create-feature-branch", "stage-proven-projection", "commit",
          "push-feature-branch", "open-or-update-pr"],
        forbidden: ["force-push", "push-default-branch", "merge", "deploy", "publish"]
      }
    });
    const ordered = repositoryDeliveryOrder(repositories);
    const rootRepository = ordered.find((row) => row.id === "root");
    const execution = [
      ...ordered.filter((row) => row.id !== "root"),
      ...(rootRepository ? [rootRepository] : [])
    ];
    const proof = readJson(proofPath(id), {});
    const sources = archivedSources(id, lifecycle);
    const completed = new Map();
    delivery.repositories ||= {};

    for (const repository of execution) {
      let node = delivery.repositories[repository.id] || { status: "new" };
      const projection = node.projection || (repository.id === "root"
        ? deliveryProjection({ root, state: lifecycle, readJson,
          transactionJournalPath, pathIdentity })
        : repositoryDeliveryProjection({
          repository, lifecycle, transactions, readJson, pathIdentity
        }));
      if (repository.id !== "root" && projection.roots.length === 0) {
        delivery.repositories[repository.id] = {
          ...node, status: "no-change", projection,
          repository: { id: repository.id, path: repository.path }
        };
        checkpoint(delivery, "repositories-delivering");
        continue;
      }
      const provider = providerContext(policy, repository.path);
      const narrative = node.narrative || pullRequestNarrative({
        changeId: id, state: lifecycle, ...sources, proof,
        paths: projection.entries.map((entry) => repository.id === "root"
          ? entry.path : `${repository.id}:${entry.path}`)
      });
      const evidence = deliveryEvidenceAssessment({
        root, lifecycle, proof, narrative, readJson
      });
      if (!evidence.requiredComplete && policy.missingRequiredEvidence === "block") {
        const error = new Error(`required delivery evidence is incomplete: ${
          evidence.requiredIssues.join("; ")}`);
        error.code = "DELIVERY_EVIDENCE_BLOCKED";
        throw error;
      }
      narrative.quality = evidence.quality;
      narrative.presentationEvidence = {
        complete: evidence.presentationComplete, issue: evidence.presentationIssue
      };
      const draft = !evidence.presentationComplete &&
        policy.missingPresentationEvidence === "draft";
      const body = renderPullRequestBody(narrative, { draft });
      if (containsSecretMaterial(body))
        throw new Error("generated pull-request body appears to contain secret material");
      const branch = node.branch || deliveryBranchName(policy.branchPattern, id);
      if (branch === provider.baseBranch) {
        const error = new Error(`delivery branch '${branch}' is the default branch`);
        error.code = "DELIVERY_DEFAULT_BRANCH_FORBIDDEN";
        throw error;
      }
      const workspace = node.workspace || repositoryWorkspacePath(id, repository.id);
      const gitlinks = repository.id === "root" ? repositories
        .filter((row) => row.type === "submodule" && row.id !== "root" &&
          row.relativePath && completed.has(row.id))
        .map((row) => ({ path: row.relativePath, commit: completed.get(row.id).commit })) : [];

      if (!existsSync(workspace))
        prepareWorkspace(id, node, projection, branch, repository.path, workspace);
      node = { ...node, status: node.status === "new" ? "workspace-prepared" : node.status,
        workspace, branch, projection, narrative, draft, repository: {
          id: repository.id, path: repository.path, relativePath: repository.relativePath || null
        } };
      delivery.repositories[repository.id] = node;
      checkpoint(delivery, "repositories-delivering");

      let commit = node.commit;
      if (!commit) {
        const recovered = recoverCommit(workspace, projection, gitlinks);
        if (recovered) ({ commit } = recovered);
        else {
          node.stagedPaths = stageProjection(workspace, projection, gitlinks);
          commit = createCommit(workspace, narrative.title);
        }
        node.commit = commit;
        node.status = "commit-created";
        checkpoint(delivery, "repositories-delivering");
      } else if (gitOutput(git, ["rev-parse", "HEAD"], workspace,
        "cannot verify delivery commit") !== commit) {
        throw new Error(`delivery workspace commit changed for repository '${repository.id}'`);
      }
      integrity.assertTree(workspace, projection, commit, gitlinks);
      integrity.assertPullRequestBase(workspace, provider, projection);
      if (node.status === "commit-created") {
        runChecked(run, "git", ["push", "--set-upstream", provider.remoteName,
          `${commit}:refs/heads/${branch}`],
        { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        `cannot push delivery branch for '${repository.id}'`);
        node.status = "branch-pushed";
        node.provider = provider;
        checkpoint(delivery, "repositories-delivering");
      }
      let pullRequest = findPullRequest(provider, branch, provider.baseBranch);
      let url = pullRequest?.url || node.pullRequest?.url || null;
      if (!pullRequest) url = openPullRequest(provider, branch, narrative, body, draft,
        repositoryBodyPath(id, repository.id));
      pullRequest = verifyPullRequest(provider, url, commit);
      node.status = "verified";
      node.pullRequest = {
        provider: "github", repositoryId: repository.id, number: pullRequest.number,
        url: pullRequest.url, state: pullRequest.state, draft: Boolean(pullRequest.isDraft),
        headCommit: pullRequest.headRefOid, baseBranch: provider.baseBranch
      };
      checkpoint(delivery, "repositories-delivering");
      completed.set(repository.id, node);
    }

    const delivered = execution.filter((repository) =>
      delivery.repositories[repository.id]?.pullRequest);
    const pullRequests = delivered.map((repository) =>
      delivery.repositories[repository.id].pullRequest);
    const receipt = {
      version: DELIVERY_RECEIPT_SCHEMA_VERSION,
      changeId: id,
      archivedAt: lifecycle.archivedAt,
      multiRepository: true,
      pullRequests,
      repositories: Object.fromEntries(delivered.map((repository) => {
        const node = delivery.repositories[repository.id];
        return [repository.id, {
          commit: node.commit, branch: node.branch,
          projectionHash: stableHash(node.projection.entries),
          pullRequest: node.pullRequest
        }];
      })),
      verifiedAt: now()
    };
    writeJson(receiptPath(id), receipt);
    checkpoint(delivery, "verified", { receiptDigest: stableHash(receipt) });
    return deliveryEnvelope(id, "DONE", {
      completed: true, reached: "pr-opened", reused: false, pullRequests
    });
  }

  async function advance(id) {
    const lifecycle = loadRuntime(id);
    if (lifecycle.status !== "archived") return deliveryEnvelope(id, "ASK_USER", {
      completed: false,
      boundary: "land-authority",
      reason: "Deliver requires an archived change; decide whether to Land first.",
      options: ["authorize-land-and-continue", "leave-change-pending"]
    });
    let delivery = loadDelivery(id);
    try {
      const policy = deliveryPolicy(foundationPolicy());
      const repositories = archivedRepositories(id, lifecycle);
      const priorReceipt = existingReceipt(id, lifecycle);
      if (priorReceipt?.multiRepository) {
        const byId = new Map(repositories.map((repository) => [repository.id, repository]));
        const pullRequests = [];
        for (const [repositoryId, record] of Object.entries(priorReceipt.repositories || {})) {
          const repository = byId.get(repositoryId);
          if (!repository)
            throw new Error(`delivered repository '${repositoryId}' is no longer selected`);
          const provider = providerContext(policy, repository.path);
          const verified = verifyPullRequest(provider, record.pullRequest.url, record.commit);
          pullRequests.push({ ...record.pullRequest, ...verified, repositoryId });
        }
        return deliveryEnvelope(id, "DONE", {
          completed: true, reached: "pr-opened", reused: true, pullRequests
        });
      }
      if (repositories.length > 1 || repositories.some((row) => row.id !== "root"))
        return await advanceMulti(id, lifecycle, delivery, policy, repositories);
      const provider = providerContext(policy);
      if (priorReceipt) {
        const verified = verifyPullRequest(provider, priorReceipt.pullRequest.url, priorReceipt.commit);
        return deliveryEnvelope(id, "DONE", {
          completed: true, reached: "pr-opened", reused: true,
          pullRequests: [{ ...priorReceipt.pullRequest, ...verified }]
        });
      }
      if (delivery.status === "new") checkpoint(delivery, "requested", {
        requestedAt: now(), authority: {
          kind: "explicit-deliver-command",
          allowed: ["create-feature-branch", "stage-proven-projection", "commit", "push-feature-branch", "open-or-update-pr"],
          forbidden: ["force-push", "push-default-branch", "merge", "deploy", "publish"]
        }
      });
      const projection = delivery.projection || deliveryProjection({
        root, state: lifecycle, readJson, transactionJournalPath, pathIdentity
      });
      const binding = {
        archivedAt: lifecycle.archivedAt,
        proofRunId: lifecycle.land?.proofRunId || null,
        preArchiveWorkspaceHash: lifecycle.preArchiveWorkspaceHash || null,
        sourceProjectionHash: projection.sourceProjectionHash,
        targetHead: projection.baseHead
      };
      const bindingDigest = stableHash(binding);
      if (delivery.bindingDigest && delivery.bindingDigest !== bindingDigest)
        throw new Error("delivery binding changed after preparation");
      if (!["workspace-prepared", "commit-created", "branch-pushed", "pr-opened"].includes(delivery.status))
        delivery = checkpoint(delivery, "binding-verified", { binding, bindingDigest, projection });
      const sources = archivedSources(id, lifecycle);
      const proof = readJson(proofPath(id), {});
      const narrative = delivery.narrative || pullRequestNarrative({
        changeId: id, state: lifecycle, ...sources, proof,
        paths: projection.entries.map((entry) => entry.path)
      });
      const evidence = deliveryEvidenceAssessment({
        root, lifecycle, proof, narrative, readJson
      });
      if (!evidence.requiredComplete && policy.missingRequiredEvidence === "block") {
        const error = new Error(`required delivery evidence is incomplete: ${
          evidence.requiredIssues.join("; ")}`);
        error.code = "DELIVERY_EVIDENCE_BLOCKED";
        throw error;
      }
      narrative.quality = evidence.quality;
      narrative.presentationEvidence = {
        complete: evidence.presentationComplete,
        issue: evidence.presentationIssue
      };
      const draft = !evidence.presentationComplete &&
        policy.missingPresentationEvidence === "draft";
      const body = renderPullRequestBody(narrative, { draft });
      if (containsSecretMaterial(body)) throw new Error("generated pull-request body appears to contain secret material");
      const branch = delivery.branch || deliveryBranchName(policy.branchPattern, id);
      if (branch === provider.baseBranch) {
        const error = new Error(`delivery branch '${branch}' is the default branch`);
        error.code = "DELIVERY_DEFAULT_BRANCH_FORBIDDEN";
        throw error;
      }
      let workspace = delivery.workspace;
      if (!workspace || !existsSync(workspace)) {
        workspace = prepareWorkspace(id, delivery, projection, branch);
        delivery = checkpoint(delivery, "workspace-prepared", { workspace, branch, narrative, draft });
      }
      let commit = delivery.commit;
      if (!commit) {
        const recovered = recoverCommit(workspace, projection);
        if (recovered) {
          commit = recovered.commit;
          delivery = checkpoint(delivery, "commit-created", recovered);
        } else {
          const stagedPaths = stageProjection(workspace, projection);
          commit = createCommit(workspace, narrative.title);
          delivery = checkpoint(delivery, "commit-created", { commit, stagedPaths });
        }
      } else {
        const observed = gitOutput(git, ["rev-parse", "HEAD"], workspace,
          "cannot verify delivery commit");
        if (observed !== commit) throw new Error("delivery workspace commit changed after checkpoint");
      }
      integrity.assertTree(workspace, projection, commit);
      integrity.assertPullRequestBase(workspace, provider, projection);
      if (delivery.status === "commit-created") {
        runChecked(run, "git", ["push", "--set-upstream", provider.remoteName,
          `${commit}:refs/heads/${branch}`],
        { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, "cannot push delivery branch");
        delivery = checkpoint(delivery, "branch-pushed", { pushedAt: now(), provider });
      }
      let pullRequest = findPullRequest(provider, branch, provider.baseBranch);
      let url = pullRequest?.url || delivery.pullRequest?.url || null;
      if (!pullRequest) url = openPullRequest(provider, branch, narrative, body, draft);
      pullRequest = verifyPullRequest(provider, url, commit);
      delivery = checkpoint(delivery, "pr-opened", { pullRequest });
      const receipt = {
        version: DELIVERY_RECEIPT_SCHEMA_VERSION,
        changeId: id,
        archivedAt: lifecycle.archivedAt,
        bindingDigest,
        projectionHash: stableHash(projection.entries),
        commit,
        branch,
        baseBranch: provider.baseBranch,
        pullRequest: {
          provider: "github",
          number: pullRequest.number,
          url: pullRequest.url,
          state: pullRequest.state,
          draft: Boolean(pullRequest.isDraft),
          headCommit: pullRequest.headRefOid
        },
        evidence: {
          requiredComplete: evidence.requiredComplete,
          presentationComplete: evidence.presentationComplete
        },
        quality: evidence.quality,
        verifiedAt: now()
      };
      writeJson(receiptPath(id), receipt);
      checkpoint(delivery, "verified", { receiptDigest: stableHash(receipt) });
      return deliveryEnvelope(id, "DONE", {
        completed: true, reached: "pr-opened", reused: false,
        pullRequests: [receipt.pullRequest]
      });
    } catch (error) {
      delivery.lastError = { message: error.message, code: error.code || "DELIVERY_FAILED", at: now() };
      saveDelivery(delivery);
      mkdirSync(dirname(eventsPath(id)), { recursive: true });
      appendFileSync(eventsPath(id), `${JSON.stringify({
        version: 1, changeId: id, status: "failed", code: delivery.lastError.code,
        at: delivery.lastError.at
      })}\n`);
      if (["DELIVERY_PROJECTION_DRIFT", "DELIVERY_TARGET_MOVED", "DELIVERY_PR_BASE_DRIFT"].includes(error.code))
        return deliveryEnvelope(id, "ASK_USER", {
          completed: false, boundary: "content-identity", reason: error.message,
          options: ["create-a-new-change-for-the-current-content", "cancel-delivery"]
        });
      if (error.code === "DELIVERY_EVIDENCE_BLOCKED")
        return deliveryEnvelope(id, "ASK_USER", {
          completed: false, boundary: "required-evidence", reason: error.message,
          options: ["create-a-follow-up-change-with-required-evidence", "cancel-delivery"]
        });
      if (error.code === "DELIVERY_DEFAULT_BRANCH_FORBIDDEN")
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "delivery-policy", owner: "repository-operator",
          reason: error.message
        });
      if (/auth|credential|remote|GitHub|push|pull request/i.test(error.message))
        return deliveryEnvelope(id, "WAIT", {
          completed: false, boundary: "external-owner", owner: "repository-operator",
          reason: error.message
        });
      fail(error.message);
    }
  }

  async function showAdvance(id) {
    const value = await advance(id);
    console.log(JSON.stringify(value, null, 2));
    return value;
  }

  return { advance, showAdvance, statePath, receiptPath, bodyPath, eventsPath, workspacePath };
}
