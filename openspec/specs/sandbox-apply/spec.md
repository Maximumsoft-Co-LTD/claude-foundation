# sandbox-apply Specification

## Purpose
TBD - created by archiving change fix-review-authority-guards-and-land-recovery-defects. Update Purpose after archive.
## Requirements
### Requirement: Applied projection refresh is reachable from the CLI

`sandbox apply` SHALL accept a `--refresh` boolean flag that refreshes the
applied projection of a target that legitimately moved after apply, SHALL
continue to reject unknown flags, and SHALL keep refusing a refresh when an
applied path diverged from the sandbox copy or the transaction journal is
missing.

#### Scenario: Refresh a moved target

- **WHEN** a change is applied, the target repository advances for unrelated
  reasons, and the operator runs `sandbox apply <change> --refresh`
- **THEN** the applied projection and journal are refreshed and the change can
  proceed to archive

#### Scenario: Unknown flags still die

- **WHEN** `sandbox apply` is invoked with a flag other than `--refresh`
- **THEN** the command refuses with a usage error

#### Scenario: Diverged path still refuses

- **WHEN** an applied path no longer matches the sandbox copy
- **THEN** the refresh fails naming the diverged path

### Requirement: Copy apply recognizes an exact desired projection

Copy-mode Land SHALL treat a target path whose content identity and mode equal
the sandbox path as already reconciled even when it differs from the recorded
baseline, and SHALL continue to reject a target that differs from both.

#### Scenario: Another change produced the same bytes

- **WHEN** a copy sandbox changed a path and the target independently reached
  the identical content and mode
- **THEN** Land records the no-op projection without an isolated-copy conflict

#### Scenario: The target contains different work

- **WHEN** the target differs from both baseline and sandbox
- **THEN** Land blocks before overwriting the target

