## ADDED Requirements

### Requirement: New capabilities use additive deltas

Foundation SHALL reject a standard change whose delta targets a capability
without a canonical specification and declares `MODIFIED Requirements` or
`REMOVED Requirements`, and SHALL identify `ADDED Requirements` as the valid
form before Build begins.

#### Scenario: A new capability declares a non-additive operation

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and the delta contains a `MODIFIED Requirements` or
  `REMOVED Requirements` section
- **THEN** validation fails, names the capability and offending operation, and
  instructs the author to use `ADDED Requirements`

#### Scenario: A new capability declares only additions

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and every requirement is under `ADDED Requirements`
- **THEN** the new-capability operation check passes
