# host-adapter Specification

## Purpose
TBD - created by archiving change align-host-adapter-capabilities-and-upgrades. Update Purpose after archive.
## Requirements
### Requirement: Host guard capabilities are reported truthfully

Foundation SHALL derive each supported host's live guard coverage from one canonical capability contract and SHALL distinguish full, partial, and unavailable prevention without claiming behavior the host cannot execute.

#### Scenario: Host without tool hooks

- **WHEN** the capability contract is inspected for Cursor or Codex
- **THEN** the result reports live guards as unavailable, names Land gates as final enforcement, and does not claim prevention parity

#### Scenario: Host with partial adapter coverage

- **WHEN** the capability contract is inspected for OpenCode
- **THEN** the result identifies the live phase, secret, and lint guards and the unavailable session digest

#### Scenario: Native dispatch is available without live mutation guards

- **WHEN** a host supports the canonical native dispatch contract but exposes no tool-hook API
- **THEN** the capability result reports dispatch separately and still reports live mutation guards as unavailable

### Requirement: Host adapter upgrades converge owned command surfaces

Each host adapter SHALL record exact Foundation-owned adapter artifacts and SHALL remove a previously owned artifact that the current adapter no longer ships, while preserving every path not proven to be Foundation-owned.

#### Scenario: Foundation command is retired

- **WHEN** an adapter upgrade runs after a previously installed Foundation command or prompt is removed from the source
- **THEN** the retired owned artifact is removed and the adapter manifest converges to the current source

#### Scenario: User command shares the adapter directory

- **WHEN** an adapter upgrade runs beside a command or prompt absent from the Foundation ownership manifest
- **THEN** the user-owned artifact remains unchanged

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

