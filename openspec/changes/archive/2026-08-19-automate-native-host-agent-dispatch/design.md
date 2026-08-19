# Design

## Current state

- `agent-planning.mjs` deterministically compiles pending tasks into
  dependency/resource-safe groups and recommends `single-agent`,
  `planned-agents`, or `proof-ready`.
- `lease-runtime.mjs` atomically acquires hierarchical conflict keys, assigns a
  monotonic fencing generation, exposes active leases, validates actual writes
  on release, and persists accepted lease results.
- `packet-runtime.mjs` includes execution authority only after a lease exists.
- `/build` says that the host owns leases but does not define an idempotent
  dispatch loop. The harness intentionally does not invoke a model.

## Decisions

- **Decision:** Derive dispatch decisions from the current plan and active
  leases; do not persist a second scheduler state machine.
  - **Why:** Plans, task completion, and leases already own the authoritative
    state. A derived decision is naturally resumable and avoids a competing
    mutable queue.
  - **Rejected:** A separate `.foundation/dispatch/*.json` queue whose task
    states could diverge from `tasks.md` and lease results.

- **Decision:** Return one conservative action. Any unexpired active lease
  makes the decision `wait`; only a lease-free, dispatchable plan can return a
  new spawn group.
  - **Why:** A restarted host cannot prove whether a live worker is merely slow
    or abandoned. Waiting preserves at-most-one active authority per task.
  - **Rejected:** Filling unused concurrency slots beside workers from a prior
    host session, which requires host-liveness knowledge the harness lacks.

- **Decision:** Keep native spawning in the host and encode exact acquire,
  packet, and release commands for every recommended worker.
  - **Why:** Only the host owns its authenticated session, native team tools,
    cancellation, and parent context. The harness remains portable and
    deterministic.
  - **Rejected:** Spawning model CLIs from Node, which would duplicate auth,
    permissions, context, and lifecycle semantics.

- **Decision:** Use deterministic owner suggestions derived from graph revision
  and task ID; the acquired lease ID and fencing generation remain the final concurrency
  authority.
  - **Why:** Repeated dispatch calls produce the same instruction, while a
  later accepted/released attempt advances its lease identity through lease state.
  - **Rejected:** Random owner IDs that make retries indistinguishable and make
    snapshot tests unstable.

- **Decision:** Preserve the current single-agent heuristic and bounded task
  packet as the quality guardrail.
  - **Why:** Small or globally coupled work does not benefit from fan-out, and
    workers should receive durable task authority rather than conversational
    noise.
  - **Rejected:** Spawning whenever two checklist items exist.

## Compatibility and migration

The command and dispatch schema are additive. Existing `agents plan`, acquire,
packet, and release forms remain valid. No persisted intent or runtime state is
migrated because dispatch is derived. Rollback removes the command and restores
the former manual host loop without invalidating plans, leases, or results.

The runtime API and command registry pins move because the entrypoint/module and
public CLI surfaces gain a new operation.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A restarted host duplicates a live worker | Active lease always produces `wait`; deterministic restart tests | test |
| A spawn recommendation exceeds policy | Slice only the planner's ready group and assert the configured ceiling | test |
| Worker receives stale or excessive context | Acquire first, regenerate the leased bounded packet, never request parent transcript | test, review |
| A new command drifts across CLI/runtime phase tables | Extend single-source contract tests and runtime command registry | test |
| Parallelism reduces quality on small work | Preserve `single-agent` recommendation and parent-session action | test |
