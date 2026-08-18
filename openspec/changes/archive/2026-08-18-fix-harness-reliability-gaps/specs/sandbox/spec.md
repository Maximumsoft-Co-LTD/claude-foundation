## ADDED Requirements

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
