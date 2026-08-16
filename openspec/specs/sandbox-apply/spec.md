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

