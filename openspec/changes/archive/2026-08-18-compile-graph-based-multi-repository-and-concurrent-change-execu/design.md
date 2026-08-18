# Design

## Current state

- `agent-planning.mjs` builds task waves from `[depends:]`, repository
  `dependsOn`, `[paths:]`, and `[resources:]`. It detects cycles and permits
  path-disjoint tasks inside one change.
- `activeRepositoryConflicts` blocks two non-archived changes that select the
  same writable repository without considering task path or contract scope.
- `provider-scheduler.mjs` independently builds an evidence DAG and batches
  providers whose resources do not conflict.
- Repository sandboxes are isolated and their content hashes compose one proof
  identity. Repository-scoped providers preserve unrelated receipts.
- Multi-remote Land is already an ordered, resumable saga. It is intentionally
  non-atomic and currently begins from repository/commit state rather than a
  first-class prepare-all graph gate.
- The public lifecycle is stable and user-facing documentation promises compact
  task packets rather than a resident orchestrator.

## Decisions

- **Decision:** Compile a graph from authoritative artifacts; never make the
  runtime graph an independently edited source of truth.
  - **Why:** OpenSpec, `tasks.md`, repository manifests, and evidence contracts
    already own durable intent. A second editable model would drift.
  - **Rejected:** A hand-maintained `graph.yaml` that duplicates tasks and
    providers.

- **Decision:** Define a versioned graph contract with node identity, node kind,
  repository, path/contract/resource scopes, claim IDs, dependencies, required
  status, versioned input/output schemas, lease fencing generation, execution
  attempt, input digest, and owning lifecycle phase. Compilation refuses an edge
  whose producer output is incompatible with its consumer input.
  - **Why:** Typed and digest-bound edges make handoffs resumable and reject
    stale or cross-scope worker results.
  - **Rejected:** Free-form agent-to-agent messages as execution authority.

- **Decision:** Preserve the existing lifecycle commands and compile/advance
  the graph internally; expose graph inspection only as progressive disclosure.
  - **Why:** Simple changes should remain single-agent and require no graph
    vocabulary.
  - **Rejected:** Replacing `/build`, `/prove`, or `/land` with a mandatory graph
    command sequence.

- **Decision:** Use hierarchical conflict keys with conservative fallback:
  `repo:<id>`, `path:<repo>:<prefix>`, `contract:<id>`, and explicit shared
  resources. Acquire the canonically sorted complete key set atomically and
  issue a monotonically newer fencing generation on grant or takeover. Missing,
  glob-ambiguous, migration, or repository-wide scope takes the exclusive
  repository key.
  - **Why:** Disjoint changes gain concurrency while undeclared authority stays
    fail-closed.
  - **Rejected:** Optimistic parallelism followed only by Git conflict handling.

- **Decision:** Derive actual writes from the repository worktree delta and
  reconcile them with the complete granted scope before accepting a node result
  or proof.
  - **Why:** A worker result is not authoritative about which files it changed;
    concurrency safety must use observed repository state.
  - **Rejected:** Trusting only paths named by a worker result envelope.

- **Decision:** Treat failures as graph state transitions. A failed node blocks
  its dependents, independent nodes may finish, and only the affected dependency
  closure becomes stale after repair.
  - **Why:** Safety still belongs to aggregate proof, while recovery should not
    discard unrelated valid receipts.
  - **Rejected:** Whole-change reset on any failure, or partial Land with a
    failed required node.

- **Decision:** Split proof into node readiness plus an aggregate graph proof.
  Optional nodes are permitted only when the locked change contract declared
  them optional before Build.
  - **Why:** The aggregate remains the sole Land authority while node state
    explains preservation and repair.
  - **Rejected:** Agent-selected waivers or runtime downgrades from required to
    optional.

- **Decision:** Add a read-only Land preparation snapshot before remote mutation
  and execute only compatibility-safe waves through the existing saga. Recheck
  snapshot identities with compare-and-swap semantics immediately before every
  wave mutation.
  - **Why:** Every required repository, commit, CI result, proof, target head,
    and recovery disposition should be known before the first irreversible
    remote step.
  - **Rejected:** A false two-phase-commit or atomic-rollback claim across Git
    remotes.

## Compatibility and migration

Existing active changes compile to graph contract v1 from their current
artifacts without rewriting the change packet. A single repository with at most
two ordinary tasks continues to recommend one agent. Existing command forms and
receipt validation remain valid; new graph fields are additive and protocol
pins move only where serialized output changes.

The active `make-multi-repository-sandbox-sync-replay-every-writable-worktre`
change is not a behavioral prerequisite. Because it also changes composite
workspace identity and protocol pins, whichever change lands second must
integrate from the then-current target, retain both protocol changes, and run
the complete compatibility and cross-repository suites before Prove. The two
changes must not Build concurrently against overlapping runtime/protocol scopes.

Plans and graph snapshots are regenerable runtime output. Upgrade removes or
rebuilds incompatible cached graph state rather than migrating it as intent.
Rollback disables graph-based cross-change concurrency and returns to exclusive
repository conflicts; it does not alter OpenSpec changes or earned receipts.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A false-negative conflict lets changes race on one semantic surface | Conservative exclusive fallback, atomic hierarchical leases, adversarial overlap tests | test, compatibility |
| A false-positive conflict serializes safe work | Explain the exact conflict key and test disjoint path/contract cases | test |
| Repair reuses evidence that should be stale | Digest-bound edges and transitive invalidation tests across repo, contract, and integration nodes | test, review |
| Graph state diverges from OpenSpec or tasks | Graph is derived, fingerprinted, and rebuilt on every authoritative revision | test |
| A failed required node reaches Land | Aggregate graph proof is the only Land input; negative critical cases pin refusal | test, review |
| Multi-remote mutation begins from an incomplete set | Prepare-all snapshot checks every required repo, CI, target head, and recovery disposition | compatibility, review |
| Graph orchestration increases cost for small work | Preserve the existing single-agent heuristic and compact output budgets | test |
