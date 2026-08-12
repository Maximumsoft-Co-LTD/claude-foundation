# Change: confine the land projection and proof surface to the change's declared paths, and stop land check from resuming a pending apply

## Why

Land derives its apply projection from a whole-tree manifest diff, so a path the
change never declared and never touched can enter the transaction — as a
deletion. On 2026-08-12 a telemetry change landed a projection of 9 updates, 1
create and 6,509 deletions; every deletion was an undeclared file under a
nested repository sitting in the working tree. The only guard, `isolated-copy
conflict`, cannot fire for files that never changed at the target.

The same whole-tree surface expires evidence: unrelated working-tree drift
changes `relevantHash`, so a proven change reports `proof is stale` and must be
proven again although nothing it declared moved.

`land check` compounds both. It calls `recoverPendingApply`, so a command
documented as a readiness check resumes or rolls back an interrupted destructive
transaction with no authorization and no summary of what it is about to do.

## What changes

- The change surface is the union of git-tracked paths and the change's declared
  paths. Undeclared untracked paths enter neither the proof hash nor the apply
  projection.
- A deletion in an apply projection requires positive evidence from the sandbox.
  Absence from the sandbox manifest never authorizes removing a target path.
- `land check` performs no mutation. A pending, rolling-back, or
  manual-recovery apply transaction is reported with its counts and the named
  recovery command.
- `land recover` performs that recovery explicitly, under `--decision-ref`.
- Every apply prints its projection as update, create and delete counts before
  it runs.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** workspace manifest and snapshot, land apply projection,
  land check and recovery command surface, proof staleness
- **Security triggers:** none

## Non-goals

- Changing what proof binds evidence to, beyond the surface definition.
- Redesigning multi-repository Land, leases, or authority recording.
- Recovering the working tree from any past incident; that is operator work.
- Changing sandbox creation or synchronization semantics.
