## ADDED Requirements

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
