# Change Loop roadmap

This roadmap describes the next product-development sequence after the current
backend simplification. It is a planning document, not a release claim or a
replacement for the lifecycle contract in [`WORKFLOW.md`](../WORKFLOW.md).
Current release readiness remains in
[`reports/user-scenario-release-status.md`](reports/user-scenario-release-status.md),
and rollout thresholds remain in
[`reports/rollout-operations.md`](reports/rollout-operations.md).

The target user outcome is to keep the existing workflow:

```text
Investigate? -> Change -> Build -> Prove -> Land -> archived
```

while making unattended and team operation safer, more portable across agent
hosts, and easier to inspect. Public command names and arguments remain stable
unless a separately accepted OpenSpec change explicitly authorizes a break.

## Product boundary

Change Loop remains a deterministic control plane around a native coding
agent. It will not become a model runner or replace the host's tool loop.

The roadmap therefore does not include:

- a Change Loop-owned `ToolLoopAgent`;
- a duplicate `read`, `grep`, `write`, or shell tool registry;
- implicit commit, push, publication, deployment, or pull-request authority;
- treating a Git worktree as a process-security sandbox;
- a mutable web surface that edits machine-owned proof or runtime JSON; or
- a generic extension hook that can silently weaken proof or authority policy.

## Current baseline

The current runtime already owns agreement validation, isolated workspaces,
task planning and leases, bounded packets, evidence collection, content-bound
receipts, budgets, authority handoffs, convergent repair, transactional Land,
and recoverable archive completion. The native host still owns model execution.

The existing sandbox protects workspace and apply integrity. It does not by
itself contain processes, network access, host secrets, or system commands; see
the canonical [sandbox safety contract](../WORKFLOW.md#sandbox-safety).

The repository also has a read-only dashboard projection and dashboard. A new
Web UI is not a prerequisite for the core lifecycle.

## Roadmap overview

| Order | Workstream | User outcome | Entry condition | Exit condition |
|---|---|---|---|---|
| 0 | Stabilize and release the current backend | Users receive a source-cohorted, rollout-observed baseline | Current implementation complete | Required deterministic, paid, packaging, dogfood, pilot, and production observation gates pass |
| 1 | Secure execution backends | Build and Prove can run inside an enforced process, network, secret, and resource boundary | Current baseline is reviewable and deterministic | Container backend passes isolation, recovery, proof-binding, and compatibility scenarios |
| 2 | Host enforcement parity | Safety claims remain truthful when users switch among supported agent hosts | Secure backend contract is stable | Every host either enforces live mutation policy or fails closed behind a proven equivalent boundary |
| 3 | Behavioral conformance | Host or model upgrades cannot silently degrade search, tool routing, questions, or verification reporting | Host capability identities are stable | Deterministic contracts and source/model-cohorted behavioral scenarios gate release |
| 4 | Remote sandbox lifecycle | Long-running remote work survives expiry and reconnect without duplicate resources or lost files | A remote provider and operating owner are selected | Snapshot, restore, expiry, reconciliation, cleanup, cost, and recovery scenarios pass |
| 5 | Versioned lifecycle events | Teams can connect audit and operations systems without forking the runtime | At least one real integration consumer exists | Versioned outbox events are retryable, redacted, ordered, and unable to bypass authority |
| 6 | Team Web UI, if justified | Reviewers and operators can inspect and act on shared work without using a terminal | Stable projection API plus demonstrated multi-user demand | UI actions call the same runtime commands and preserve identical validation and audit semantics |

## 0. Stabilize and release the current backend

Do not mix the next architecture changes into the current large backend patch.
First establish an immutable baseline and complete the release gates named by
the current [release status](reports/user-scenario-release-status.md).

Deliverables:

- authoritative deterministic suite and documentation consistency pass;
- frozen scenario sentinel pass;
- required independent paid scenario repeats from one immutable source cohort;
- retained aggregate and candidate reports;
- package, Homebrew, clean-install, and upgrade rehearsal;
- dogfood, pilot, rollback, and production observation evidence; and
- no generated state, benchmark output, temporary consumer, or secret in Git.

This stage changes release confidence, not the product contract. Paid runs and
promotion require explicit authority.

## 1. Secure execution backends

Introduce a versioned execution-backend contract without changing the public
phase commands. Keep the current workspace implementation as the compatible
default, then add a local container implementation. A remote implementation is
deferred to workstream 4.

### Contract

The backend must describe and enforce:

- workspace root, read-only mounts, and writable mounts;
- environment and secret allowlists;
- network mode and approved destinations;
- CPU, memory, disk, process, and wall-time limits;
- command execution, process-tree termination, status, stop, and cleanup;
- setup behavior and dependency-cache boundaries;
- attended and unattended capability;
- backend/provider identity, policy digest, and environment descriptor; and
- recovery semantics after host or runtime interruption.

The compiled execution contract, workspace snapshot, receipts, and proof must
bind the selected backend identity and security-policy digest. Evidence earned
under one boundary must not be reusable under a materially different boundary.

### Delivery slices

1. Extract a backend-neutral execution contract around existing workspace and
   provider command execution.
2. Add a diagnostic-only backend capability report to `doctor` and sandbox
   inspection.
3. Add a container backend with network disabled and no host credentials by
   default.
4. Route setup, Build commands, evidence providers, and cleanup through the
   backend.
5. Bind backend identity to receipts and proof freshness.
6. Add crash, timeout, path escape, network, secret, resource, and orphan
   cleanup regressions.

### Exit criteria

- The default workspace flow remains command-compatible.
- A container cannot write outside declared mounts.
- A denied network or secret request fails before the operation has an effect.
- Timeout terminates the complete child process tree.
- A crash or retry does not leak a live container or overwrite user work.
- Proof audit rejects a backend or policy identity mismatch.
- Unavailable isolation is reported as unavailable, never as passing.

## 2. Host enforcement parity

Make host-specific guarantees explicit and executable. The objective is not to
pretend every host exposes the same hooks; it is to deliver the same user-level
safety outcome or refuse the unsafe mode.

### Delivery slices

1. Version the host capability and attestation contract.
2. Probe capabilities at install and `doctor` time without treating detection
   as authorization.
3. Keep live hooks/plugins for hosts that support them.
4. Add a mutation or command broker for hosts that cannot intercept native
   writes, where the host can reliably route operations through it.
5. Require a signed, short-lived, single-use attestation for unattended
   operation behind an equivalent isolated boundary.
6. Add a host matrix covering structured writes, shell mutation, path escape,
   secret access, stale phase context, replayed attestations, and Land.

### Exit criteria

- Each advertised guarantee is backed by an executable scenario.
- Cursor and Codex no longer rely on final audit as if it were live prevention.
- A host without hooks or an equivalent boundary blocks unattended writes with
  an exact recovery route.
- Switching hosts cannot preserve an invalid capability or attestation cache.
- Install and upgrade preserve project-owned host configuration.

## 3. Behavioral conformance

Treat agent instructions, skills, packets, and tool descriptions as behavioral
APIs. Add coverage for failures that deterministic runtime unit tests cannot
observe.

### Required behaviors

- search before broad reads when relevant files are unknown;
- use a specialized operation instead of a general shell when available;
- report blocked commands as blocked rather than claiming success;
- distinguish failed, unavailable, inconclusive, and not-run checks;
- ask only when an unresolved decision changes behavior, risk, or authority;
- avoid a subagent when the runnable frontier has no parallel work;
- retain workspace, authority, and safety constraints after a fresh-session or
  compaction handoff;
- run discovered verification in dependency order; and
- report exact checks and claims scoped to the evidence actually obtained.

### Test layers

1. Deterministic golden tests for bounded instructions, packets, manifests, and
   host action envelopes.
2. Adversarial fixtures for ambiguous requests, tool-routing conflicts,
   blocked execution, unavailable providers, and context handoff.
3. Paid behavioral scenarios grouped by source, host, model, and instruction
   digest.
4. A release report that never lets an old model or prompt cohort satisfy the
   current candidate.

### Exit criteria

- Every required behavior has a failing-then-passing regression.
- A model or host change produces a new cohort rather than inheriting an old
  pass.
- Behavioral failure cannot be converted to deterministic proof success by a
  persuasive final response.

## 4. Remote sandbox lifecycle

Start this work only after selecting a provider, an operating owner, a cost
ceiling, and a real use case. Reuse the execution-backend contract rather than
adding provider logic to the workflow composition root.

The lifecycle should support:

```text
creating -> ready -> active -> hibernating -> hibernated
                         ^                     |
                         +------ restoring <---+

any live state -> stopping -> stopped
```

Required controls:

- hard expiry and inactivity windows are distinct;
- only user work, tool execution, or filesystem mutation counts as activity;
- health checks, billing reads, and reconnect probes do not reset inactivity;
- reconnected handles are probed before reuse;
- expiry and state used for control flow are fetched fresh from the provider;
- snapshot, restore, stop, and cleanup are idempotent;
- restore checks for an already-active sandbox before creating another;
- snapshots preserve filesystem state but do not claim to preserve processes,
  connections, or in-memory work;
- restore revalidates project revision, environment, setup, and proof inputs;
- the provider is authoritative and local/database state is a cache;
- polling survives process restarts without a server-local timer; and
- usage and cost remain measured or unavailable, never fabricated as zero.

Release requires failure injection for stale handles, stale expiry, duplicate
restore, double stop, workflow replay, state divergence, provider outage, and
orphan-resource cleanup.

## 5. Versioned lifecycle events

Add this only for a named integration consumer. Prefer an append-only outbox of
facts over arbitrary in-process callbacks.

Candidate events:

```text
change.validated
sandbox.created
build.blocked
proof.started
proof.completed
authority.requested
land.prepared
change.archived
```

Every event needs a schema version, stable event ID, change and revision
identity, timestamp, causal operation ID, redacted payload, and delivery state.
Retries must be idempotent and ordered within one change.

Observational subscribers may notify, index, or archive. They may not edit
runtime state, receipts, proof, journals, or authority. A future blocking policy
extension requires a separate explicit contract with deterministic ordering,
timeouts, provenance, and a fail-closed outcome. There will be no unrestricted
`modify: any` surface.

## 6. Surfaces and Web UI

A new Web UI is conditional, not a core requirement. Continue to treat the
native agent and CLI as the primary interactive surfaces. Evolve the existing
dashboard only from a stable, versioned, read-only projection.

### Near-term dashboard scope

- active changes and current lifecycle phase;
- typed blocker and exact resume route;
- task, proof, receipt, and evidence freshness;
- budget and measured usage availability;
- sandbox backend, health, activity, and expiry;
- authority and handoff queues; and
- archived lifecycle timeline.

### Preconditions for a team Web UI

Build a broader UI only when at least one of these is demonstrated:

- shared remote execution;
- reviewers or approvers who do not use the CLI;
- simultaneous operation across many changes or repositories; or
- an organizational audit queue that the existing dashboard cannot serve.

Mutating UI actions must call the same runtime commands as the CLI. The UI must
not write `.foundation` state directly. Every consequential action retains the
same validation, authority, decision reference, proof freshness, and audit
requirements regardless of surface.

### Exit criteria

- The projection is versioned and derived from canonical runtime state.
- A stale or partial projection cannot authorize an action.
- The UI distinguishes unavailable measurements from zero.
- Interrupted streams reconnect without starting duplicate work.
- Authorization and multi-user tenancy are complete before remote exposure.

## Sequencing and change boundaries

Use one OpenSpec change per workstream. Split secure execution into smaller
changes if its contract, local container backend, and proof binding cannot be
reviewed independently without a compatibility risk.

```text
current release baseline
    |
    +--> secure execution backend
            |
            +--> host enforcement parity
            |       |
            |       +--> behavioral conformance expansion
            |
            +--> remote sandbox lifecycle (conditional)
                        |
                        +--> lifecycle events (consumer-driven)
                                    |
                                    +--> team Web UI (conditional)
```

Do not begin a dependent workstream merely because its design is attractive.
Its entry condition and preceding exit criteria must be satisfied first.

## Verification and shipping impact

Each workstream must add deterministic regression coverage at its lowest
boundary and run the authoritative repository suite. Shipped runtime, protocol,
adapter, command, installer, or public-document changes also require their
matching protocol pin, upgrade coverage, installer ownership update, English
and Thai documentation alignment, and the full shipping checks described in
[`CLAUDE.md`](../CLAUDE.md) and [`RELEASING.md`](../RELEASING.md).

Paid behavioral, remote-provider, dogfood, pilot, or production scenarios are
separate release activities and require explicit authority. Their absence is a
truthful blocker, not a zero or a pass.

## Maintenance

- Update this file when workstream order, scope, entry conditions, or exit
  criteria change.
- Keep live release counts and dates out of this file; link to the current
  source-cohorted release status instead.
- Keep detailed lifecycle semantics in `WORKFLOW.md` and implementation
  details in the nearest runtime documentation.
- Move completed design decisions into canonical contracts and retain only a
  short outcome here.
- Do not mark a workstream complete until its exit criteria and required
  release evidence are satisfied.
