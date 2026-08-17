# host-instruction-api Specification

## Purpose
TBD - created by archiving change publish-a-versioned-host-instruction-cli-endpoint-for-changeloop. Update Purpose after archive.
## Requirements
### Requirement: Installed Foundation exposes canonical host instructions

The system SHALL expose a versioned, read-only CLI contract that returns the
canonical instruction for each shipped Foundation workflow command from the
installed Foundation release without requiring a target project.

#### Scenario: Host resolves every workflow instruction

- **WHEN** a host requests protocol 1 for any of the eight shipped workflow
  command names
- **THEN** the CLI returns valid JSON naming the same command, its description,
  rendered instruction, argument mode, protocol, and Foundation version

#### Scenario: Arguments remain opaque

- **WHEN** an argument-taking command receives spaces, quotes, dollar signs, or
  command-substitution text in its argument value
- **THEN** that value is rendered as literal instruction content
- **AND** no part of it is evaluated as shell syntax or used as a file path

#### Scenario: Endpoint is project independent

- **WHEN** the installed CLI is invoked from a directory without Foundation
  project markers
- **THEN** the host instruction succeeds from package-owned sources

#### Scenario: Contract evolves additively

- **WHEN** a protocol-1 producer adds an optional response field
- **THEN** existing tolerant consumers can continue using the required fields

### Requirement: Host-instruction failures are machine-readable

The system SHALL reject unsupported protocols, unknown commands, invalid
argument use, and unavailable package instructions with a non-zero exit and a
JSON error carrying a stable machine code.

#### Scenario: Unknown command cannot select a file

- **WHEN** a caller supplies a command name outside the eight-command allow-list
- **THEN** the CLI returns `unknown_host_command`
- **AND** performs no caller-controlled filesystem lookup

#### Scenario: No-argument command rejects arguments

- **WHEN** `changes` receives a non-empty argument value
- **THEN** the CLI returns `unexpected_arguments`

#### Scenario: Unsupported protocol fails explicitly

- **WHEN** a caller requests a protocol version the installed CLI does not support
- **THEN** the CLI returns `unsupported_protocol` without returning an instruction

