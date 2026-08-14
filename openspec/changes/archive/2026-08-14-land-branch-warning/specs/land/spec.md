## ADDED Requirements

### Requirement: Landing onto a default branch is visible

The system SHALL surface — without blocking — when landed work targets a
repository whose checked-out branch is `main` or `master`.

#### Scenario: land record warns on a default branch

- **WHEN** `land record` binds a commit and the target repository is checked
  out on `main` or `master`
- **THEN** the command succeeds and prints a warning naming the repository
  and the branch

#### Scenario: a feature branch stays silent

- **WHEN** the target repository is checked out on any other branch or a
  detached HEAD
- **THEN** no branch warning is printed

#### Scenario: land check reports the root target branch

- **WHEN** `land check` reaches `LAND READY` and the root target is checked
  out on `main` or `master`
- **THEN** the output includes a `branch:` line naming it

### Requirement: Doctor escalates the unwired branch guard

`doctor` SHALL report `no-direct-main: disabled (opt-in policy)` at `warn`
level while the hook is not wired, and keep `enabled` at `info`.

#### Scenario: disabled guard is a warning

- **WHEN** `.claude/settings.json` does not wire `no-direct-main-commit.sh`
  and `doctor` runs
- **THEN** the `no-direct-main` check reports at `warn` level and the doctor
  exit code is unchanged
