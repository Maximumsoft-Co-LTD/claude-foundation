## ADDED Requirements

### Requirement: Change surface is tracked or declared

The workspace manifest and the relevant snapshot SHALL admit a path only when
git tracks it or the change declares it, so that an untracked path the change
never declared neither binds evidence nor reaches an apply projection.

#### Scenario: an undeclared untracked tree sits in the working tree

- **WHEN** the working tree carries an untracked directory outside every declared
  path, and `proof readiness` and an apply projection are computed
- **THEN** the workspace hash is unchanged by that directory, and no path beneath
  it appears in the projection

#### Scenario: the change creates a file it declares

- **WHEN** a change creates a new untracked file inside a declared path
- **THEN** the file is part of the workspace hash and lands with the change

#### Scenario: manifest and snapshot describe one surface

- **WHEN** the workspace manifest and the relevant snapshot are computed over the
  same tree
- **THEN** they admit the same set of paths

### Requirement: A projected deletion rests on sandbox evidence

An apply projection SHALL treat a path as deleted only when the path is inside
the declared surface and the sandbox reports it removed relative to the sandbox
base. Absence from a manifest SHALL NOT authorize removing a target path.

#### Scenario: a path is absent from the sandbox but was never removed there

- **WHEN** an apply projection would delete target paths that the sandbox never
  removed
- **THEN** the apply fails without changing the target, and the failure names the
  offending paths and their total count

#### Scenario: a declared file is deleted in the sandbox

- **WHEN** a change removes a file inside its declared paths and lands
- **THEN** the file is removed from the target

### Requirement: An apply reports its projection before running

The runtime SHALL report the projection as update, create and delete counts
before the transaction runs, so that a projection that does not match the change
is visible before any path changes.

#### Scenario: a projection is about to run

- **WHEN** an apply transaction begins
- **THEN** the reported output states how many paths it will update, create and
  delete

### Requirement: Land check performs no mutation

`land check` SHALL NOT resume, roll back, or otherwise alter a pending apply
transaction. When such a transaction exists it SHALL report the transaction
identity, its status, its update, create and delete counts, and the command that
performs recovery.

#### Scenario: a pending apply transaction exists

- **WHEN** `land check` runs while an apply transaction is pending, rolling back,
  or awaiting manual recovery
- **THEN** no path in the working tree changes, and the report names the
  transaction, its counts, and the recovery command

### Requirement: Apply recovery is explicit and authorized

Recovering an interrupted apply transaction SHALL require an explicit command
carrying a host decision reference.

#### Scenario: an operator recovers an interrupted apply

- **WHEN** recovery is requested without a decision reference
- **THEN** the command refuses and names the required reference

#### Scenario: recovery carries a decision reference

- **WHEN** recovery is requested with a decision reference
- **THEN** the recorded transaction is resumed or rolled back and the outcome is
  reported
