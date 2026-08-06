## ADDED Requirements

### Requirement: Cache resources register only when owned

The system SHALL NOT register `ResourceKind::Cache` at project open unless a
[`BoundedResourceCache`] (or other cache owner) is actually attached to that
registration.

#### Scenario: no placeholder cache registration at project open

- **WHEN** a managed project is opened
- **THEN** no `ResourceKind::Cache` slot named `"provider-tool-cache"` is
  registered

#### Scenario: baseline resource count excludes unused cache

- **WHEN** a project finishes an execution and releases its transient resources
- **THEN** the remaining owned-resource count reflects only real registrations
  (database, watcher, MCP, LSP, formatter, job — six at open today)

### Requirement: BoundedResourceCache remains available for future wiring

The system SHALL keep [`BoundedResourceCache`] in `changeloop-project` with its
existing disposal and eviction behaviour.

#### Scenario: bounded resource cache still tested in project crate

- **WHEN** the project crate disposal tests run
- **THEN** capacity eviction, explicit removal, and dispose-drain behaviour pass
