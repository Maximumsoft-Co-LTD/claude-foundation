# change Specification

## Purpose
TBD - created by archiving change keep-the-change-loop-from-losing-provider-config-and-dead-ending. Update Purpose after archive.
## Requirements
### Requirement: Workspace walks exclude regenerable output

The copy sandbox and the workspace baseline SHALL exclude paths git reports as
ignored, so that a repository carrying a large ignored build directory does not
copy or hash it.

#### Scenario: repository with a large ignored build directory

- **WHEN** `sandbox create` runs in a git repository whose `.gitignore`
  excludes a build directory
- **THEN** the sandbox copy omits that directory, and the recorded workspace
  baseline records no entry beneath it

### Requirement: A failed sandbox copy leaves no unrecorded tree

When a sandbox copy cannot complete, the runtime SHALL remove the partial tree
and report the failure, so that the next `sandbox create` is not blocked by an
occupied path the runtime never recorded.

#### Scenario: copy fails partway

- **WHEN** a sandbox copy fails after writing part of its tree
- **THEN** the sandbox directory does not remain, and the reported failure names
  the cause

### Requirement: Detected provider config survives sandbox synchronization

Provider configuration written by `evidence init --write` SHALL be stored in the
change's durable directory so that a later `sandbox sync` cannot destroy it, and
SHALL also be visible to an active sandbox without requiring a sync.

#### Scenario: init during Build then sync

- **WHEN** `evidence init --write` configures a provider while a sandbox is
  active, and `sandbox sync` then runs
- **THEN** the provider remains configured in both the durable change directory
  and the sandbox copy

### Requirement: Concurrent drafts preserve worktree isolation

`sandbox create` SHALL treat every uncommitted draft under `openspec/changes/`
as harness-owned state, so that an unrelated active change does not downgrade
workspace isolation to a full-tree copy.

#### Scenario: second change while a first draft is uncommitted

- **WHEN** a change draft already exists uncommitted under `openspec/changes/`
  and `sandbox create` runs for a different change in a clean git repository
- **THEN** the new sandbox is a git worktree, not an isolated copy

### Requirement: Rapid proposals validate against OpenSpec

The rapid proposal template SHALL use the section headers OpenSpec requires, so
that landing a rapid change emits no missing-section warning.

#### Scenario: rapid change validated

- **WHEN** a change is created from the rapid template and validated
- **THEN** validation reports no missing required proposal section

### Requirement: Orphan runtime state names its supported exit

The orphan-runtime diagnostic SHALL name the `change abandon` command rather
than instructing an operator to move runtime state files by hand.

#### Scenario: doctor reports an orphan

- **WHEN** `doctor` reports runtime state whose active change directory is gone
- **THEN** the reported next action names `change abandon`

### Requirement: The phase guard costs nothing when there is nothing to guard

The wired phase-mutation hook SHALL reach its no-op decision without starting a
JavaScript interpreter when guardrail mode is off, or when the mode is not
`block` and neither an exported active phase nor any recorded phase context
exists. In every other case it SHALL delegate to the guard.

#### Scenario: stock install with no active change

- **WHEN** a mutating tool call is made in a project with no active phase and no
  recorded phase context
- **THEN** the hook exits without a violation and without starting Node

#### Scenario: block mode with an unknown phase

- **WHEN** guardrail mode is `block` and no phase can be established
- **THEN** the hook delegates to the guard, which fails closed

#### Scenario: a recorded phase exists

- **WHEN** any recorded phase context is present
- **THEN** the hook delegates to the guard regardless of the context's age

### Requirement: Enforcement is unchanged through the prefilter

A mutation that violates the active phase's surface SHALL produce the same
violation through the wired hook as through the guard invoked directly.

#### Scenario: out-of-sandbox mutation during Build

- **WHEN** Build is the active phase and a mutation targets a path outside the
  isolated workspace and its declared paths
- **THEN** the violation is recorded, and in block mode the hook emits a block
  decision

### Requirement: An upgraded project runs one phase guard

Installing over a project whose settings wire a superseded phase-guard command
SHALL leave exactly one phase guard wired.

#### Scenario: upgrade over the previous wiring

- **WHEN** the installer merges hooks into settings that already wire the
  superseded guard command
- **THEN** the superseded command is removed and only the current one remains

### Requirement: The guardrail audit log is bounded

The guardrail audit log SHALL rotate at a size cap and retain one previous
generation, so that repeated appends cannot grow it without limit.

#### Scenario: appends exceed the cap

- **WHEN** appends carry the audit log past its size cap
- **THEN** the log is rotated to a single previous generation and a new log
  begins

### Requirement: A review response records without unsupported flags

A review response written from the emitted template SHALL record through
`authority record` without requiring any flag that command does not accept, and
the template SHALL carry the reviewer and implementation provenance the receipt
requires.

#### Scenario: recording a human review through the authority bridge

- **WHEN** a review response file carrying reviewer type and subject provenance
  is recorded against its request
- **THEN** the review receipt is written and no unsupported-flag error is raised

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

### Requirement: New capabilities use additive deltas

Foundation SHALL reject a standard change whose delta targets a capability
without a canonical specification and declares `MODIFIED Requirements` or
`REMOVED Requirements`, and SHALL identify `ADDED Requirements` as the valid
form before Build begins.

#### Scenario: A new capability declares a non-additive operation

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and the delta contains a `MODIFIED Requirements` or
  `REMOVED Requirements` section
- **THEN** validation fails, names the capability and offending operation, and
  instructs the author to use `ADDED Requirements`

#### Scenario: A new capability declares only additions

- **WHEN** `change validate` reads a delta for a capability absent from
  `openspec/specs/` and every requirement is under `ADDED Requirements`
- **THEN** the new-capability operation check passes

