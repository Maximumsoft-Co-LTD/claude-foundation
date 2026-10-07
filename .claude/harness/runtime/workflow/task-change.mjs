import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { behaviorChangingWork } from "../evidence/test-discrimination.mjs";
import { leasePathIsAllowed } from "./lease-runtime.mjs";
import { lightKind, packetWorkTypes } from "./validation/dev-document.mjs";

// Task kinds that observe or record rather than change behavior.
const NON_BEHAVIOR_TASK_KINDS = new Set(["inventory", "logs", "mechanical-docs", "verification"]);

// The change's work types as its compiled packet states them.
export function changeWorkTypes(changePath) {
  const read = (name) => {
    const path = join(changePath, name);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  return packetWorkTypes({
    design: read("design.md"), proposal: read("proposal.md"), tasks: read("tasks.md")
  });
}

// Why a task's passing verify does not complete it, or null. A
// behavior-changing task that declared paths and changed none of them did
// nothing; its verify passed on the original code. Refactor, docs, and chore
// work, task kinds that only observe, and tasks scoped only to docs or
// manifests keep verify-only completion.
export function taskChangeIssue({ workTypes, task, changedPaths }) {
  if (!behaviorChangingWork(workTypes) || !task) return null;
  const allowed = (task.paths || []).map(String).filter(Boolean);
  if (!allowed.length || NON_BEHAVIOR_TASK_KINDS.has(task.kind)) return null;
  if (allowed.every((scope) => ["docs", "chore"].includes(lightKind(scope)))) return null;
  if ((changedPaths || []).some((path) => leasePathIsAllowed(path, allowed))) return null;
  return `task ${task.id} completed with no change: its verify passed, but nothing changed in ` +
    `its declared paths (${allowed.join(", ")}), so the check passed on the original code. ` +
    "Implement the task's change in those paths, then resume.";
}
