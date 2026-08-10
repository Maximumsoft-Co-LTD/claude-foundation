## ADDED Requirements

### Requirement: Declared change surface

The system SHALL let a change record the paths its author expects to touch,
before any of them exist, SHALL report them back, and SHALL treat the
declaration as optional.

#### Scenario: Declaring no surface changes nothing

- **WHEN** a change is resolved without `--surface`
- **THEN** no forecast is reported by any command and the existing
  changed-surface policy check is exactly as it was

### Requirement: Capability forecast from declared surface

The system SHALL apply the capability rules to a declared surface whose files
need not exist, SHALL name the declared path responsible for each forecast
capability, and SHALL forecast one declared surface identically in every
command that reports on it.

#### Scenario: Declared surface forecasts before files exist

- **WHEN** a change declares a `.tsx` path that has not been written and a
  lockfile-class path
- **THEN** `doctor --stage change` forecasts `accessibility` and
  `dependency-supply-chain` and names the declared path that pulls each

#### Scenario: A change packet pulls no capability

- **WHEN** a declared surface contains paths under `openspec/changes/`
- **THEN** those paths contribute no forecast capability, matching the rule
  already applied to the changed surface

### Requirement: The forecast is advisory and never enforcement

The system SHALL warn when a forecast capability has no provider in the
evidence contract, SHALL NOT fail the change for it, and SHALL continue to
derive required evidence from the real changed surface.

#### Scenario: Forecast gap warns without failing

- **WHEN** a forecast names a capability the contract declares no provider for
- **THEN** `doctor --stage change` reports it at warning level and
  `change validate` warns and still exits successfully

#### Scenario: Forecast never replaces enforcement

- **WHEN** a change declares a surface
- **THEN** the capabilities required at Prove are still derived from the real
  changed surface, unaffected by what was declared

### Requirement: Review consequence is forecast with the capabilities

The system SHALL state, at change time, whether the forecast capabilities will
require an independent reviewer and whether reviewer diversity will be
demanded, without altering the review policy that existing evidence is
fingerprinted against.

#### Scenario: Review consequence is stated at change time

- **WHEN** a declared surface forecasts a capability that forces review
- **THEN** `doctor --stage change` names both the required independent review
  and the required reviewer diversity before a signature is spent, and
  `reviewPolicy` returns the object it returned before this change
