# update-advisory

## ADDED Requirements

### Requirement: Legacy policy diagnostics recognize recorded intent

Upgrade and doctor diagnostics SHALL warn about a former packaged default only when its ownership remains ambiguous, SHALL recognize a valid configured signed CI provider and a bounded project-owned acknowledgement, and SHALL never rewrite the policy or acknowledgement automatically.

#### Scenario: Historical value is supported by signed CI

- **WHEN** `land.riskBasedCi` retains the former value and a valid signed CI issuer/public-key configuration exists
- **THEN** diagnostics do not describe the value as an unresolved legacy-default drift

#### Scenario: Project records intentional policy

- **WHEN** a project-owned acknowledgement binds the policy path and current value
- **THEN** diagnostics report intentional policy without repeating the migration warning
- **AND** install and update preserve both policy and acknowledgement

### Requirement: Source cohort evaluation is lazy and failure-contained

The runtime SHALL calculate a content digest only for commands that consume producer provenance and SHALL return explicit unavailable provenance when the managed source cannot be read, without preventing unrelated commands from running.

#### Scenario: A non-provenance command starts

- **WHEN** an operator runs a command that does not emit metrics or feedback provenance
- **THEN** the runtime performs no harness-tree digest traversal

#### Scenario: Managed source cannot be completely read

- **WHEN** a provenance consumer cannot hash one or more managed files
- **THEN** it reports an unavailable content digest and bounded reason
- **AND** no semantic version or symptom is substituted for the missing digest
