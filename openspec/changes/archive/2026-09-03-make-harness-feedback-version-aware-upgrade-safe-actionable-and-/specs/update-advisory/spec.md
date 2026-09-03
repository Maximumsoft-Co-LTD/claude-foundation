# update-advisory

## ADDED Requirements

### Requirement: Supported upgrades diagnose legacy-default drift without taking authority

Install, update, and doctor flows SHALL identify project-owned values that match known former packaged defaults, SHALL distinguish them from confirmed customization, SHALL describe affected active changes, and SHALL require an explicit decision before changing them.

#### Scenario: Former risk-based CI default survives upgrade

- **WHEN** a supported project retains the former packaged riskBasedCi value and has no configured signed CI provider
- **THEN** doctor reports legacy-default drift before Build with old and current defaults, affected active changes, and a previewable migration route

#### Scenario: Project intentionally keeps the former value

- **WHEN** the user declines migration or the value is recorded as intentional policy
- **THEN** the installer preserves it and the advisory never rewrites the project or active change
