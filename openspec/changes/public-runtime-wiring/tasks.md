# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase.

- [ ] **T001** [claims:runtime-wiring-types-are-public,provider-execution-is-constructible] Publish `RuntimeTools`, `RuntimeGate`, `RuntimeProvider`,
  `RuntimePolicy`, and `ProviderExecution` with public constructors —
  `crates/changeloop-app-server/src/executable.rs`,
  `crates/changeloop-app-server/src/lib.rs` — verify:
  `cargo test -p changeloop-app-server runtime_wiring`
- [ ] **T002** [claims:read-only-tools-refuse-mutation,read-only-gate-denies-writes-and-process-tools] Read-only constructors: `RuntimeTools::read_only`,
  `RuntimeGate::read_only` pin conversation authority and disable child/MCP
  discovery — `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-app-server runtime_wiring`
- [ ] **T003** [claims:read-only-gate-denies-writes-and-process-tools] Authority regressions for read-only constructors match existing
  conversation gate denials — `crates/changeloop-app-server/src/executable.rs` —
  verify: `cargo test -p changeloop-app-server runtime_wiring`
- [ ] **T004** [claims:workspace-build-stays-green] Workspace regression —
  verify: `cargo test --workspace`

## Deliberately not in this change

- Replacing `WorkspaceTools` / `HarnessGate` / `AdapterProvider` inside
  `changeloop-acp-runtime`. Tracked as D2 in the roadmap; see design follow-up.
