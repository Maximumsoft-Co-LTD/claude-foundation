# prove Specification

## Purpose
TBD - created by archiving change prove-readiness-fixit. Update Purpose after archive.
## Requirements
### Requirement: Changed-surface blocker carries a copy-pasteable fix

When proof readiness blocks because a repository changed files outside every
task's declared paths, the readiness output SHALL include a recovery
instruction containing the exact undeclared paths in `[paths:]` annotation
form, ready to append to the owning task in `tasks.md`.

#### Scenario: undeclared paths are rendered as a paste-ready annotation

- **WHEN** a multi-repository change has modified a file no task declares and
  proof readiness runs
- **THEN** the blocker names the repository and the offending paths, and the
  recovery section includes the same paths formatted as a `[paths:...]`
  annotation the agent can paste into `tasks.md`

#### Scenario: declared surfaces stay silent

- **WHEN** every changed file matches a declared task path
- **THEN** readiness reports no changed-surface blocker and no fix-it text

### Requirement: Build declares test files as they are created

The `/build` instruction SHALL direct that a newly created test file is added
to the owning task's `[paths:]` annotation in `tasks.md` in the same step that
creates the file.

#### Scenario: instruction present

- **WHEN** the shipped `/build` command text is read
- **THEN** it states that new test files are declared in the ledger when they
  are created, before Prove runs

