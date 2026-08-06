# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase.

- [ ] **T001** [claims:service-bootstrap-links-to-process-registry,signalled-service-children-release-without-drop] `BootstrapForceDispose` helper with service and process-only entry points —
  `crates/changeloop-app-server/src/force_dispose.rs`,
  refactor `run_tui` in `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-app-server force_dispose`
- [ ] **T002** [claims:headless-entry-installs-force-dispose,serve-entry-installs-force-dispose,acp-entry-installs-process-force-dispose] Install bootstrap in CLI headless, headless-control, serve, and acp
  entry points —
  `crates/changeloop-cli/src/main.rs` — verify:
  `cargo test -p changeloop-cli`
- [ ] **T003** [claims:signalled-service-children-release-without-drop] Regression: bootstrapped service releases project children on SIGTERM
  without `Drop` —
  `crates/changeloop-app-server/src/force_dispose.rs` — verify:
  `cargo test -p changeloop-app-server signalled_service`
