## ADDED Requirements

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
