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

