# host-adapter

## ADDED Requirements

### Requirement: Host guard capabilities are reported truthfully

Foundation SHALL derive each supported host's live guard coverage from one canonical capability contract and SHALL distinguish full, partial, and unavailable prevention without claiming behavior the host cannot execute.

#### Scenario: Host without tool hooks

- **WHEN** the capability contract is inspected for Cursor or Codex
- **THEN** the result reports live guards as unavailable, names Land gates as final enforcement, and does not claim prevention parity

#### Scenario: Host with partial adapter coverage

- **WHEN** the capability contract is inspected for OpenCode
- **THEN** the result identifies the live phase, secret, and lint guards and the unavailable session digest

#### Scenario: Native dispatch is available without live mutation guards

- **WHEN** a host supports the canonical native dispatch contract but exposes no tool-hook API
- **THEN** the capability result reports dispatch separately and still reports live mutation guards as unavailable

### Requirement: Host adapter upgrades converge owned command surfaces

Each host adapter SHALL record exact Foundation-owned adapter artifacts and SHALL remove a previously owned artifact that the current adapter no longer ships, while preserving every path not proven to be Foundation-owned.

#### Scenario: Foundation command is retired

- **WHEN** an adapter upgrade runs after a previously installed Foundation command or prompt is removed from the source
- **THEN** the retired owned artifact is removed and the adapter manifest converges to the current source

#### Scenario: User command shares the adapter directory

- **WHEN** an adapter upgrade runs beside a command or prompt absent from the Foundation ownership manifest
- **THEN** the user-owned artifact remains unchanged
