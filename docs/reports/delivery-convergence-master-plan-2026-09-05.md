# Delivery convergence master plan

**Status:** Implemented and verified
**Date:** 2026-09-05
**Scope:** Runtime, host integration, hooks, instructions, shipping, documentation,
and deterministic release verification

This plan records the implementation work needed to make Change Loop finish
software delivery reliably. The canonical lifecycle contract remains
[`WORKFLOW.md`](../../WORKFLOW.md); provider and receipt semantics remain in
[`EVIDENCE.md`](../../.claude/harness/EVIDENCE.md). This report tracks the gaps,
decisions, sequencing, and acceptance criteria without replacing those sources.

## Goal

Change Loop must carry a user's intent through Change, Build, Review, Prove, and
Land with the least necessary work, without exposing harness permissions or
internal commands to the user. Land applies the proven projection to every
selected target workspace, archives the change, and leaves the resulting diffs
uncommitted for the user to inspect and commit.

The normal user flow stays:

```text
/dev <intent>
/land <change>
```

Single-repository and multi-repository changes use the same public flow.

## Non-negotiable outcomes

- Public command names and arguments remain compatible.
- Normal use requires no new repository, permission, recovery, review, proof,
  or Land flags.
- Harness-owned work never becomes a user-run command.
- The user is asked only for product semantics, scope, trade-offs, or explicit
  authority for an external side effect.
- Build writes only in declared isolated workspaces.
- Tool preparation happens before a tool is needed and is reused by content
  identity.
- Review and Prove rerun only invalidated work.
- Automated repair has no fixed retry limit while its progress identity changes.
- A repeated no-progress boundary is allowed only after safe internal repair and
  fallback routes are exhausted.
- `/land` supplies Land authority once for the complete resumable transaction.
- Land applies uncommitted diffs to all selected writable target workspaces.
- Land never stages, commits, pushes, publishes, deploys, or opens a pull
  request.
- Git HEAD and index remain unchanged in every target repository.
- Existing unrelated user work is preserved.
- Delivery is complete only at `archived`; `proven` means ready for Land.
- Evidence, isolation, and authority remain fail-closed. Non-safety bookkeeping
  is reconstructable or fail-soft and cannot block delivery by itself.

## Simple public surface

The supported user commands remain `/change`, `/build`, `/prove`, `/land`,
`/dev`, and `/changes`. The normal host runtime entrypoint remains:

```text
claude-foundation advance <change> --through build|proven|archived
```

Low-level commands remain compatibility and diagnostic surfaces. Land grants,
proof cursors, review request IDs, repository graph digests, journals, provider
commands, and resume routes are internal data. They must not become required
user input.

User-facing lifecycle rendering has four states:

1. `WORKING` — internal work continues.
2. `NEEDS_DECISION` — one decision about the work is required.
3. `WAITING_EXTERNAL` — an identified external owner or resource is pending.
4. `DELIVERED` — every writable target contains the uncommitted delivery and the
   change is archived.

## Ownership contract

| Owner | Responsibilities |
|---|---|
| User | Intent, acceptance, semantic decisions, Land authority, final diff review, commits, and external side-effect authority |
| Agent | Product reasoning and implementation across source, tests, product documentation, compatibility, and in-scope repair |
| Harness | State, compilation, planning, tool preparation, isolation, routing, execution, evidence, invalidation, permissions integration, recovery, apply, and archive |
| External owner | Credentials, human verdicts, remote CI/services, and systems outside the harness execution boundary |

The decision rule is:

1. Deterministic from the compiled contract and already authorized: Harness.
2. Requires product or code judgment without changing the contract: Agent.
3. Changes behavior, scope, trade-off, or external authority: User.
4. Requires an unavailable outside system or owner: External owner.

Every lifecycle outcome must declare an owner. `EDIT` and product repair belong
to the Agent; preparation, configured review, proof execution, apply, and
archive belong to the Harness; `ASK_USER` requires an allowed work-decision
kind; `WAIT` requires an external owner and resume condition. Host permission
and harness configuration are never user decisions.

## Current release blockers

### Coordinator and outcome loss

- `advance --through` ignores operation return values and reconstructs state
  from lossy cursors.
- Generic exception mapping collapses product repair, decisions, conflicts,
  resources, and harness defects into one repair shape.
- Proof and Land decisions, routes, and recovery data can be suppressed or lost.
- Structured lifecycle boundaries can leave a non-zero process exit code,
  causing a host to treat progress as command failure and repeat it.

### Review and proof convergence

- Low-risk review promotion and the next-action attempt ceiling disagree.
- Exhausted reviewer infrastructure can remain requested and be dispatched
  repeatedly.
- Proof cursors do not preserve all decision and repair fields.
- A held proof lock can be observed and then invoked again.
- Preflight and budget decisions do not reach the coordinator intact.
- Identical Review or Prove inputs can be rerun without a valid invalidation.

### Permission and hooks

- The consumer host permission surface does not necessarily trust the stable
  Foundation lifecycle wrapper.
- The Stop hook converts a host permission denial into `ASK_USER` and permits
  the session to stop.
- Phase selection can use the newest active change instead of the current
  session's change.
- Mutation guarding models one workspace root and can false-block child
  repository workspaces.
- Stop inspection invokes a write-classified lifecycle operation.
- Hook recovery text can leak agent-only commands into user guidance.

### Tool readiness

- Full executable readiness is checked late, commonly at Prove.
- Evidence discovery identifies wiring but deliberately does not provision it.
- Sandbox setup failure can degrade to a warning and manual recovery guidance.
- Quiet validation can skip strict OpenSpec validation rather than only hiding
  output.
- Required runtime, provider, OpenSpec, telemetry, or service readiness may be
  discovered only at the final gate.

### Land and multi-repository delivery

- Land operations can return no structured outcome to the coordinator.
- Multi-repository planning can be printed and then lost by quiet composition.
- Current multi-remote state is oriented around explicit child commits and
  root gitlinks rather than default local uncommitted workspace delivery.
- Partial apply, target drift, read dependencies, submodules, and external
  repositories require one coherent resumable delivery model.

## Internal architecture

### LifecycleOutcome

Introduce one result contract carrying action, phase, owner, boundary,
repositories, decision, invalidation, recovery, resume, and progress identity.
The coordinator consumes the returned outcome before reading durable state.
Lifecycle boundaries use a successful transport exit; non-zero exits are
reserved for invalid invocation or unrecovered runtime corruption.

### CompositeWorkIdentity

Derive one identity from agreement revision, repository graph digest, selected
read/write modes, repository base heads, composite content, task state, provider
configuration, review state, receipts, and Land journal position. Reuse work
when its identity is unchanged and invalidate only graph descendants affected
by a changed input.

### ExecutionPreparationPlan

Compile a hidden preparation plan before Build and incrementally after actual
changed-surface discovery. It inventories only required repository runtimes,
lockfiles, scripts, providers, reviewers, services, ports, environment-variable
names, host capabilities, time, and cost.

Preparation uses existing repository commands first, provisions declared
dependencies inside isolated workspaces, caches by repository and lockfile
digest, prepares independent repositories in parallel, and performs readiness
smoke checks rather than early full proof. A setup failure is harness- or
agent-owned repair, not a manual user instruction. Global installation or a
technology-stack change is never inferred.

### OwnershipPolicy

Validate owner/action pairs and decision domains at the outcome boundary. Reject
user questions about shell permission, review invocation, proof commands,
machine-owned state, or harness configuration. Internal resume data stays in
the machine projection and is omitted by the user renderer.

### LandGrant

An exact `/land <change>` invocation produces an internal grant bound to the
session, change, agreement revision, proof identity, repository graph, and all
writable target roots. The grant is not a CLI argument. It survives safe resume
until archive, cannot authorize another change or target, and never includes
commit, push, publish, deploy, or pull-request authority.

### RepositoryDeliverySaga

Default multi-repository Land becomes a local workspace-uncommitted saga.
Prepare every writable target before the first mutation, then apply dependency
waves with durable checkpoints, compare-and-swap target validation, and safe
recovery. Repeating a completed node is forbidden. A rollback may restore only
harness-applied bytes that the user has not subsequently changed.

## Phase behavior

### Change

- The Agent states semantics once.
- The Harness compiles OpenSpec, stable links, repository selection, task and
  provider graphs, cross-repository contracts, and target scope.
- Deterministic schema and generated-document repair is automatic.
- Only unresolved product semantics become a user question.
- Unknown repositories, dependency cycles, writes assigned to read-only nodes,
  unsafe nested targets, and provider scope errors fail before Build.

### Prepare tools

- Detect required tools from the compiled tasks and evidence capabilities.
- Prefer repository-native scripts and declared providers.
- Provision only required dependencies in the relevant sandbox.
- Prepare repository-qualified services and shared-resource locks.
- Reuse a valid preparation record; do not rediscover or reinstall unchanged
  toolchains.
- If no existing proof route exists, add minimal project-local tooling as an
  Agent task when it is in scope. Ask the user only when choosing a new stack is
  a material product or project decision.

### Build

- The Harness schedules dependency-ready tasks and owns leases, repository
  capability, state, and result validation.
- The Agent edits only declared isolated paths.
- Plans with empty tasks or paths are invalid and regenerated internally.
- Findings are repaired in one dependency-ordered batch.
- Completed work is reused by input identity.
- Independent repositories and resources may execute concurrently.

### Review

- Use one routing calculation for dispatch, next action, retry, and closure.
- The Harness creates a repository-aware initial or delta packet and runs a
  configured reviewer in the foreground.
- Requests transition explicitly through requested, running, delivered,
  external-wait, or failed states.
- Infrastructure exhaustion cannot remain dispatchable.
- A changed cross-repository contract invalidates affected consumer review;
  unrelated repositories are reused.
- Reviewer findings become a bounded Agent repair batch.

### Prove

- The Harness scopes providers and receipts to repositories and declared input
  dependencies.
- Independent providers run in parallel; shared databases, browsers, services,
  and write resources serialize.
- A held proof operation is reused or waited on rather than started again.
- Product failures produce Agent repair; the Harness calculates selective
  invalidation and reruns only affected providers.
- Route, decision, next action, invalidation, and repair plan survive durable
  cursor writes and process restarts.
- Missing tooling is prepared before final proof rather than exposed as a user
  command.

### Land

- The User supplies Land authority once with `/land`.
- The Harness verifies proof, graph, target, conflict, handoff, and preparation
  freshness for all repositories before writing the first target.
- Apply uses dependency waves and durable journal checkpoints.
- Mechanical in-contract repair belongs to the Agent; a semantic merge choice
  belongs to the User.
- Target-sensitive checks rerun only where applying to the live workspace
  invalidates prior evidence.
- OpenSpec sync and archive complete after every writable target is
  applied-uncommitted and verified.
- The Harness cleans isolated workspaces, not delivered target diffs.

## Repository topology behavior

| Topology/mode | Delivery behavior |
|---|---|
| Monorepo | One Git repository, path-scoped task and proof graph, one uncommitted apply |
| Root write repository | Apply the proven root projection without staging or committing |
| Sibling local write repository | Apply its projection to its declared target workspace |
| Writable submodule | Apply inside the child working tree; do not manufacture a child commit or gitlink SHA |
| Read-only repository | Keep isolated and content-bound for proof; never create a Land mutation node |
| External repository | Produce a durable handoff and wait only when the external delivery is contractually required |
| One selected non-root child | Still use repository-saga semantics; never infer root-only delivery from repository count |

For submodules, the parent naturally observes a changed child HEAD after the
user later commits the child. The Harness does not precompute a fake SHA. If a
product artifact truly requires a commit-derived identifier, that delivery
semantics decision must be settled before Land.

## Permission and hook design

- Trust only the stable lifecycle wrapper and bounded execution packets, not
  arbitrary shell or every Foundation command.
- Keep consumer local settings project-owned and merge-safe.
- Bind phase and change selection to the current session and invocation.
- Build capabilities list all selected isolated roots; Land capabilities list
  all granted target roots.
- Preserve secret protection, workspace containment, detached-reviewer
  prevention, and no-commit authority.
- Replace permission-as-user-boundary behavior with internal integration
  recovery.
- Make Stop status inspection read-only and side-effect free.
- Do not let Hook explanations become user instructions.

## Implementation work packages

- [x] P0 — Add failing characterization and public-surface contract tests.
- [x] P1 — Implement `LifecycleOutcome`, ownership validation, transport exit
  semantics, and progress identity.
- [x] P2 — Implement repository-aware `ExecutionPreparationPlan`, setup repair,
  cache reuse, early readiness, and strict quiet validation.
- [x] P3 — Implement scoped trusted execution, internal `LandGrant`,
  session/change-targeted Hooks, multi-root capabilities, and read-only Stop
  inspection.
- [x] P4 — Make Build planning and repair dependency-aware, non-empty, minimal,
  and reusable.
- [x] P5 — Unify Review routing and exhaustion semantics; implement true delta
  review across repository dependencies.
- [x] P6 — Preserve proof outcomes and implement lock reuse, selective
  cross-repository invalidation, budget/preflight integration, and normalized
  lifecycle exits.
- [x] P7 — Implement local workspace-uncommitted single- and multi-repository
  Land, prepare-all, dependency waves, resume, target conflict protection, and
  per-repository handoff summaries.
- [x] P8 — Implement four-state friendly rendering and hide all internal command
  and recovery data from normal user output.
- [x] P9 — Preserve active legacy multi-repository transactions, update wire
  protocols and command registry where required, and add clean-install/upgrade
  coverage.
- [x] P10 — Update canonical, English/Thai, maintainer, portable-agent, command,
  Hook, website, test, and release documentation.
- [x] P11 — Pass focused, affected, full, mutation, installer, upgrade, docs,
  website, and structural release-preflight verification. Publication readiness
  intentionally remains false until the user reviews and commits this diff.

## Documentation work package

Update the canonical contract first, then concise mirrors:

- `WORKFLOW.md` — ownership, preparation, convergence, permission boundaries,
  multi-repository uncommitted delivery, and completion semantics.
- `README.md` and `README.th.md` — simple `/dev` then `/land` behavior and
  friendly recovery, kept aligned.
- `.claude/harness/README.md` — runtime outcome, preparation, host integration,
  repository saga, and operator diagnostics.
- `.claude/harness/EVIDENCE.md` — readiness, repository-scoped providers,
  receipts, locks, and cross-repository invalidation.
- `.claude/hooks/README.md` — session targeting, multi-root capabilities, Stop
  semantics, and permission ownership.
- `.claude/orchestrator.md`, `.claude/harness/AGENT.md`, and lifecycle command
  files — the Agent never reconstructs or exposes internal command chains.
- `CLAUDE.md` — maintainer goal, simplicity and ownership contracts, tool
  preparation, permission/Hook rule, uncommitted multi-repository Land,
  shipping boundary, and required regressions.
- `AGENTS.md` — repository-wide delivery focus, ownership, minimal execution,
  multi-repository workspace rules, no user-run Harness work, no automatic Git
  delivery actions, and documentation/test obligations.
- Website docs in English and Thai — loop, Build, Prove, Land,
  multi-repository, CLI, installation, approval, and troubleshooting.
- `.claude/tests/README.md` — ownership of every new deterministic suite.

`CLAUDE.md` and `AGENTS.md` remain project-owned. Installer changes may update
only their bounded managed pointer blocks and must preserve consumer content.
Historical reports remain unchanged; this dated report and the reports index
carry current implementation status.

## Deterministic acceptance matrix

### Happy paths

- Single repository: one Build preparation, required Review/Proof once, one
  Land apply, archived, uncommitted diff.
- Multiple local repositories: repository-aware preparation and proof, one
  `/land`, all write targets applied-uncommitted, archived.
- Monorepo: path-scoped work without inventing repository boundaries.

### Repair paths

- Review finds a product bug, the Agent repairs it, and only the delta is
  reviewed and proven.
- One provider fails, the Agent repairs its cause, and only invalidated
  providers rerun.
- One repository setup fails and is repaired without recreating valid sibling
  workspaces.
- A transient reviewer/provider failure uses a configured fallback or resumes
  the same durable request.

### Error and edge paths

- Host permission denial never becomes a user question or user-run command.
- Multiple active changes use the current session's exact change.
- A held proof or authority lock does not create duplicate work.
- Dirty non-overlapping target files survive Land.
- Overlapping target edits preserve both sides and create a typed conflict.
- A crash after one repository apply resumes the remaining saga nodes without
  reapplying the completed node.
- Read-only dependency drift selectively invalidates composite proof.
- Submodule delivery remains uncommitted and does not create a child commit.
- An unavailable external repository, credential, or service creates an
  external-owner wait with preserved state.
- A legacy recorded-child-commit transaction upgrades and resumes without
  duplicate application.

Every scenario asserts zero internal permission prompts, zero user-facing
internal commands, no duplicate work on an unchanged input identity, unchanged
Git HEAD/index, preserved user work, and either `archived` or one legitimate
typed boundary.

## Mutation and release protection

Mutation tests must detect removal of the LandGrant guard, owner validation,
decision propagation, selective invalidation, prepare-all, session targeting,
read-only Stop inspection, conflict protection, and the no-stage/no-commit
invariant.

Wire-visible changes require the matching protocol pin and upgrade fixture.
New shipped files require `install.sh` ownership and clean-install coverage.
Consumer configuration and active `.foundation` state must survive upgrades.
English and Thai documentation must pass parity checks. Paid scenario evidence
remains a separate explicitly authorized release activity.

## Definition of done

This plan is complete only when:

1. `/dev <intent>` and `/land <change>` remain the complete normal user flow.
2. No required public CLI or permission step was added.
3. The Harness prepares and reuses required tools before execution.
4. Ownership is enforced at runtime and Harness work never reaches the user.
5. Permission and Hooks do not block a valid lifecycle path.
6. Build, Review, and Prove perform only identity-invalidated work.
7. Single- and multi-repository delivery reach `archived` through one Land
   authority.
8. Every writable target contains the intended uncommitted diff; every
   read-only target is unchanged.
9. Git HEAD, index, and remotes are unchanged by Land.
10. Existing user work is preserved and conflicts are explicit.
11. Canonical docs, English/Thai mirrors, website docs, command instructions,
    `CLAUDE.md`, and `AGENTS.md` describe the implemented behavior.
12. Focused, full, mutation, installer, upgrade, documentation, website, and
    structural release-preflight gates pass. The normal publication preflight
    must continue to report `source-tree-not-immutable` at this uncommitted
    handoff; clearing that gate belongs to the user's later commit workflow.

## Verification sequence

```text
focused unit and seam tests
→ affected suite
→ full deterministic suite
→ lifecycle and Land mutation suites
→ clean-install and active-state upgrade matrix
→ English/Thai documentation consistency
→ website documentation build
→ structural release preflight (publication remains gated on the user commit)
→ git diff --check
```

The implementation should proceed in P0–P11 order. A package is checked only
after its behavior, regression tests, and relevant documentation are complete.

## Completion evidence

Completed on 2026-09-05 with these deterministic results:

- Focused instruction, documentation, context-budget, and user-guidance
  contracts: 321 assertions passed.
- Installer and upgrade smoke matrix: passed, including additive permission
  merge and preservation of consumer-owned content.
- Full affected deterministic suite: exit code 0 across all selected shared
  suites and the final multi-repository topology contract.
- Lifecycle safety mutation: 23/23 mutations killed; phase mutation guard:
  80/80 assertions passed.
- Sandbox/Land contracts: 94/94; multi-repository planning contracts: 135/135.
- Website documentation: 37 English/Thai pages built successfully.
- Release preflight: every structural check passed. Publication readiness
  correctly reports only `source-tree-not-immutable` because delivery is an
  uncommitted workspace diff.
- `git diff --check`: passed.
