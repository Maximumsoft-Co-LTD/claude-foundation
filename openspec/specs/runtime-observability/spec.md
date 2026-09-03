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

### Requirement: Unavailable host usage is actionable

Metrics SHALL preserve absent host usage as unmeasured null values and SHALL
include a structured availability reason plus package-supported recovery actions
without creating a telemetry event or estimating model usage.

#### Scenario: A correlated Codex session has no imported events

- **WHEN** phase context contains a Codex session identity but no Codex usage
  event was imported
- **THEN** metrics report correlation-without-usage as the reason
- **AND** name the supported Codex telemetry import route
- **AND** requests, tokens, and cost remain null

#### Scenario: No host telemetry context is available

- **WHEN** no host events or correlated host phase context exist
- **THEN** metrics report host-telemetry-not-ingested
- **AND** name the generic telemetry and host-execution import routes

#### Scenario: Host events are present

- **WHEN** at least one normalized host event has been ingested
- **THEN** usage availability reports measured with no recovery action

### Requirement: Runtime observations identify their exact source cohort

The system SHALL attach the producing Foundation semantic version, protocol bundle, and content-derived source cohort identity to metrics and generated feedback reports using additive fields, and SHALL report unavailable provenance rather than infer it.

#### Scenario: Same version carries different source bytes

- **WHEN** a tagged release and a patched source installation expose the same semantic version but different protocol or managed-file content
- **THEN** their metrics and feedback reports carry different source cohort identities

#### Scenario: Historical observation has no source digest

- **WHEN** an older record lacks content-bound producer provenance
- **THEN** the provenance is reported as unavailable and is not inferred from symptoms

### Requirement: Blocked operations carry bounded causal diagnostics

The operation ledger SHALL record a package-defined blocker code, classification, bounded summary, recovery route, and decision fingerprint when available, SHALL exclude raw untrusted error content, and SHALL leave unavailable cause data explicit.

#### Scenario: Known decision boundary blocks

- **WHEN** a lifecycle command stops at a structured authority, budget, conflict, or recovery boundary
- **THEN** its operation row records the same typed cause and exact supported next action

#### Scenario: Hostile error text reaches a failed command

- **WHEN** terminal output contains a credential-shaped value or user-controlled command text
- **THEN** the operation ledger does not copy that text into blocker fields

### Requirement: Budget targets explain their execution-surface calibration

The system SHALL derive initial request and token targets from the compiled task, claim, provider, repository, review-risk, and security surface, SHALL expose the non-secret calibration inputs, and SHALL preserve measured lifetime usage and explicitly granted continuation windows across upgrades.

#### Scenario: Large evidence surface receives calibrated targets

- **WHEN** a change has several claims, providers, tasks, or repositories and requires high-risk review
- **THEN** both request and token targets reflect that surface and metrics explain the factors used

#### Scenario: Audited continuation survives recalibration

- **WHEN** policy or runtime calibration changes after an operator granted a continuation window
- **THEN** the granted window and all measured lifetime usage remain unchanged

