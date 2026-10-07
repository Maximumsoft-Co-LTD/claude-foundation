import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { compositeRepositorySelection } from "../core/repository-binding.mjs";
import { assessSandbox, sandboxDescriptors } from "./sandbox-preservation.mjs";

// Land used to decide `archived` from what its own records said had been
// applied. A record is not the target: a repository whose delivery record read
// `applied-uncommitted` while its checkout still sat at the base commit was
// archived, and archive then deleted the only copy of the work. This check reads
// the target itself, per selected repository, after apply and before anything
// is archived or removed.

export const LAND_PROJECTION_MISSING = "LAND_PROJECTION_MISSING";

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

// An uninitialized submodule is an empty directory inside the superproject, so
// every Git command run there silently answers for the superproject instead.
export function targetBindingProblem(targetPath) {
  if (!targetPath) return "has no recorded target checkout";
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetPath, encoding: "utf8"
  });
  if (top.error || top.status !== 0)
    return `target '${targetPath}' is not a Git checkout`;
  if (canonical(top.stdout.trim()) !== canonical(targetPath))
    return `target '${targetPath}' is not its own Git repository (an uninitialized submodule resolves to its superproject '${top.stdout.trim()}')`;
  return null;
}

export function landedProjectionFindings({ root, id, state }) {
  const findings = [];
  for (const descriptor of sandboxDescriptors(root, id, state)) {
    if (descriptor.access === "read") continue;
    if (descriptor.kind === "repository") {
      const binding = targetBindingProblem(descriptor.targetPath);
      if (binding) {
        findings.push({ repositoryId: descriptor.repositoryId, reason: "target-binding",
          detail: binding, paths: [] });
        continue;
      }
    }
    const assessment = assessSandbox(descriptor);
    if (!assessment.inspected) {
      findings.push({ repositoryId: descriptor.repositoryId, reason: "uninspectable",
        detail: assessment.error, paths: [] });
      continue;
    }
    if (assessment.absent) continue;
    if (assessment.placeholders.length)
      findings.push({ repositoryId: descriptor.repositoryId, reason: "placeholder",
        detail: "written into the shared sandbox's placeholder for a nested repository, which no repository projection reads",
        paths: assessment.placeholders });
    // A copy sandbox also carries the target's own pre-existing dirty files;
    // its root projection is bound by the apply journal instead.
    if (descriptor.kind === "shared" && descriptor.mode === "copy") continue;
    if (assessment.unlanded.length)
      findings.push({ repositoryId: descriptor.repositoryId, reason: "not-landed",
        detail: "the proven sandbox content is not in the target checkout",
        paths: assessment.unlanded });
  }
  return findings;
}

export function landVerificationMessage(id, findings) {
  const lines = findings.map((finding) => {
    const paths = finding.paths.slice(0, 10).join(", ");
    return `  ${finding.repositoryId}: ${finding.detail}${paths ? `: ${paths}${
      finding.paths.length > 10 ? ", ..." : ""}` : ""}`;
  });
  return `Land did not deliver every selected repository; the change was not archived ` +
    `and no sandbox was removed:\n${lines.join("\n")}\n` +
    "Move work written into a shared-sandbox placeholder into that repository's sandbox " +
    "(.foundation/repository-sandboxes/<change>/<repository>), make the target checkout a " +
    "real repository where its binding is wrong, then resume with " +
    `'claude-foundation advance ${id} --through archived'.`;
}

// Composite selections only: a single-repository change is already bound by
// its apply journal's verified projection. The isolated runtime bindings are
// what this check reads, so they also decide whether it applies: an
// interrupted archive has already moved the packet the selection is read from.
export function assertLandedProjection({ root, id, state, fail }) {
  const bound = Object.keys(state?.repositories || {}).map((repositoryId) => ({ id: repositoryId }));
  if (!compositeRepositorySelection(bound)) return;
  const findings = landedProjectionFindings({ root, id, state });
  if (!findings.length) return;
  fail(landVerificationMessage(id, findings), 1, {
    owner: "agent", boundary: "land-verification", code: LAND_PROJECTION_MISSING
  });
}
