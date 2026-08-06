## ADDED Requirements

### Requirement: Runtime wiring types are public

The system SHALL expose `RuntimeTools`, `RuntimeGate`, and `RuntimeProvider` from
`changeloop-app-server` with constructors callable by downstream crates.

#### Scenario: runtime wiring types are public

- **WHEN** a downstream crate imports `changeloop_app_server::executable`
- **THEN** it can name and construct `RuntimeTools`, `RuntimeGate`, and
  `RuntimeProvider`

#### Scenario: provider execution is constructible

- **WHEN** a caller supplies provider kind, model, auth, and transport
- **THEN** it can build a `ProviderExecution` and pass it to
  `RuntimeProvider::new`

### Requirement: Read-only constructors pin conversation authority

The system SHALL provide read-only constructors that fix
`LifecycleAuthority::Conversation`, disable subagent/MCP discovery, and refuse
mutation capability for conversation sessions.

#### Scenario: read-only tools refuse mutation

- **WHEN** `RuntimeTools::read_only` is built for a conversation session
- **THEN** a filesystem write dispatch returns a mutation-unavailable error

#### Scenario: read-only gate denies writes and process tools

- **WHEN** `RuntimeGate::read_only` evaluates a mutating call or a process/job
  tool under conversation authority
- **THEN** the decision is `Deny` even when the configured rule would allow it
  under a confirmed change
