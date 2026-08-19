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

### Requirement: Sandbox sync validates the packet against its source tree

When Foundation validates a root change packet in preparation for sandbox synchronization, repository selection, grounding read-set paths, and repository target paths SHALL resolve from the root source tree. Validation of an active change packet SHALL continue to resolve those inputs from the isolated workspace.

#### Scenario: Root grounding input changed after sandbox creation

- **WHEN** a committed target update changes an immutable grounding input and the root packet records the new digest before `sandbox sync`
- **THEN** root validation accepts the target bytes and synchronization can replay or refresh the sandbox instead of failing against the stale sandbox copy

#### Scenario: Active validation remains isolated

- **WHEN** an active sandbox packet is validated during Build or Prove
- **THEN** repository inputs resolve from the sandbox and a target-only value cannot satisfy its grounding read set

#### Scenario: Root and sandbox repository selections differ

- **WHEN** root-source validation reads a refreshed repositories.yaml while the active sandbox still carries the prior selection
- **THEN** each validation uses the selection in its own packet tree and still enforces known repositories and declared dependencies

