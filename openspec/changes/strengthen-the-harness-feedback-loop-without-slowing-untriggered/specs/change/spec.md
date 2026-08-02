## ADDED Requirements

### Requirement: Isolation truth is explicit

The system SHALL distinguish workspace isolation from execution-boundary evidence
and SHALL reject explicitly unattended Build unless a trusted host-owned
attestation establishes confinement. Virtualization detection alone SHALL NOT
authorize unattended execution.

#### Scenario: A worktree alone is not safe for unattended execution

- **WHEN** an operator inspects a change that has an isolated Git worktree but
  no detected or attested container or VM boundary
- **THEN** the result reports workspace isolation separately, reports the
  security boundary as unknown, and marks unattended execution unsafe

#### Scenario: Detected virtualization is not an authorization

- **WHEN** a container marker is detected without a trusted host-owned attestation
- **THEN** the result reports the boundary evidence but still marks unattended
  execution unsafe

#### Scenario: Ordinary interactive Build remains fast

- **WHEN** Build preflight is run without explicitly requesting unattended mode
- **THEN** it preserves the existing behavior and performs no model request or
  additional lifecycle phase

#### Scenario: Malformed unattended intent fails before side effects

- **WHEN** an unattended flag is empty, valued, duplicated, or reordered with a
  malformed duplicate
- **THEN** the command fails without telemetry, subprocess execution, workspace
  creation, or runtime-state mutation and never falls back to interactive allow

### Requirement: Prototyping is optional and disposable

The system SHALL provide a discoverable prototype command that compares a
bounded set of alternatives without editing product code or creating an
authoritative lifecycle artifact.

#### Scenario: Ambiguous direction is prototyped once

- **WHEN** a user explicitly requests a prototype for an experience, API, or
  architecture decision
- **THEN** the agent creates three to five comparable alternatives in one
  request under `.foundation/prototypes/<id>/` and records only the selected
  conclusion in the existing proposal or design

#### Scenario: Untriggered work pays no prototype cost

- **WHEN** a rapid or standard change does not request prototyping
- **THEN** no prototype request, artifact, packet field, or lifecycle state is
  created

#### Scenario: Disposable material cannot satisfy evidence

- **WHEN** an artifact or local reference resolves under the prototype root,
  including through traversal, file URI, or symlink
- **THEN** receipt recording fails atomically and no prototype content enters a
  receipt, evidence vault, or proof bundle

#### Scenario: Prototype handoff is explicit

- **WHEN** evidence or the user selects an alternative
- **THEN** the prototype writes `selection.md` and returns a fresh `/change`
  invocation naming that exact file without auto-discovering another prototype

### Requirement: Review is compact and attributable

The system SHALL provide a bounded reviewer packet and SHALL record reviewer
provenance sufficient to evaluate fresh-context and model-family diversity
without invoking a model itself.

#### Scenario: Independent review cannot reuse the implementation request

- **WHEN** a review policy requires fresh independent context
- **THEN** a receipt with missing identity or the same request lineage as the
  implementation is not accepted as satisfying review

#### Scenario: Critical review has an independent perspective

- **WHEN** security, migration, money, irreversible mutation, or a public
  contract requires diverse review
- **THEN** proof accepts a different model/provider family or a human reviewer
  and rejects same-family AI review

#### Scenario: Reviewer context stays bounded

- **WHEN** a large change emits a reviewer packet
- **THEN** the compact output contains scoped claims, decisions, risks, diff
  identity, and evidence summary without Build transcript replay and remains at
  or below 8 KiB

#### Scenario: Committed implementation remains reviewable

- **WHEN** implementation changes are committed after the recorded repository
  base and the worktree is otherwise clean
- **THEN** review policy and the reviewer packet include the committed paths
  together with any staged, unstaged, untracked, renamed, or deleted paths

#### Scenario: Critical evidence always receives review

- **WHEN** claims or changed-surface policy require security, migration, public
  compatibility, cross-repository, state-identity, monetary, or irreversible
  assurance
- **THEN** review is required and critical triggers require a human or a reviewer
  from a different provider or model family

### Requirement: Subjective acceptance is explicit and scoped

The system SHALL require durable human acceptance only when the change declares
a subjective product or experience decision.

#### Scenario: Experience-sensitive change requires acceptance

- **WHEN** a change is resolved as requiring human acceptance
- **THEN** Land remains blocked until an external acceptance receipt names the
  approver, observation, and durable artifact or reference

#### Scenario: Objective change does not wait for acceptance

- **WHEN** a change does not declare a subjective decision
- **THEN** acceptance is not required and no approval interaction is added

#### Scenario: Edited acceptance cannot be reused

- **WHEN** a recorded acceptance loses its human identity, explicit criteria,
  observation, provenance, claim scope, contract reason, workspace binding, or
  durable artifact/reference
- **THEN** it is invalid and cannot be copied into a new passing proof

### Requirement: Review convergence is monotonic and bounded

The system SHALL combine workspace-bound receipt invalidation and deterministic
finding status with a change-level monotonic attempt history so replaceable
receipts or provider names cannot reset convergence policy.

#### Scenario: A reviewed fix is reviewed only when stale

- **WHEN** a verified finding changes the reviewed workspace surface
- **THEN** the prior review becomes stale, a fresh scoped review is required,
  and work stops under the existing failed-attempt or budget limits

#### Scenario: Receipt deletion cannot reset AI attempts

- **WHEN** two AI review attempts have been recorded and the current receipt is
  deleted, moved, or replaced through another provider identity
- **THEN** a third AI attempt remains blocked, a human review remains available,
  and missing or corrupt attempt history fails closed
