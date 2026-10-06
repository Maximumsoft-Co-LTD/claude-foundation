import {
  existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { shellDisplayArgument } from "../core/shell-mutation-policy.mjs";

// Shell mutations during Build are recorded rather than blocked, so the
// guarantee that Build never touches the target checkout moves here: Prove and
// Land compare the target's dirty files with the snapshot taken at isolation.
// Machine state and change packets are expected to change on the target.
const EXPECTED_PREFIXES = [".foundation/", "openspec/changes/", "openspec/investigations/"];

export function targetEditPaths(snapshot = {}, dirtyNow = {}, landOutput = {}) {
  return Object.keys(dirtyNow)
    .filter((path) => !EXPECTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => snapshot[path] !== dirtyNow[path])
    .filter((path) => landOutput[path] !== dirtyNow[path])
    .sort();
}

const UNAPPLIED_JOURNAL_STATUSES = new Set(["aborted", "rolling-back", "rolled-back"]);

// Target bytes this change's own Land Apply wrote, keyed by path. A target
// file equal to one of them is Land output, not an edit made outside the
// sandbox; any other content still counts.
export function landAppliedOutput(journals = []) {
  const output = {};
  for (const journal of journals) {
    if (!journal || UNAPPLIED_JOURNAL_STATUSES.has(journal.status)) continue;
    for (const entry of journal.entries || [])
      if (entry?.path && typeof entry.after === "string" && !entry.after.includes(":"))
        output[entry.path] = entry.after;
  }
  return output;
}

// Rows the phase guard wrote for this change when it let a shell mutation run
// unverified. Both audit generations are read; a missing log is no rows.
export function shellAuditCount(root, changeId) {
  let count = 0;
  for (const name of ["guardrail-audit.jsonl.1", "guardrail-audit.jsonl"]) {
    const path = join(root, ".foundation", "logs", name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes("shell-audit")) continue;
      try {
        const row = JSON.parse(line);
        if (row.outcome === "shell-audit" && row.changeId === changeId) count += 1;
      } catch {}
    }
  }
  return count;
}

export function targetEditDigest(paths, dirtyNow) {
  return paths.map((path) => `${path}\0${dirtyNow[path]}`).join("\n");
}

// Blocking only when this change ran unverified shell mutations: then the
// edits are plausibly the agent's and it repairs them. Otherwise they are the
// operator's concurrent work and only reported. A user decision recorded for
// the exact same edits clears the stop.
// `projectionPaths` (a function returning the paths Land would apply, or null
// when unknown) narrows the stop to edits Land could overwrite or that the
// change plausibly owns; an edit anywhere else is reported, never blocking.
export function targetEditIssues({ root, state, dirtyNow, landOutput = {}, projectionPaths = null }) {
  if (!["worktree", "copy"].includes(state?.workspace?.mode)) return { issues: [], notices: [] };
  const snapshot = state.workspace.targetDirty || state.workspace.preexisting || {};
  const paths = targetEditPaths(snapshot, dirtyNow, landOutput);
  if (!paths.length) return { issues: [], notices: [] };
  const list = (values) => values.slice(0, 10).join(", ") + (values.length > 10 ? ", ..." : "");
  const accepted = state.targetEditsAccepted?.digest === targetEditDigest(paths, dirtyNow);
  const audited = shellAuditCount(root, state.id);
  if (accepted || !audited) return {
    issues: [],
    notices: [`target checkout changed outside the sandbox since isolation (${
      accepted ? "accepted by user decision" : "no unverified shell mutation recorded"}): ${list(paths)}`]
  };
  let projection = null;
  try { projection = projectionPaths ? projectionPaths() : null; } catch { projection = null; }
  // Unknown projection fails closed: every edited path still counts.
  const inside = projection ? paths.filter((path) => projection.has(path)) : paths;
  const outside = paths.filter((path) => !inside.includes(path));
  const notices = outside.length ? [`target checkout changed outside the sandbox and outside ` +
    `this change's Land projection (reported only): ${list(outside)}`] : [];
  if (!inside.length) return { issues: [], notices };
  return {
    issues: [`TARGET_EDITED_OUTSIDE_SANDBOX: ${audited} unverified shell mutation(s) ran during ` +
      `this change and the target checkout changed outside the sandbox at: ${list(inside)}. Move ` +
      `edits that belong to this change into ${state.workspace.path} and restore those target ` +
      "files, then rerun. If a listed file is the user's own work, ask the user and record it " +
      `with 'claude-foundation change resolve ${state.id} --accept-target-edits --decision-ref <user-decision>'`],
    notices
  };
}

// Byproducts a build or test run regenerates. A tracked one changed on the
// target after isolation is a test run in the main checkout, not user work.
const GENERATED_ARTIFACT_PATTERNS = Object.freeze([
  /(^|\/)__pycache__\//, /\.py[co]$/, /\.class$/, /(^|\/)node_modules\/\.cache\//,
  /(^|\/)coverage\//, /(^|\/)\.pytest_cache\//, /(^|\/)\.nyc_output\//
]);

export function isGeneratedArtifactPath(path) {
  return GENERATED_ARTIFACT_PATTERNS.some((pattern) => pattern.test(String(path || "")));
}

// Restorable without a user decision only when the path is a generated
// artifact that was clean on the target when the sandbox was isolated.
export function restorableTargetPaths(paths, snapshot = {}) {
  return paths.filter((path) =>
    isGeneratedArtifactPath(path) && !Object.hasOwn(snapshot || {}, path));
}

export function parseRestoreTargetPaths(value) {
  return [...new Set(String(value ?? "").split(",").map((path) => path.trim())
    .filter(Boolean))].sort();
}

export function restoreTargetCommand(changeId, paths, decisionRef = null) {
  return `claude-foundation advance ${changeId} --through archived --restore-target ${
    shellDisplayArgument(paths.join(","))}${decisionRef ? ` --decision-ref ${decisionRef}` : ""}`;
}

// Land's stop for target edits its apply would overwrite. Regenerable
// artifacts get one harness-executed restore command; anything else is the
// user's call, with the same command offered only behind their decision.
export function targetConflictStop({ changeId, paths, snapshot = {}, cause }) {
  const listed = paths.slice(0, 10).join(", ") + (paths.length > 10 ? ", ..." : "");
  const restorable = restorableTargetPaths(paths, snapshot);
  if (restorable.length === paths.length) return {
    message: `${cause} at generated artifact(s) changed in the main checkout after isolation: ${
      listed}. Tests and checks run only in the sandbox. Restore them to the recorded base ` +
      `inside Land with '${restoreTargetCommand(changeId, paths)}'`,
    details: { owner: "agent", boundary: "target-conflict", code: "TARGET_ARTIFACT_CONFLICT" }
  };
  // Keeping the target edits destroys nothing, so it is the automatic route:
  // the agent carries each edit into the sandbox copy and Land applies the
  // merged file once it provably contains the edit. Land never commits.
  return {
    decision: {
      kind: "target-edit-conflict",
      summary: `${cause} at: ${listed} — the target edits are kept and carried into the sandbox ` +
        "before Land applies those paths.",
      paths,
      options: [
        { id: "keep-target", outcome: "Keep the target edits: the agent merges each one into the " +
          "sandbox copy of the same path, then " +
          `'claude-foundation advance ${changeId} --through archived' proves the merged files and lands them.` },
        { id: "restore-target", outcome: "Discard the target edits at the listed paths and land " +
          `the proven projection: '${restoreTargetCommand(changeId, paths, "<user-decision>")}'.` },
        { id: "pause", outcome: "Change nothing and leave both workspaces as they are." }
      ],
      recommended: "keep-target",
      automaticRecovery: "keep-target"
    },
    code: "target-edit-conflict"
  };
}

function workingBytes(path) {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return null;
  return stats.isFile() ? readFileSync(path) : undefined;
}

// Whether the sandbox copy already contains the target's uncommitted edit:
// merging base→target into the sandbox file is a clean no-op. Then applying
// the sandbox file over the target loses nothing the target holds. Anything
// else (binary, symlink, deletion, conflict) stays a conflict.
export function targetEditCarried({ root, sandboxPath, path, baseBytes, spawn = spawnSync }) {
  const target = workingBytes(join(root, path));
  const sandbox = workingBytes(join(sandboxPath, path));
  if (!target || !sandbox || baseBytes === undefined) return false;
  if (target.equals(sandbox)) return true;
  const scratch = mkdtempSync(join(tmpdir(), "foundation-carried-"));
  try {
    const files = ["sandbox", "base", "target"].map((name) => join(scratch, name));
    writeFileSync(files[0], sandbox);
    writeFileSync(files[1], baseBytes || Buffer.alloc(0));
    writeFileSync(files[2], target);
    const merged = spawn("git", ["merge-file", "-p", ...files], { maxBuffer: 64 * 1024 * 1024 });
    return merged.status === 0 && Buffer.isBuffer(merged.stdout) && merged.stdout.equals(sandbox);
  } catch {
    return false;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
