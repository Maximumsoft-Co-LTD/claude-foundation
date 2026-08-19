## MODIFIED Requirements

### Requirement: Installed Foundation exposes canonical host instructions

The system SHALL expose a versioned, read-only CLI contract that returns the
canonical instruction for each shipped Foundation workflow command from the
installed Foundation release without requiring a target project. Protocol-1
Investigate, Change, and Build responses MAY additionally contain a
machine-readable non-blocking update advisory; all required protocol-1 fields
remain unchanged.

#### Scenario: Host resolves every workflow instruction

- **WHEN** a host requests protocol 1 for any of the eight shipped workflow command names
- **THEN** the CLI returns valid JSON naming the same command, its description, rendered instruction, argument mode, protocol, and Foundation version

#### Scenario: Arguments remain opaque

- **WHEN** an argument-taking command receives spaces, quotes, dollar signs, or command-substitution text in its argument value
- **THEN** that value is rendered as literal instruction content
- **AND** no part of it is evaluated as shell syntax or used as a file path

#### Scenario: Endpoint is project independent

- **WHEN** the installed CLI is invoked from a directory without Foundation project markers
- **THEN** the host instruction succeeds from package-owned sources

#### Scenario: Contract evolves additively

- **WHEN** a protocol-1 producer adds the optional update response field
- **THEN** existing tolerant consumers can continue using the required fields

