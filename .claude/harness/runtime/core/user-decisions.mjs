import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REVIEW_WINDOW_MS = 30 * 60 * 1000;

// Task write scope is agent-owned bookkeeping, like completion: readiness and
// apply repairs direct the agent to widen `[paths:]`, and Land still shows the
// user the real diff. Values may nest brackets (`app/[tenant]/**`), so the
// annotation ends at its balancing `]`.
function stripPathAnnotations(content) {
  let result = "";
  let from = 0;
  const lower = content.toLowerCase();
  while (true) {
    const start = lower.indexOf("[paths:", from);
    if (start === -1) return result + content.slice(from);
    let depth = 0;
    let end = -1;
    for (let i = start; i < content.length && end === -1; i += 1) {
      if (content[i] === "[") depth += 1;
      else if (content[i] === "]" && --depth === 0) end = i;
    }
    if (end === -1) return result + content.slice(from);
    result += content.slice(from, start).replace(/[ \t]+$/, "");
    from = end + 1;
  }
}

// Task completion and write scope are bookkeeping; editing task semantics
// still changes consent. `legacy` reproduces identities recorded before write
// scope became bookkeeping so in-flight approvals survive an upgrade.
export function agreementIdentity(root, id, { legacy = false } = {}) {
  const base = join(root, "openspec", "changes", id);
  const hash = createHash("sha256");
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Agreement symlink is not supported: ${name}`);
      if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`);
      else {
        let content = readFileSync(join(directory, entry.name), "utf8");
        if (name === "tasks.md") {
          content = content.replace(/^(\s*-\s*)\[[ xX]\]/gm, "$1[ ]");
          if (!legacy) content = stripPathAnnotations(content);
        }
        hash.update(name).update("\0").update(content).update("\0");
      }
    }
  }
  if (!existsSync(base)) throw new Error(`Agreement is missing: ${id}`);
  visit(base);
  return hash.digest("hex");
}

export function approvalMatches(identity, root, id) {
  return Boolean(identity) && (identity === agreementIdentity(root, id) ||
    identity === agreementIdentity(root, id, { legacy: true }));
}

export function userDecisionError(code, summary, options, recommended) {
  const error = new Error(summary);
  error.code = code;
  error.owner = "user";
  error.boundary = code.toLowerCase().replaceAll("_", "-");
  error.decision = { kind: error.boundary, summary, options, recommended };
  return error;
}

export function assertSpecApproval(root, id, state, { workspace = true } = {}) {
  // Legacy primitive-created/in-flight agreements retain their compatibility route.
  if (!state.specApproval?.required || state.status === "archived") return;
  const hasWorkspaceAgreement = state.workspace?.path && state.workspace.path !== root &&
    existsSync(join(state.workspace.path, "openspec", "changes", id));
  const workspaceAgreement = workspace && hasWorkspaceAgreement;
  const revisionMatches = state.specApproval.revision === Number(state.contractRevision || 0);
  const approved = state.specApproval.identity;
  const rootApproved = approvalMatches(approved, root, id);
  // The same content under the current identity is the same consent, so a
  // pre-upgrade approval of the target also covers a bookkeeping-only sandbox.
  const workspaceApproved = hasWorkspaceAgreement &&
    (approvalMatches(approved, state.workspace.path, id) || rootApproved &&
      agreementIdentity(root, id) === agreementIdentity(state.workspace.path, id));
  if (revisionMatches && rootApproved && (!workspaceAgreement || workspaceApproved)) return;
  // A harness-owned semantic amendment is written to the isolated packet and
  // reaches the target only through Land. Its post-amendment approval therefore
  // has a legitimate workspace-only identity at the matching amendment revision.
  const currentAmendment = (state.amendments || []).some((entry) =>
    Number(entry?.revision) === Number(state.contractRevision || 0));
  if (revisionMatches && currentAmendment && workspaceApproved) return;
  // Without an amendment the target packet is canonical, so an isolated packet
  // that differs from it can never be approved: recording consent binds one
  // identity that cannot equal both. That is agent-owned repair, never a user
  // decision or a user-run copy between checkouts.
  if (workspaceAgreement && !currentAmendment &&
      agreementIdentity(root, id) !== agreementIdentity(state.workspace.path, id))
    throw agreementDriftError(id, state.workspace.path);
  throw userDecisionError("SPEC_APPROVAL_REQUIRED",
    "Inspect the compiled spec with the user and obtain approval before Build.", [
      { id: "approve", outcome: "Approve this exact spec, then begin Build",
        command: `claude-foundation change resolve ${id} --approve-spec --decision-ref <user-decision>` },
      { id: "revise", outcome: "Revise the spec before implementation" }
    ], "approve");
}

export function agreementDriftError(id, workspacePath) {
  const error = new Error(
    `isolated agreement for '${id}' at ${workspacePath}/openspec/changes/${id} was edited outside a ` +
    "semantic amendment and no longer matches the target packet. Checkbox and `[paths:]` " +
    "edits are bookkeeping; revert any other edit there and express semantic changes with " +
    `'claude-foundation change amend ${id} <amendment.json>'. Never ask the user to copy agreement files.`);
  error.code = "AGREEMENT_DRIFT";
  error.owner = "agent";
  error.boundary = "agreement-drift";
  return error;
}

export function reviewWindowRemaining(state, timestamp = Date.now()) {
  const window = state.reviewWindow;
  if (!window) return REVIEW_WINDOW_MS;
  const deadline = Date.parse(window.deadline);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.min(REVIEW_WINDOW_MS, deadline - timestamp));
}

export function reviewWindowError(id) {
  return userDecisionError("REVIEW_TIME_EXHAUSTED",
    "The shared 30-minute review window has ended. Report completed findings and unreviewed scope; no passing verdict is implied.", [
      { id: "continue", outcome: "Authorize another 30-minute review window",
        command: `claude-foundation change resolve ${id} --continue-review --decision-ref <user-decision>` },
      { id: "land", outcome: "Accept the remaining review risk explicitly and Land the current diff",
        command: `claude-foundation change waive ${id} --capability review --reason <remaining-risk> --decision-ref <user-decision>` },
      { id: "pause", outcome: "Preserve the work and pause" }
    ], "continue");
}

export function currentWaivers(state, workspaceHash) {
  return (state.waivers || []).filter((row) => !row.binding ||
    row.binding.workspaceHash === workspaceHash &&
    row.binding.contractRevision === Number(state.contractRevision || 0));
}
