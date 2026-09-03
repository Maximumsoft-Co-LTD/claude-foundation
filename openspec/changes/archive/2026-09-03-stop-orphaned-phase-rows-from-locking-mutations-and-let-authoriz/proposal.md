# Change: Stop orphaned phase rows from locking mutations and let authorized Land delivery commits run

## Why

The phase mutation guard refuses work the agent is authorized to do, so the
loop hands it back to the user. Two independent defects produce that outcome.

1. `recordedPhaseContext` selects the newest row across **every**
   `.foundation/logs/<change>/phase-context.jsonl`, including changes the
   harness itself reports as `orphan-runtime` / `missing-active-change`. In
   this repository a leftover fixture change (`no-security-trigger`) wrote a
   `build` row with no isolated workspace; for the next twelve hours every
   `Edit`, `Write`, and mutating `Bash` in any session was blocked with
   "Build shell mutations require an isolated workspace", regardless of what
   the session was actually doing. The guard's own recovery text then tells the
   agent to "ask the user".

2. `shellMutationViolation` refuses every mutating shell command during Land
   unless `FOUNDATION_LAND_TRANSACTION=1`. That marker is set in-process by
   `executeApplyJournal` for the duration of the apply transaction and never
   reaches a host tool call, so an agent can never satisfy it. `land.md` and
   `WORKFLOW.md` both require the agent to commit and stage root pointers
   during Land under separate user authority, and `claude-foundation exec`
   cannot help because the guard blocks the outer `Bash` call before `exec`
   runs. The only remaining route is asking the user to type the command.

## What changes

- A phase row only governs when its change is still an active OpenSpec change.
  A row belonging to an archived, abandoned, deleted, or fixture change is
  ignored, and the guard falls back to the newest row that still has one.
- Land distinguishes delivery from tree mutation. `git commit` and `git push`
  run without the runtime transaction marker; every other mutating command —
  `git checkout`, `reset`, `clean`, `rm`, redirects, script runners — still
  requires it, and the refusal names the operations it refused.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** `.claude/hooks/phase-state.mjs`,
  `.claude/hooks/phase-guard-policy.mjs`, `.claude/hooks/phase-mutation-guard.md`
- **Security triggers:** none — the guard's fail-closed posture is preserved;
  both changes narrow a refusal that never matched a real policy boundary.

## Non-goals

- Changing `workspaceMutationDecision`. File writes during Land stay
  runtime-owned; only shell delivery is separated from tree mutation.
- Granting Land authority. Commit and push still require the user's explicit
  authorization through the Land command contract and the host permission
  prompt; this change only stops the guard from making that authority
  unusable.
- Cleaning the orphaned fixture runtimes already present in this repository.
