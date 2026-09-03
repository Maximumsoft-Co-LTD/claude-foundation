# change-validation

## ADDED Requirements

### Requirement: Critical-case wiring is executable before Build

Change validation SHALL reject a provider that declares critical cases when its adapter, report format, or configured report path cannot produce per-case observations, and SHALL name a supported correction before Build begins.

#### Scenario: Plain command cannot report declared cases

- **WHEN** a provider declares critical cases but exposes only an unstructured exit code
- **THEN** validation fails and names a structured report or capable adapter route

#### Scenario: Supported structured report is configured

- **WHEN** the adapter and report format can produce every declared critical-case observation
- **THEN** validation accepts the wiring while runtime results remain responsible for pass, fail, skipped, and missing status
