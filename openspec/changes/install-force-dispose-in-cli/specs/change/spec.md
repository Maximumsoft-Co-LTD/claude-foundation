## ADDED Requirements

### Requirement: CLI service entry points install force-dispose bootstrap

The system SHALL install `ForceDisposeSignalGuard::install_with_panic_hook` and
enrol the opened `AppService` force-dispose registry with
`process_force_dispose` before headless conversation work, headless control RPCs,
or `serve` surface work begins.

#### Scenario: headless CLI entry installs force dispose bootstrap

- **WHEN** the operator runs a headless conversation or control command that
  opens an `AppService`
- **THEN** the process-wide signal and panic backstop is installed and the
  service registry is linked before the first wire request is handled

#### Scenario: serve CLI entry installs force dispose bootstrap

- **WHEN** the operator runs `cloop serve`
- **THEN** the same bootstrap is installed before the selected transport begins
  serving requests

#### Scenario: service bootstrap links to process registry

- **WHEN** the service bootstrap is installed for an `AppService`
- **THEN** a termination signal runs the service force-dispose path through the
  process-wide registry

#### Scenario: a signalled service-backed project releases its children without Drop

- **WHEN** a project opened through a bootstrapped CLI service entry receives
  SIGTERM and its owning `ProjectInstance` is forgotten without `Drop`
- **THEN** registered children are force-disposed and the cancellation token is
  cancelled

### Requirement: ACP CLI entry installs process force dispose

The system SHALL install `ForceDisposeSignalGuard::install_with_panic_hook`
before the ACP stdio loop begins, even though ACP does not open an
`AppService`.

#### Scenario: acp CLI entry installs process force dispose bootstrap

- **WHEN** the operator runs `cloop acp`
- **THEN** the process-wide signal and panic backstop is installed before the
  first JSON-RPC line is read
