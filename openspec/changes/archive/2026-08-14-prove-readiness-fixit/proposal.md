# Change: prove-readiness-fixit

## Why

The changed-surface guard blocks Prove when a repository changed files no task
declares, and its message already lists every offending path — but it stops
there. A consumer round (Hydra dashboard, 2026-08-14) hit this block 10 times,
more than any other command: each time the agent had to compose the `[paths:]`
additions to `tasks.md` by hand, retry, and discover the next gap. The guard is
correct; its recovery is needlessly expensive.

## What changes

- The `repository '<id>' changed outside task paths` blocker gains a
  copy-pasteable recovery instruction in the readiness `next` entries: the
  exact path list to append to the owning task's `[paths:]` annotation.
- `/build` instructs that a newly created test file is declared in the ledger
  the moment it exists, so the surface never drifts from the tasks in the
  first place.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime (`proof-readiness.mjs` recovery
  output), shipped instruction (`commands/build.md`), deterministic tests.
- **Security triggers:** none.

## Non-goals

- No change to what the guard blocks; single-repository changes keep their
  existing separate mechanisms (apply-time deletion guard, snapshot filter).
- No auto-editing of `tasks.md` — the ledger stays agent-written.
