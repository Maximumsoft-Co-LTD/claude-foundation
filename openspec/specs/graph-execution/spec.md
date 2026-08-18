# graph-execution Specification

## Purpose
TBD - created by archiving change compile-graph-based-multi-repository-and-concurrent-change-execu. Update Purpose after archive.
## Requirements
### Requirement: The execution graph is derived and deterministic

Foundation SHALL compile a versioned execution graph from the selected
repositories, task ledger, evidence contract, execution providers, and Land
dependencies without making that graph an independently edited source of
truth. Identical authoritative inputs SHALL produce identical graph identity.

#### Scenario: derived-graph-contract

- **WHEN** a valid active change has no authored graph artifact
- **THEN** Build compiles its nodes and edges from the existing artifacts and
  requires no additional user-authored file; changing any authoritative task,
  repository, claim, provider, or Land dependency changes graph identity, and
  unknown references or dependency cycles are refused

### Requirement: Graph edges carry typed authority

Every executable edge SHALL bind its input and result to the graph revision,
plan digest, contract revision, repository workspace identity, active lease ID
and fencing generation, execution attempt, allowed path and resource scopes,
claim IDs, and versioned input/output schemas. Foundation SHALL reject a result
that does not match that authority.

#### Scenario: typed-edge-authority

- **WHEN** a worker result has an earlier graph, plan, contract, workspace,
  lease generation, or execution attempt identity, or names a repository,
  path, resource, claim, or output outside its edge contract
- **THEN** the result is rejected with the mismatched identity or scope named
  and no node, task, claim, or receipt advances

### Requirement: Producer and consumer contracts are compatible before dispatch

Every graph edge SHALL name a versioned producer output schema and consumer
input schema. Graph compilation SHALL deterministically verify their declared
compatibility before making the consumer dispatchable. A contract revision
SHALL invalidate only nodes whose inputs transitively depend on that contract.

#### Scenario: producer-consumer-contract-compatibility

- **WHEN** a producer output version is incompatible with the declared consumer
  input version
- **THEN** graph compilation or advancement blocks the consumer before dispatch,
  names the incompatible edge and versions, preserves independent nodes, and
  requires a compatible contract revision

### Requirement: One change fans out safely across repositories

A multi-repository change SHALL compile repository and task dependencies into
parallel-ready nodes. Explicit task dependencies SHALL retain their precise
meaning rather than acquiring unrelated coarse repository edges.

#### Scenario: multi-repository-graph

- **WHEN** an API task is followed by independent Web and Mobile tasks in
  different repositories and a required contract node joins their outputs
- **THEN** Web and Mobile appear in the same ready wave after the API task, and
  the contract node stays blocked until every required predecessor passes

### Requirement: Concurrent changes use scoped conflict keys

Foundation SHALL permit active changes to write the same repository
concurrently only when their declared path, contract, and shared-resource scopes
are provably disjoint. The complete canonically ordered key set SHALL be acquired
atomically or not at all, and every grant or takeover SHALL issue a newer fencing
generation. Ambiguous, missing, migration-wide, or repository-wide scope SHALL
acquire an exclusive repository key.

#### Scenario: scoped-concurrent-changes

- **WHEN** active changes request writable scope in one repository
- **THEN** disjoint path, contract, and resource scopes may lease concurrently;
  overlap or incomplete acquisition releases the attempted set and names the
  conflicting key and owner; missing or ambiguous scope acquires the exclusive
  repository key; and a late result from a prior owner or generation is refused

### Requirement: Observed writes remain within granted authority

Before accepting a node result or issuing node proof, Foundation SHALL derive
the actual changed paths from repository state and verify that every write is
covered by the node's current path, contract, resource, and repository lease.
Worker-reported paths SHALL NOT substitute for this observed delta.

#### Scenario: actual-write-authority

- **WHEN** a worker reports success within its packet scope but its worktree
  contains a changed path outside the granted scope
- **THEN** the result and proof are rejected, the unexpected path and governing
  conflict scope are named, and no dependent node becomes ready

### Requirement: Failure is contained to the dependent subgraph

A failed, stale, crashed, or rejected node SHALL block its dependent nodes but
SHALL NOT discard completed independent nodes or valid evidence outside the
affected dependency closure. Retry SHALL be bounded and SHALL use a fresh
scope-limited repair packet.

#### Scenario: failure-contained-repair

- **WHEN** API and Web nodes pass, Mobile fails, and integration depends on all
  three, and a repair is attempted
- **THEN** integration and Land remain blocked, API and Web stay preserved, the
  repair packet carries only Mobile authority, and invalidation expands beyond
  Mobile only if the repair changes a shared contract or global input

### Requirement: Aggregate graph proof remains the Land authority

Foundation SHALL distinguish node proof from aggregate graph proof. Land SHALL
require a fresh aggregate proof covering every required node and edge. A node
may be optional only when the locked change agreement declared it optional
before Build.

#### Scenario: aggregate-proof-gate

- **WHEN** any locked required node or edge lacks fresh valid proof, including
  when a worker attempts to mark it optional
- **THEN** aggregate proof remains blocked, the locked requirement is preserved,
  and no Land mutation is authorized

### Requirement: Multi-remote Land prepares before mutation

Before the first remote Land mutation, Foundation SHALL persist and validate a
read-only preparation snapshot covering every required repository, authorized
commit, required CI state, target head, aggregate proof, landing dependency,
and recovery disposition. Land SHALL advance through declared compatibility-safe
waves using the existing resumable saga and SHALL compare-and-swap revalidate
the applicable snapshot identities immediately before every wave mutation.

#### Scenario: prepared-resumable-land

- **WHEN** Land advances a multi-remote graph
- **THEN** any incomplete or drifted commit, CI, target head, proof, dependency,
  or recovery disposition prevents the next mutation; after a partial
  later-wave failure, the saga preserves completed state, blocks archive, and
  names the forward-fix or compensation disposition without claiming atomic
  rollback

### Requirement: The normal lifecycle UX remains stable

Users SHALL be able to investigate, create, build, prove, and land ordinary
changes through the existing lifecycle commands without authoring or invoking a graph. Graph
diagnostics SHALL be read-only, compact, and progressive: normal output remains
summary-first while failure output names the failed node, affected nodes,
preserved work, and one next lifecycle command.

#### Scenario: lifecycle-ux-compatibility

- **WHEN** a user advances either a small ordinary change or a complex change
  with one failed branch
- **THEN** `/investigate`, `/change`, `/build`, `/prove`, and `/land` retain
  their existing roles, the small change keeps its single-agent lifecycle with
  no mandatory graph step, and the complex failure identifies failed, affected,
  and preserved work and names the existing `/build` or `/prove` next action

### Requirement: Existing active changes upgrade additively

Existing valid active changes SHALL compile to graph contract v1 without
rewriting their OpenSpec packet, changing completed task meaning, or weakening
their evidence and Land requirements. Regenerable cached graph state MAY be
discarded and rebuilt during upgrade.

#### Scenario: active-change-additive-upgrade

- **WHEN** a project upgrades with an active multi-repository change and valid
  scoped receipts
- **THEN** the change compiles to graph v1, completed tasks and still-valid
  receipts remain reusable, and the normal next lifecycle command is unchanged
