# change Specification

## Purpose
TBD - created by archiving change keep-the-change-loop-from-losing-provider-config-and-dead-ending. Update Purpose after archive.
## Requirements
### Requirement: Workspace walks exclude regenerable output

The copy sandbox and the workspace baseline SHALL exclude paths git reports as
ignored, so that a repository carrying a large ignored build directory does not
copy or hash it.

#### Scenario: repository with a large ignored build directory

- **WHEN** `sandbox create` runs in a git repository whose `.gitignore`
  excludes a build directory
- **THEN** the sandbox copy omits that directory, and the recorded workspace
  baseline records no entry beneath it

### Requirement: A failed sandbox copy leaves no unrecorded tree

When a sandbox copy cannot complete, the runtime SHALL remove the partial tree
and report the failure, so that the next `sandbox create` is not blocked by an
occupied path the runtime never recorded.

#### Scenario: copy fails partway

- **WHEN** a sandbox copy fails after writing part of its tree
- **THEN** the sandbox directory does not remain, and the reported failure names
  the cause

### Requirement: Detected provider config survives sandbox synchronization

Provider configuration written by `evidence init --write` SHALL be stored in the
change's durable directory so that a later `sandbox sync` cannot destroy it, and
SHALL also be visible to an active sandbox without requiring a sync.

#### Scenario: init during Build then sync

- **WHEN** `evidence init --write` configures a provider while a sandbox is
  active, and `sandbox sync` then runs
- **THEN** the provider remains configured in both the durable change directory
  and the sandbox copy

### Requirement: Concurrent drafts preserve worktree isolation

`sandbox create` SHALL treat every uncommitted draft under `openspec/changes/`
as harness-owned state, so that an unrelated active change does not downgrade
workspace isolation to a full-tree copy.

#### Scenario: second change while a first draft is uncommitted

- **WHEN** a change draft already exists uncommitted under `openspec/changes/`
  and `sandbox create` runs for a different change in a clean git repository
- **THEN** the new sandbox is a git worktree, not an isolated copy

### Requirement: Rapid proposals validate against OpenSpec

The rapid proposal template SHALL use the section headers OpenSpec requires, so
that landing a rapid change emits no missing-section warning.

#### Scenario: rapid change validated

- **WHEN** a change is created from the rapid template and validated
- **THEN** validation reports no missing required proposal section

### Requirement: Orphan runtime state names its supported exit

The orphan-runtime diagnostic SHALL name the `change abandon` command rather
than instructing an operator to move runtime state files by hand.

#### Scenario: doctor reports an orphan

- **WHEN** `doctor` reports runtime state whose active change directory is gone
- **THEN** the reported next action names `change abandon`

### Requirement: The phase guard costs nothing when there is nothing to guard

The wired phase-mutation hook SHALL reach its no-op decision without starting a
JavaScript interpreter when guardrail mode is off, or when the mode is not
`block` and neither an exported active phase nor any recorded phase context
exists. In every other case it SHALL delegate to the guard.

#### Scenario: stock install with no active change

- **WHEN** a mutating tool call is made in a project with no active phase and no
  recorded phase context
- **THEN** the hook exits without a violation and without starting Node

#### Scenario: block mode with an unknown phase

- **WHEN** guardrail mode is `block` and no phase can be established
- **THEN** the hook delegates to the guard, which fails closed

#### Scenario: a recorded phase exists

- **WHEN** any recorded phase context is present
- **THEN** the hook delegates to the guard regardless of the context's age

### Requirement: Enforcement is unchanged through the prefilter

A mutation that violates the active phase's surface SHALL produce the same
violation through the wired hook as through the guard invoked directly.

#### Scenario: out-of-sandbox mutation during Build

- **WHEN** Build is the active phase and a mutation targets a path outside the
  isolated workspace and its declared paths
- **THEN** the violation is recorded, and in block mode the hook emits a block
  decision

### Requirement: Build command execution stays in the canonical workspace

Foundation SHALL run `exec` commands for a building change with the isolated
workspace as the process working directory and SHALL apply the same shell
mutation policy used by the live hook. The policy SHALL inspect literal
filesystem operands and later directory changes and SHALL compare canonical
targets so symlink traversal cannot escape the workspace. An explicit `exec`
phase SHALL match the lifecycle phase derived from runtime state.

#### Scenario: A command names an outside target

- **WHEN** a Build shell or `exec` command names an absolute outside operand,
  changes directory outside after its workspace anchor, or writes through an
  in-workspace symlink to an outside target
- **THEN** Foundation refuses the command before the mutation occurs

#### Scenario: A Build command uses a relative path

- **WHEN** `exec` runs a Build command that writes a relative path within the
  isolated workspace
- **THEN** the child process runs from the canonical workspace and the write
  remains there

#### Scenario: A caller labels Build execution as an impossible phase

- **WHEN** `exec --phase land` is requested while runtime state is `building`
- **THEN** Foundation refuses the phase mismatch instead of recording a false
  phase

### Requirement: An upgraded project runs one phase guard

Installing over a project whose settings wire a superseded phase-guard command
SHALL leave exactly one phase guard wired.

#### Scenario: upgrade over the previous wiring

- **WHEN** the installer merges hooks into settings that already wire the
  superseded guard command
- **THEN** the superseded command is removed and only the current one remains

### Requirement: The guardrail audit log is bounded

The guardrail audit log SHALL rotate at a size cap and retain one previous
generation, so that repeated appends cannot grow it without limit.

#### Scenario: appends exceed the cap

- **WHEN** appends carry the audit log past its size cap
- **THEN** the log is rotated to a single previous generation and a new log
  begins

### Requirement: A review response records without unsupported flags

A review response written from the emitted template SHALL record through
`authority record` without requiring any flag that command does not accept, and
the template SHALL carry the reviewer and implementation provenance the receipt
requires.

#### Scenario: recording a human review through the authority bridge

- **WHEN** a review response file carrying reviewer type and subject provenance
  is recorded against its request
- **THEN** the review receipt is written and no unsupported-flag error is raised

### Requirement: Declared change surface

The system SHALL let a change record the paths its author expects to touch,
before any of them exist, SHALL report them back, and SHALL treat the
declaration as optional.

#### Scenario: Declaring no surface changes nothing

- **WHEN** a change is resolved without `--surface`
- **THEN** no forecast is reported by any command and the existing
  changed-surface policy check is exactly as it was

### Requirement: Capability forecast from declared surface

The system SHALL apply the capability rules to a declared surface whose files
need not exist, SHALL name the declared path responsible for each forecast
capability, and SHALL forecast one declared surface identically in every
command that reports on it.

#### Scenario: Declared surface forecasts before files exist

- **WHEN** a change declares a `.tsx` path that has not been written and a
  lockfile-class path
- **THEN** `doctor --stage change` forecasts `accessibility` and
  `dependency-supply-chain` and names the declared path that pulls each

#### Scenario: A change packet pulls no capability

- **WHEN** a declared surface contains paths under `openspec/changes/`
- **THEN** those paths contribute no forecast capability, matching the rule
  already applied to the changed surface

### Requirement: The forecast is advisory and never enforcement

The system SHALL warn when a forecast capability has no provider in the
evidence contract, SHALL NOT fail the change for it, and SHALL continue to
derive required evidence from the real changed surface.

#### Scenario: Forecast gap warns without failing

- **WHEN** a forecast names a capability the contract declares no provider for
- **THEN** `doctor --stage change` reports it at warning level and
  `change validate` warns and still exits successfully

#### Scenario: Forecast never replaces enforcement

- **WHEN** a change declares a surface
- **THEN** the capabilities required at Prove are still derived from the real
  changed surface, unaffected by what was declared

### Requirement: Review consequence is forecast with the capabilities

The system SHALL state, at change time, whether the forecast capabilities will
require an independent reviewer and whether reviewer diversity will be
demanded, without altering the review policy that existing evidence is
fingerprinted against.

#### Scenario: Review consequence is stated at change time

- **WHEN** a declared surface forecasts a capability that forces review
- **THEN** `doctor --stage change` names both the required independent review
  and the required reviewer diversity before a signature is spent, and
  `reviewPolicy` returns the object it returned before this change

### Requirement: New capabilities use additive deltas

Foundation SHALL reject a standard change whose delta targets a capability
without a canonical specification and declares `MODIFIED Requirements` or
`REMOVED Requirements`, and SHALL identify `ADDED Requirements` as the valid
form before Build begins.

#### Scenario: A new capability declares a non-additive operation

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and the delta contains a `MODIFIED Requirements` or
  `REMOVED Requirements` section
- **THEN** validation fails, names the capability and offending operation, and
  instructs the author to use `ADDED Requirements`

#### Scenario: A new capability declares only additions

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and every requirement is under `ADDED Requirements`
- **THEN** the new-capability operation check passes

### Requirement: Change surface is tracked or declared

The workspace manifest and the relevant snapshot SHALL admit a path only when
git tracks it or the change declares it, so that an untracked path the change
never declared neither binds evidence nor reaches an apply projection.

#### Scenario: an undeclared untracked tree sits in the working tree

- **WHEN** the working tree carries an untracked directory outside every declared
  path, and `proof readiness` and an apply projection are computed
- **THEN** the workspace hash is unchanged by that directory, and no path beneath
  it appears in the projection

#### Scenario: the change creates a file it declares

- **WHEN** a change creates a new untracked file inside a declared path
- **THEN** the file is part of the workspace hash and lands with the change

#### Scenario: manifest and snapshot describe one surface

- **WHEN** the workspace manifest and the relevant snapshot are computed over the
  same tree
- **THEN** they admit the same set of paths

### Requirement: A projected deletion rests on sandbox evidence

An apply projection SHALL treat a path as deleted only when the path is inside
the declared surface and the sandbox reports it removed relative to the sandbox
base. Absence from a manifest SHALL NOT authorize removing a target path.

#### Scenario: a path is absent from the sandbox but was never removed there

- **WHEN** an apply projection would delete target paths that the sandbox never
  removed
- **THEN** the apply fails without changing the target, and the failure names the
  offending paths and their total count

#### Scenario: a declared file is deleted in the sandbox

- **WHEN** a change removes a file inside its declared paths and lands
- **THEN** the file is removed from the target

### Requirement: An apply reports its projection before running

The runtime SHALL report the projection as update, create and delete counts
before the transaction runs, so that a projection that does not match the change
is visible before any path changes.

#### Scenario: a projection is about to run

- **WHEN** an apply transaction begins
- **THEN** the reported output states how many paths it will update, create and
  delete

### Requirement: Land check performs no mutation

`land check` SHALL NOT resume, roll back, or otherwise alter a pending apply
transaction. When such a transaction exists it SHALL report the transaction
identity, its status, its update, create and delete counts, and the command that
performs recovery.

#### Scenario: a pending apply transaction exists

- **WHEN** `land check` runs while an apply transaction is pending, rolling back,
  or awaiting manual recovery
- **THEN** no path in the working tree changes, and the report names the
  transaction, its counts, and the recovery command

### Requirement: Apply recovery is explicit and authorized

Recovering an interrupted apply transaction SHALL require an explicit command
carrying a host decision reference.

#### Scenario: an operator recovers an interrupted apply

- **WHEN** recovery is requested without a decision reference
- **THEN** the command refuses and names the required reference

#### Scenario: recovery carries a decision reference

- **WHEN** recovery is requested with a decision reference
- **THEN** the recorded transaction is resumed or rolled back and the outcome is
  reported

### Requirement: One Decision Sheet grounds operated service boundaries

Before Build, Foundation SHALL require one locked Decision Sheet produced only
after complete relevant discovery. It SHALL include conditional production
entry, real wire, activation semantics, service interaction, and observability
rows. Discoverable facts SHALL be resolved from source; irrelevant rows SHALL
be recorded as sourced `N/A`; all unresolved material choices SHALL be asked in
the same user turn.

#### Scenario: A cross-service async change is grounded once

- **WHEN** a change publishes or consumes a cross-service message
- **THEN** the ledger records owner, producer, consumer, contract, delivery,
  timeout/retry, idempotency, ordering, consistency, rollout, rollback,
  correlation, operator question, SLI, alert and runbook decisions before Build

#### Scenario: A local non-runtime change avoids irrelevant questions

- **WHEN** repository evidence shows no operated or cross-service boundary
- **THEN** the same sheet records those sections `N/A` with source reasons and
  does not ask a second question batch

#### Scenario: Build discovers an in-contract defect or a missing operator permission

- **WHEN** implementation evidence exposes a defect already settled by the
  locked behavior, or an external operation needs authority the developer lacks
- **THEN** Foundation auto-repairs the defect or emits the declared handoff and
  does not open another user interview

#### Scenario: New evidence contradicts a locked material decision

- **WHEN** continuing would change behavior, compatibility, security, data, or
  rollout beyond the initial Decision Sheet
- **THEN** Foundation opens one audited batched amendment rather than asking
  piecemeal Build or Prove questions

### Requirement: Locked grounding remains content truthful

Foundation SHALL rehash immutable read-set inputs on every validation, resolve
production and failure paths inside selected repositories, and persist the
first grounding lock only after the complete change validates. A contradicted
lock SHALL use one audited reopen/replacement route.

#### Scenario: A requirement changes after grounding locks

- **WHEN** an immutable requirement or dependency input digest moves
- **THEN** validation reports the drift and cannot reuse the existing grounding
  lock or silently rewrite the decision ledger

### Requirement: A decision frontier feeds the finalized Decision Sheet

Foundation discovery SHALL model material user decisions as a private dependency
tree, resolve source-discoverable facts without asking the user, and expose only
decisions whose prerequisites are settled at the current frontier. Pre-lifecycle
brainstorming MAY traverse successive frontiers in rounds and SHALL hand off one
compact agreement. Feature and change intake SHALL reuse that agreement and
locked decisions, include conditional alternatives and their dependent effects
in the existing finalized Decision Sheet, and SHALL NOT create a parallel
decision-tree artifact or routine second interview.

#### Scenario: A dependent decision waits for its prerequisite

- **WHEN** a material decision depends on another answer that is not settled
- **THEN** pre-lifecycle brainstorming asks it only in a later frontier, while
  feature intake includes the dependency and conditional effects in its one
  finalized sheet

#### Scenario: A repository fact is discoverable

- **WHEN** specifications, code, tests, or the sandbox can settle a fact
  required by a decision
- **THEN** Foundation resolves and grounds that fact without asking the user

#### Scenario: Feature intake retains dependencies in one finalized sheet

- **WHEN** feature intake contains material choices with dependent effects
- **THEN** the finalized Decision Sheet presents their dependencies,
  alternatives, and effects without starting a successive-round interview

#### Scenario: A prior compact agreement reaches change intake

- **WHEN** brainstorming has settled every material decision and handed off its
  compact agreement
- **THEN** feature or change intake reuses its answers and records them in the
  existing change packet without a routine second interview or parallel ledger

### Requirement: Standard design preserves canonical domain language and durable rationale

The system SHALL capture resolved project-specific language and qualifying
durable tradeoffs inside the existing standard OpenSpec design without
introducing a parallel glossary, ADR ledger, or lifecycle.

#### Scenario: A standard packet receives canonical domain language

- **WHEN** a new standard packet or a rapid-to-standard upgrade is generated
- **THEN** its existing `design.md` provides a concise domain-language section and durable-decision guidance

#### Scenario: A fuzzy project term is resolved against source

- **WHEN** feature discovery encounters ambiguous or conflicting project-specific terminology
- **THEN** the agent checks specifications and code, settles the canonical term with the user only when a semantic choice remains, and records the meaning and avoided aliases in `design.md`

#### Scenario: A durable tradeoff reaches the existing Decisions section

- **WHEN** a choice is hard to reverse, surprising without context, and selected among meaningful alternatives
- **THEN** the existing Decisions section records the choice, rationale, and rejected alternative without creating an ADR file

#### Scenario: Rapid and existing packets keep their lifecycle contract

- **WHEN** a rapid packet or a pre-existing standard packet without the new section is validated
- **THEN** validation remains compatible and no new artifact or migration is required

### Requirement: Recorded phase context ignores changes that are no longer active

The phase mutation guard SHALL derive its active phase only from a recorded
phase row whose change is still an active OpenSpec change. A row belonging to
a change with no `openspec/changes/<id>` directory SHALL be ignored, and the
newest remaining eligible row SHALL govern instead.

#### Scenario: An orphaned change's row does not govern the session

- **WHEN** the newest `phase-context.jsonl` row belongs to a change that has no
  `openspec/changes/<id>` directory, and an older fresh row belongs to an
  active change
- **THEN** the guard reports the active change's phase, not the orphaned one's

#### Scenario: Only orphaned rows leave no phase to enforce

- **WHEN** every fresh recorded phase row belongs to a change with no
  `openspec/changes/<id>` directory
- **THEN** the guard establishes no phase and does not block mutations in
  its default `auto` mode

#### Scenario: An active change's row still governs

- **WHEN** the newest fresh recorded phase row belongs to a change whose
  `openspec/changes/<id>` directory exists
- **THEN** the guard enforces that row's phase exactly as before

### Requirement: Active Land never infers host mutation authority

Every mutating shell command inspected during active Land SHALL require
`FOUNDATION_LAND_TRANSACTION=1`, including `git add`, `git commit`, and
`git push`. Only the recoverable runtime transaction SHALL set that marker.
Land lifecycle authority SHALL NOT imply commit, push, publication, or
destructive Git authority; those effects happen only after archive through the
project's separately authorized delivery process.

#### Scenario: A delivery command is attempted during active Land

- **WHEN** `git add … && git commit …`, `git push`, `git push --force`, or a
  branch deletion is inspected without the runtime transaction marker
- **THEN** the guard refuses the command without inferring delivery authority

#### Scenario: The runtime applies the proven projection

- **WHEN** the recoverable Land transaction runs a mutating child process with
  the runtime transaction marker
- **THEN** the guard permits the mutation to be governed by that transaction

#### Scenario: Delivery follows archived completion

- **WHEN** the change is archived and the user separately authorizes commit,
  push, publication, or a pull request
- **THEN** the completed lifecycle grants no authority itself and the project
  performs delivery through its normal process

### Requirement: One semantic draft compiles the change agreement

Foundation SHALL accept a compact semantic draft version 3 and derive stable
claim IDs, task IDs, task dependencies, claim coverage, provider wiring, and
OpenSpec delta documents without requiring the agent to duplicate those links.
The compiled OpenSpec packet remains the human-reviewable agreement and source
of truth; the input draft is not a parallel ledger.

#### Scenario: A compact draft becomes a linked packet

- **WHEN** requirements, observable scenarios, implementation outcomes, and
  evidence capabilities are supplied with stable semantic keys
- **THEN** the compiler writes a valid packet whose specs, tasks, claims, and
  providers use deterministic cross-ledger identifiers

#### Scenario: A modified requirement omits an existing scenario

- **WHEN** a semantic draft modifies a canonical requirement and names only a
  changed or new scenario
- **THEN** the compiler reads the canonical specification and includes every
  existing scenario in the complete modified delta before validation

#### Scenario: Optional concerns are absent

- **WHEN** a change has no durable design choice, material grounding decision,
  external operation, multi-repository scope, or custom execution wiring
- **THEN** the compiler uses virtual defaults and does not create empty
  `design.md`, `grounding.yaml`, `handoffs.yaml`, `repositories.yaml`, or
  `execution.yaml` placeholders

#### Scenario: Rich context is required

- **WHEN** the draft declares a diagram, selected prototype, or versioned API
  integration
- **THEN** the compiler requires a contained regular local file or an HTTPS
  source with a fixed version, records it in the existing OpenSpec design, and
  requires integration scenarios to cover both a successful and a failing
  outcome

#### Scenario: Rich context cannot escape or float

- **WHEN** a local reference is a directory or resolves through a symlink
  outside the project, or a remote integration uses a non-HTTPS scheme or a
  floating version alias
- **THEN** semantic draft validation refuses the reference before writing the
  compiled agreement

### Requirement: Active semantic agreements amend transactionally

Foundation SHALL apply one semantic amendment to an active version-3 agreement
as a validated transaction. It SHALL preserve completed task checkboxes and
manual Markdown sections, add only stable requirements and links, invalidate
the affected new claims, and restore both packet and runtime state if validation
fails.

#### Scenario: Build discovers new required behavior

- **WHEN** the agent submits one amendment that adds requirements and maps them
  to an existing or new implementation task
- **THEN** Foundation updates the same active change, increments its revisions,
  and returns the exact `advance` resume route

#### Scenario: The amended packet is invalid

- **WHEN** strict validation rejects the staged amendment
- **THEN** no partial file or revision remains installed and the prior active
  agreement is still resumable

#### Scenario: An amendment tries to redefine an existing task

- **WHEN** `updateTasks` supplies a replacement outcome or verification command
  for an existing task
- **THEN** validation refuses the silent replacement and instructs the agent to
  add a new task, preserving the original task's completed meaning
