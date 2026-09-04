# prove Specification

## Purpose
TBD - created by archiving change prove-readiness-fixit. Update Purpose after archive.
## Requirements
### Requirement: Changed-surface blocker carries a copy-pasteable fix

When proof readiness blocks because a repository changed files outside every
task's declared paths, the readiness output SHALL include a recovery
instruction containing the exact undeclared paths in `[paths:]` annotation
form, ready to append to the owning task in `tasks.md`.

#### Scenario: undeclared paths are rendered as a paste-ready annotation

- **WHEN** a multi-repository change has modified a file no task declares and
  proof readiness runs
- **THEN** the blocker names the repository and the offending paths, and the
  recovery section includes the same paths formatted as a `[paths:...]`
  annotation the agent can paste into `tasks.md`

#### Scenario: declared surfaces stay silent

- **WHEN** every changed file matches a declared task path
- **THEN** readiness reports no changed-surface blocker and no fix-it text

### Requirement: Build declares test files as they are created

The `/build` instruction SHALL direct that a newly created test file is added
to the owning task's `[paths:]` annotation in `tasks.md` in the same step that
creates the file.

#### Scenario: instruction present

- **WHEN** the shipped `/build` command text is read
- **THEN** it states that new test files are declared in the ledger when they
  are created, before Prove runs

### Requirement: Rejected review becomes bounded repair work

The proof controller SHALL derive machine-owned repair nodes from current in-contract blocker and major findings, bind them to the source attempt, workspace, claims, paths, and verification cases, and SHALL reject deterministic closure until an authorized changed workspace and current evidence close every required finding.

#### Scenario: Current review rejects the workspace

- **WHEN** a delivered current review contains blocker or major findings inside the locked contract
- **THEN** Proof returns one dependency-ordered repair graph and bounded host action
- **AND** does not ask the user to make a product decision

#### Scenario: Repair would change the agreement

- **WHEN** a finding requires a behavior, security, data, or rollout choice outside the locked contract
- **THEN** Proof returns `CONTRACT_DECISION_REQUIRED` and preserves the repair state

#### Scenario: Repair result does not change the workspace

- **WHEN** a host reports a repair result but the bound workspace identity is unchanged
- **THEN** the finding cannot receive deterministic closure

### Requirement: Repair invalidates only soundly affected evidence

The proof controller SHALL explain each provider invalidation or reuse from its recorded input manifest and SHALL invalidate ambiguous scope rather than reuse possibly stale evidence.

#### Scenario: Repair changes one provider's complete input set

- **WHEN** a repair changes paths consumed by one provider but not another
- **THEN** Proof reruns the affected provider and reuses the unaffected valid receipt with a recorded reason

### Requirement: Repository proof surfaces share one base binding

Foundation SHALL derive changed-surface, composite snapshot, review-packet, and
provider-manifest repository bases from one mode-aware binding. A current
pre-isolation selection MAY use the observed source head; an isolated selection
SHALL require its recorded runtime base.

#### Scenario: current multi-repository selection has no runtime rows yet

- **WHEN** a change selects a non-root repository before isolation and `state.repositories` is absent
- **THEN** the repository snapshot remains composite and binds the selected source head instead of collapsing to a root-only snapshot

#### Scenario: isolated child base is absent

- **WHEN** an isolated selected child has no recorded runtime base or valid worktree
- **THEN** provider readiness reports infrastructure failure and no packet, manifest, receipt, or proof substitutes the live target head

#### Scenario: repository workspace is missing before snapshot hashing

- **WHEN** readiness observes a missing or foreign selected worktree that would make workspace hashing fail
- **THEN** it returns typed `INFRASTRUCTURE_ERROR` with `sandbox create <change> --all` before attempting the hash

#### Scenario: review and executable evidence observe the same base

- **WHEN** a repository-scoped review packet and provider manifest are built for one workspace
- **THEN** both report the same mode-aware repository base used by changed-surface identity
