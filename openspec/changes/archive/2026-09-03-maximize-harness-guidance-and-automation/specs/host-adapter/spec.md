# host-adapter

## ADDED Requirements

### Requirement: One coordinator projects the next safe host action

Foundation SHALL expose an additive high-level coordinator that evaluates the current lifecycle and returns one versioned machine action for implementation, repair, configured review, external wait, decision, local recovery, Land readiness, or completion. The core SHALL not invoke a model and SHALL preserve existing low-level commands.

#### Scenario: Runnable implementation or repair work exists

- **WHEN** the current graph has one safe runnable frontier
- **THEN** the coordinator returns its bounded task or repair packet and required result authority

#### Scenario: Configured review is ready

- **WHEN** executable evidence passes and a configured reviewer request is current
- **THEN** the coordinator returns a `RUN_CONFIGURED_REVIEW` action for the host
- **AND** does not execute the reviewer itself

#### Scenario: Coordinator reaches an authority boundary

- **WHEN** continuation requires a contract choice, waiver, budget grant, conflict resolution, commit, push, publish, or other external authority
- **THEN** the coordinator stops with a typed terminal action and exact resume route

#### Scenario: Safe progress continues

- **WHEN** a deterministic local step succeeds and progress identity changes
- **THEN** the host may call the coordinator again without interpreting prose or invoking a duplicate action

### Requirement: Host execution envelopes are idempotent handoffs

A host adapter SHALL be able to submit a validated execution envelope once at an action boundary, and Foundation SHALL deduplicate the envelope by stable execution identity while preserving unavailable dimensions.

#### Scenario: Host resubmits the same execution envelope

- **WHEN** the same validated dispatch or execution identity is delivered twice
- **THEN** usage and action completion are recorded once
