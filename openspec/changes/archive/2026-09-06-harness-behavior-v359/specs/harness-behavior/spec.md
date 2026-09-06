# harness-behavior

## ADDED Requirements

### Requirement: target-completion

The system SHALL The user projection distinguishes TARGET_REACHED from DELIVERED while preserving DONE and reached machine fields.

#### Scenario: When advance reaches build, proven, or archived

- **WHEN** When advance reaches build, proven, or archived
- **THEN** The user projection distinguishes TARGET_REACHED from DELIVERED while preserving DONE and reached machine fields.

### Requirement: host-conformance

The system SHALL Current lease fencing rejects stale results, active workers are not duplicated, and telemetry cannot complete lifecycle work.

#### Scenario: When resumed hosts release old leases or import repeated observations

- **WHEN** When resumed hosts release old leases or import repeated observations
- **THEN** Current lease fencing rejects stale results, active workers are not duplicated, and telemetry cannot complete lifecycle work.

### Requirement: recovery-ownership

The system SHALL Internal waits stay harness-owned and recovery reuses ready work while actual external dependencies retain external ownership.

#### Scenario: When a worker or internal lock is active or setup and review infrastructure fail

- **WHEN** When a worker or internal lock is active or setup and review infrastructure fail
- **THEN** Internal waits stay harness-owned and recovery reuses ready work while actual external dependencies retain external ownership.

### Requirement: readiness-diagnostics

The system SHALL Read-only projections expose truthful target, delivery, owner, freshness and availability; diagnostic exports use allowlisted non-sensitive fields.

#### Scenario: When local feedback, diagnostics, or dashboard status is read

- **WHEN** When local feedback, diagnostics, or dashboard status is read
- **THEN** Read-only projections expose truthful target, delivery, owner, freshness and availability; diagnostic exports use allowlisted non-sensitive fields.

### Requirement: resume-context

The system SHALL A bounded packet derived from current state provides the task frontier, decisions, leases, findings and next route without claiming stale context or dispatching duplicate work.

#### Scenario: When an agent resumes after agreement, wiring, base or delivery progress changes

- **WHEN** When an agent resumes after agreement, wiring, base or delivery progress changes
- **THEN** A bounded packet derived from current state provides the task frontier, decisions, leases, findings and next route without claiming stale context or dispatching duplicate work.

### Requirement: projection-compatibility

The system SHALL The runtime and documented protocol pins agree, read-only CLI calls preserve lifecycle state, and completion and resume behavior have deterministic coverage.

#### Scenario: When a consumer upgrades or inspects the new projections

- **WHEN** When a consumer upgrades or inspects the new projections
- **THEN** The runtime and documented protocol pins agree, read-only CLI calls preserve lifecycle state, and completion and resume behavior have deterministic coverage.

### Requirement: mutation-applicability

The system SHALL Runtime API drift and erased dispatch failure details remain detected by applicable deterministic mutation probes.

#### Scenario: When the versioned runtime is checked for deliberately injected contract faults

- **WHEN** When the versioned runtime is checked for deliberately injected contract faults
- **THEN** Runtime API drift and erased dispatch failure details remain detected by applicable deterministic mutation probes.
