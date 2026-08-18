# Change: Compile graph-based multi-repository and concurrent-change execution while preserving the existing lifecycle UX

## Why

Foundation already has a task DAG, an evidence-provider DAG, repository
topology, resource leases, composite proof identity, and an ordered
multi-repository Land saga. Those graphs are separate, however. The runtime
cannot show one end-to-end execution graph and blocks every active writer to
the same repository even when their
declared paths, contracts, and resources are disjoint.

This makes a failed task safe but expensive to recover: Prove and Land correctly
stop, yet an operator must correlate plans, receipts, repository state, and
blockers to discover which work can be preserved. The desired outcome is a
compiled, inspectable graph that contains failure propagation and enables safe
parallel work without changing the familiar `Investigate -> Change -> Build ->
Prove -> Land` user experience.

## What changes

- Compile existing OpenSpec, repository, task, evidence, and Land declarations
  into one versioned execution graph; the source artifacts remain authoritative.
- Give every node and edge versioned, digest-bound input/output contracts;
  validate producer/consumer schema compatibility before dispatch; and reject
  stale, unfenced, cross-workspace, or out-of-scope results and actual writes.
- Permit parallel work across repositories and across active changes when
  hierarchical path, contract, and shared-resource scopes are provably
  disjoint; acquire all keys atomically with fenced leases; and fall back to an
  exclusive repository lock when scope is absent or unsafe.
- Propagate failure, staleness, and repair only through dependent nodes, reuse
  unaffected evidence, and keep aggregate Prove and Land fail-closed whenever a
  required node or edge is not proven.
- Add a prepare-all Land gate and revalidated compatible landing waves before
  each mutation stage in the existing resumable multi-remote saga.
- Keep `/investigate`, `/change`, `/build`, `/prove`, and `/land` as the normal
  interface while adding compact graph diagnostics for complex work and
  failures.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** public CLI and packet contracts, task planning,
  repository topology, leases, evidence scheduling and reuse, proof readiness,
  multi-repository Land state, runtime protocol pins, tests, and documentation
- **Security triggers:** none; the change adds no credential, identity, or
  privilege boundary, but concurrency and remote Land correctness require
  fail-closed review

## Non-goals

- Replacing OpenSpec, `tasks.md`, evidence receipts, or repository manifests as
  sources of truth.
- Requiring users to draw, author, or maintain a graph for ordinary changes.
- Allowing a failed required node to bypass aggregate proof or Land.
- Claiming atomic commits, pushes, deployments, or rollback across remotes.
- Adding autonomous commit, push, PR, deployment, or infrastructure authority.
- Adding dependency edges between separate changes; this change permits safe
  concurrent changes but each change retains independent lifecycle authority.
- Building a code knowledge graph, GraphRAG store, or resident agent persona
  named Graph Engineer.
