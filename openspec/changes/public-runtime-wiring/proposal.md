# Change: public runtime wiring

## Why

`changeloop-app-server` owns the authoritative `RuntimeTools`, `RuntimeGate`, and
`RuntimeProvider` wiring, but those types are private. The ACP driver assembles a
parallel read-only runtime from public crates (`WorkspaceTools`, `HarnessGate`,
`AdapterProvider`), duplicating the same authority model in three places. Two
wirings for one policy surface increases drift risk whenever gate logic or tool
authority changes.

## What changes

- Export `RuntimeTools`, `RuntimeGate`, and `RuntimeProvider` from
  `changeloop-app-server` with public constructors.
- Add read-only constructors that fix `LifecycleAuthority::Conversation`, disable
  subagent/MCP discovery, and refuse mutation capability.
- Export the minimal supporting types (`RuntimePolicy`, `ProviderExecution`) needed
  to construct a provider and gate from outside the app-server crate.
- Add regression tests that the read-only constructors produce the same authority
  denials the existing in-crate gate tests already assert.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** `changeloop-app-server` public API, future ACP migration
- **Security triggers:** authority wiring at the tool/permission boundary

## Non-goals

- Migrating `changeloop-acp-runtime` to the new surface in this change. That is
  tracked as D2 and may require reconciling the ACP tool schema with the full
  app-server tool surface.
- Changing gate policy semantics or expanding ACP write capability.
