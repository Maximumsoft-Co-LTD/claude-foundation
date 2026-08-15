# runtime-observability Specification

## Purpose
TBD - created by archiving change make-telemetry-and-budget-reporting-truthful-when-host-usage-is-. Update Purpose after archive.
## Requirements
### Requirement: Usage measurement preserves unknown state

The system SHALL distinguish unavailable host usage from a measured numeric zero
in metrics and budget decisions.

#### Scenario: Unobserved host usage remains unknown

- **WHEN** lifecycle operations exist but no host telemetry event has been ingested
- **THEN** request and token usage are reported as unavailable and budget usage is
  not classified as measured

#### Scenario: An observed numeric zero remains measured

- **WHEN** a real host event reports zero for a nullable usage field
- **THEN** the field remains a measured zero rather than reverting to unavailable

### Requirement: Codex correlation does not synthesize usage

The system SHALL use an available Codex thread identity for correlation without
treating that identity as evidence of requests or tokens.

#### Scenario: Codex identity correlates records without inventing usage

- **WHEN** `CODEX_THREAD_ID` is available but no Codex usage event is imported
- **THEN** phase telemetry records that session identity while metrics and budget
  usage remain unavailable

### Requirement: Existing telemetry inputs remain compatible

The system SHALL retain the normalized event behavior of supported explicit
telemetry imports.

#### Scenario: Existing telemetry contracts remain compatible

- **WHEN** Claude, Codex, Cursor, OpenTelemetry, or generic telemetry is explicitly
  imported
- **THEN** the existing normalized fields, deduplication, and budget synchronization
  behavior remain supported

### Requirement: Proof transitions are serialized, fresh, and ordered

Every proof and authority mutation for one change SHALL use one recoverable
lease/CAS boundary. Proof validity SHALL compare the recorded relevant
workspace hash with the current hash. Capability order SHALL require review
before acceptance explicitly rather than relying on provider sort order.

#### Scenario: Two agents advance the same proof

- **WHEN** two processes attempt the same change transition concurrently
- **THEN** one owns the transition and the other observes or resumes it without
  duplicating a provider run, review dispatch, or receipt

#### Scenario: A valid proof becomes stale

- **WHEN** a relevant workspace input moves after a passing receipt
- **THEN** proof no longer reports valid and reruns only the affected evidence

### Requirement: External waiting is a one-shot handoff

A waiting external review or acceptance SHALL emit one stable request and stop.
Repeated `proof advance` calls SHALL return the same request without polling,
redispatching, or consuming another attempt.

#### Scenario: Advance is called while review is waiting

- **WHEN** the external request is unchanged and no response exists
- **THEN** Foundation returns the existing handoff and performs no external or
  model call

