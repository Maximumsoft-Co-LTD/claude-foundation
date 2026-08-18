## ADDED Requirements

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
