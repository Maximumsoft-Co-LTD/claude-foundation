# runtime-observability

## ADDED Requirements

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
