# land

## ADDED Requirements

### Requirement: High-level recovery remains local and non-authoritative

The coordinator MAY perform or prescribe reversible local sandbox reconciliation, evidence refresh, and idempotent telemetry ingestion when their preconditions are fully observed, but SHALL stop before conflict overwrite, waiver, commit, push, publication, pull request creation, or inferred delivery acceptance.

#### Scenario: Target moved without a conflict

- **WHEN** local sandbox reconciliation is policy-allowed and the replay is conflict-free
- **THEN** the coordinator returns or performs the bounded sync and requires fresh invalidated proof

#### Scenario: Target movement conflicts with repair work

- **WHEN** sandbox reconciliation detects a conflicting path
- **THEN** the coordinator preserves both states and returns a conflict authority boundary

#### Scenario: Delivery authority is absent

- **WHEN** proof passes but commit, push, publication, or another declared delivery step lacks authority
- **THEN** the coordinator reports Land readiness and stops without performing that step
