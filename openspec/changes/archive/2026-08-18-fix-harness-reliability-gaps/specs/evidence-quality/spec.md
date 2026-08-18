## ADDED Requirements

### Requirement: Executable provider scripts are content-bound

The harness SHALL require a workspace-relative file named directly by an
executable provider command to be covered by the provider's declared inputs or
the change's declared surface when that file is untracked, and evidence
bootstrap SHALL emit deterministic input coverage when it can identify the
script safely.

#### Scenario: An untracked test script changes after proof

- **WHEN** a provider command names an untracked workspace script and that
  script changes without an implementation change
- **THEN** its prior receipt is stale and the provider executes again

#### Scenario: Command input coverage is absent

- **WHEN** validation sees a workspace script argument outside both provider
  inputs and the declared surface
- **THEN** validation refuses the unsafe wiring and names the uncovered path
