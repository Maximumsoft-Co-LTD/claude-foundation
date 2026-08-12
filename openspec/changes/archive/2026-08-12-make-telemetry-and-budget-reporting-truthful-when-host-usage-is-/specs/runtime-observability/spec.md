## ADDED Requirements

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
