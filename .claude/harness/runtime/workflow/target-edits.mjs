import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
export function targetEditIssues({ root, state, dirtyNow, landOutput = {} }) {
  if (!["worktree", "copy"].includes(state?.workspace?.mode)) return { issues: [], notices: [] };
  const snapshot = state.workspace.targetDirty || state.workspace.preexisting || {};
  const paths = targetEditPaths(snapshot, dirtyNow, landOutput);
  if (!paths.length) return { issues: [], notices: [] };
  const listed = paths.slice(0, 10).join(", ") + (paths.length > 10 ? ", ..." : "");
  const accepted = state.targetEditsAccepted?.digest === targetEditDigest(paths, dirtyNow);
  const audited = shellAuditCount(root, state.id);
  if (accepted || !audited) return {
    issues: [],
    notices: [`target checkout changed outside the sandbox since isolation (${
      accepted ? "accepted by user decision" : "no unverified shell mutation recorded"}): ${listed}`]
  };
  return {
    issues: [`TARGET_EDITED_OUTSIDE_SANDBOX: ${audited} unverified shell mutation(s) ran during ` +
      `this change and the target checkout changed outside the sandbox at: ${listed}. Move ` +
      `edits that belong to this change into ${state.workspace.path} and restore those target ` +
      "files, then rerun. If a listed file is the user's own work, ask the user and record it " +
      `with 'claude-foundation change resolve ${state.id} --accept-target-edits --decision-ref <user-decision>'`],
    notices: []
  };
}
