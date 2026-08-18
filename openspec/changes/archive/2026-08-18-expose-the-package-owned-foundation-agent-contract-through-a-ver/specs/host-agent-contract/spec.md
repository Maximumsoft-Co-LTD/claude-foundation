## ADDED Requirements

### Requirement: Package-owned agent contract is available to host clients

The system SHALL expose the installed Foundation agent contract through a
read-only, versioned JSON host endpoint without performing project discovery or
returning a filesystem path.

#### Scenario: Canonical contract is returned

- **WHEN** a host invokes `claude-foundation host agent-contract` with protocol
  1 and JSON format
- **THEN** the response contains protocol 1, the exact package-owned
  `.claude/harness/AGENT.md` text, and the installed Foundation version

#### Scenario: Endpoint runs outside a project

- **WHEN** the endpoint is invoked from a directory with no Foundation project
- **THEN** it resolves the contract from the installed CLI package

#### Scenario: Packaged layout owns its dependencies

- **WHEN** the CLI runs from an installed libexec-style package
- **THEN** the endpoint resolves `AGENT.md` and `VERSION` from that same package

#### Scenario: Invalid requests fail closed

- **WHEN** protocol, format, flags, contract source, or version source is invalid
- **THEN** the command exits non-zero with protocol 1 and a stable JSON error
- **AND** does not return partial contract content or inspect a project path

#### Scenario: Existing host instruction clients remain compatible

- **WHEN** a client invokes any protocol-1 `host instruction` command after the
  agent-contract endpoint is added
- **THEN** the existing response, arguments, errors, and package resolution are
  unchanged
