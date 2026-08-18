# sandbox Specification

## Purpose
TBD - created by archiving change sandbox-setup-command. Update Purpose after archive.
## Requirements
### Requirement: Sandbox setup command

The system SHALL run a project-configured setup command inside each newly
created Build workspace and record its outcome in the workspace record.

#### Scenario: configured setup command runs in a new sandbox

- **WHEN** `foundation.json` declares `sandbox.setupCommand` and
  `sandbox create` succeeds
- **THEN** the command runs once with the new workspace root as its working
  directory, and the workspace record notes the command with status `ok`

#### Scenario: absent configuration changes nothing

- **WHEN** no setup command is configured
- **THEN** sandbox creation output and workspace state are identical to the
  behavior before this change

#### Scenario: failed setup keeps the sandbox

- **WHEN** the configured setup command exits nonzero
- **THEN** the sandbox is retained, the workspace record notes status
  `failed` with the exit code, and `sandbox create` prints a warning naming
  the command and the workspace path

#### Scenario: per-repository setup in a multi-repository change

- **WHEN** an `openspec/repositories.yaml` repository row declares
  `setupCommand` and a multi-repository sandbox is created
- **THEN** that repository's command runs inside that repository's sandbox
  and its outcome is recorded on that repository's runtime record

#### Scenario: invalid configuration is rejected

- **WHEN** `sandbox.setupCommand` is present but not a non-empty string, or
  `sandbox.setupTimeoutMs` is present but not a positive integer
- **THEN** loading the policy fails with a message naming the invalid field

### Requirement: A relocated project can rebind its canonical sandbox

The harness SHALL provide deterministic recovery that rebinds missing absolute
workspace locators to the canonical sandbox under the current project root only
after validating the change identity, workspace mode, and expected layout, and
SHALL reject arbitrary or mismatched paths.

#### Scenario: Project directory moved with its machine state

- **WHEN** runtime state names the former project path and the matching sandbox
  exists at the canonical location under the current root
- **THEN** recovery updates the live workspace locator and subsequent packet,
  Prove, and Land commands use the relocated sandbox

#### Scenario: Canonical candidate does not match

- **WHEN** the candidate is absent, has the wrong change identity, or has an
  incompatible workspace layout
- **THEN** recovery refuses it without changing runtime state

