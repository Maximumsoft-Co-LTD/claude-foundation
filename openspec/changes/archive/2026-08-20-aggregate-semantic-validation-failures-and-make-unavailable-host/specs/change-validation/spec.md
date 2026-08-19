## ADDED Requirements

### Requirement: Dependency-safe semantic validation is aggregated

`change validate` SHALL report every independent claim-contract defect in one
claim-layer result and every independent task-contract defect in one task-layer
result after the artifacts required by that layer are valid. It SHALL stop
before a dependent layer when its prerequisites cannot be parsed or trusted.

#### Scenario: Several claims are independently invalid

- **WHEN** multiple evidence claims have invalid impact, repository scope, or
  cross-repository capability declarations
- **THEN** one validation invocation reports every affected claim and defect

#### Scenario: Several tasks are independently invalid

- **WHEN** multiple tasks reference unknown or out-of-scope claims or invalid
  repository/path scopes
- **THEN** one validation invocation reports every affected task and defect

#### Scenario: A prerequisite artifact is malformed

- **WHEN** a semantic layer cannot safely read its prerequisite artifact
- **THEN** validation stops at that prerequisite instead of cascading derived
  errors from later layers
