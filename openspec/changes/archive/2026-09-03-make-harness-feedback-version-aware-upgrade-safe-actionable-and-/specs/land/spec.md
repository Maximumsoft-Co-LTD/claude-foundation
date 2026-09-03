# land

## ADDED Requirements

### Requirement: Out-of-band delivery is visible but non-authoritative

The system SHALL report when change bytes or an explicit delivery reference are observed in a target before archived, SHALL provide an exact audited recovery route, and SHALL NOT convert that observation into Proof, authority, Land permission, or archive completion.

#### Scenario: Target contains the change before archive

- **WHEN** the target repository advances to include the change while lifecycle state is still change, building, waiting, or proven
- **THEN** diagnostics report out-of-band delivery with current lifecycle state and supported reconciliation choices

#### Scenario: External delivery exists without proof

- **WHEN** an out-of-band commit, pull request, or deployment reference is recorded but required evidence is missing or stale
- **THEN** Proof and Land remain blocked and the change cannot be marked archived
