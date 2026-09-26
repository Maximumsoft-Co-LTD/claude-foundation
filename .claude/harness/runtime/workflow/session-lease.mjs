import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A session-mode Build task runs in the coordinating session itself, one task
// at a time. The agent used to acquire the lease, implement, release it, and
// tick tasks.md for every task; only the tick carried a decision. `advance`
// now issues the lease with the task and, once the agent has ticked it,
// releases it on the next mutating `advance` with the same observed-write and
// scope checks. An unticked task is an interrupted one: resuming keeps its
// lease. Parallel groups keep explicit per-worker leases.
export const SESSION_OWNER_PREFIX = "session-";

export function sessionLeaseOwner(id, taskId, stableHash) {
  return `${SESSION_OWNER_PREFIX}${taskId.toLowerCase()}-${
    stableHash({ changeId: id, taskId, kind: "session-lease" }).slice(0, 12)}`;
}

export function isSessionOwner(owner) {
  return String(owner || "").startsWith(SESSION_OWNER_PREFIX);
}

// Whether the agent has marked exactly this task complete in the ledger.
export function taskLineChecked(content, taskId) {
  return new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*\\*{0,2}${taskId}\\*{0,2}\\b`, "m").test(content);
}

// The primitive's refusal names `agents acquire`; a harness-owned lease is
// renewed by resuming, so the repair names that route instead.
function sessionScopeError(id, detail) {
  const error = new Error(`${detail}. Revert edits that belong to another task, or add the ` +
    `paths to this task's [paths:] in the isolated openspec/changes/${id}/tasks.md ` +
    `(bookkeeping; no amendment or approval), then resume with ` +
    `'claude-foundation advance ${id} --through build'`);
  error.owner = "agent";
  error.boundary = "task-scope";
  return error;
}

export function createSessionLeaseRuntime({
  loadRuntime, activeChangeLeases, acquire, release, discard, stableHash
}) {
  function ledgerPath(id) {
    const state = loadRuntime(id);
    const base = state.workspace?.path || null;
    return base ? join(base, "openspec", "changes", id, "tasks.md") : null;
  }

  function checked(id, taskId) {
    const path = ledgerPath(id);
    return Boolean(path && existsSync(path) &&
      taskLineChecked(readFileSync(path, "utf8"), taskId));
  }

  // Releases every harness-issued session lease whose task the agent ticked.
  // A graph changed by a bookkeeping `[paths:]` widening is re-granted first:
  // the widening is the repair the scope refusal named, so it must not strand
  // the task behind a stale-authority error. A lease past its TTL is still
  // the harness's own: a long task must not skip its observed-write check.
  function settle(id) {
    const settled = [];
    for (const lease of activeChangeLeases(id, { includeExpired: true })) {
      if (!isSessionOwner(lease.owner) || !checked(id, lease.taskId)) continue;
      const flags = { owner: lease.owner, "lease-id": lease.leaseId };
      try {
        release(id, lease.taskId, flags, { quiet: true });
      } catch (error) {
        const message = String(error?.message || error);
        const scope = message.match(/^(task '[^']+' changed outside granted scope: [^;]+)/);
        if (scope) throw sessionScopeError(id, scope[1]);
        if (!/stale result authority|stale lease result/.test(message)) throw error;
        const renewed = acquire(id, lease.taskId, { owner: lease.owner }, { quiet: true });
        release(id, lease.taskId, { owner: lease.owner, "lease-id": renewed.leaseId },
          { quiet: true });
      }
      settled.push(lease.taskId);
    }
    return settled;
  }

  // Grants the single session task its lease and tells the agent the harness
  // owns it. Parallel groups and non-EDIT actions pass through unchanged.
  function issue(id, value) {
    // Only a leased session task: a single-agent plan never took leases.
    if (value?.action !== "EDIT" || value.execution?.mode !== "session" ||
        value.tasks?.length !== 1 || value.execution?.leases?.length !== 1) return value;
    const taskId = value.tasks[0].id;
    const owner = sessionLeaseOwner(id, taskId, stableHash);
    const granted = acquire(id, taskId, { owner }, { quiet: true });
    return {
      ...value,
      execution: {
        ...value.execution,
        leases: [],
        managedLease: { taskId, owner, leaseId: granted.leaseId, managedBy: "harness" }
      },
      instructions: [
        `Implement ${taskId} inside ${value.workspace} within its allowed paths.`,
        "Run its focused checks; do not acquire or release the lease.",
        `When the checks pass, mark ${taskId} [x] in the isolated tasks.md and run the resume ` +
        "command: advance releases the lease and checks the observed writes against the task scope.",
        "If a needed file is outside the task paths, add it to the task's [paths:] in the " +
        "isolated tasks.md before resuming."
      ]
    };
  }

  // An explicit lease primitive supersedes the harness-held one: the caller
  // took the task over, so the held lease is dropped without a completion.
  function yieldTo(id) {
    for (const lease of activeChangeLeases(id))
      if (isSessionOwner(lease.owner)) discard(id, lease.taskId, lease.owner);
  }

  return { settle, issue, yieldTo };
}
