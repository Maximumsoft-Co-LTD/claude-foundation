# change-validation Specification

## Purpose
TBD - created by archiving change fix-review-authority-guards-and-land-recovery-defects. Update Purpose after archive.
## Requirements
### Requirement: Spec wording lint runs at change validate

`change validate` SHALL run the OpenSpec strict validation for the change when
the OpenSpec CLI is available and SHALL fail with the reported findings, so
that normative-wording defects surface before Prove instead of inside
`openspec archive`; when the CLI is absent, validate SHALL warn and continue.

#### Scenario: Missing SHALL fails validate

- **WHEN** a change's spec delta lacks SHALL/MUST wording and the OpenSpec CLI
  is installed
- **THEN** `change validate` fails and reports the strict-validation findings

#### Scenario: Corrected wording passes

- **WHEN** the spec delta is corrected to strict-valid wording
- **THEN** `change validate` passes

#### Scenario: Absent CLI degrades to a warning

- **WHEN** the OpenSpec CLI is not installed
- **THEN** `change validate` warns about the skipped lint and does not fail for
  that reason

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

### Requirement: Critical-case wiring is executable before Build

Change validation SHALL reject a provider that declares critical cases when its adapter, report format, or configured report path cannot produce per-case observations, and SHALL name a supported correction before Build begins.

#### Scenario: Plain command cannot report declared cases

- **WHEN** a provider declares critical cases but exposes only an unstructured exit code
- **THEN** validation fails and names a structured report or capable adapter route

#### Scenario: Supported structured report is configured

- **WHEN** the adapter and report format can produce every declared critical-case observation
- **THEN** validation accepts the wiring while runtime results remain responsible for pass, fail, skipped, and missing status

