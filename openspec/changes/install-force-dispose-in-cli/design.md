# Design

## Current state

- `ForceDisposeSignalGuard` lives in
  `crates/changeloop-app-server/src/force_dispose.rs` and registers
  SIGHUP/SIGINT/SIGTERM handlers plus a chained panic hook.
- `run_tui` in `executable.rs` is the only caller of
  `install_with_panic_hook`. It also enrols `AppService::force_dispose` with
  `process_force_dispose` via `register_guarded`.
- CLI paths that matter:
  - `headless` / `headless_control` / bare prompt → `open_service` then wire RPC
  - `serve` → `open_service` then stdio/unix/http surface
  - `acp` → `changeloop_acp::serve_stdio` with no `AppService`
  - `tui` → `open_service` then `run_tui` (already bootstrapped inside)

## Decisions

- **Decision:** add `BootstrapForceDispose` in `force_dispose.rs` with two
  entry points: `install_with_service_disposer(Arc<ForceDispose>)` and
  `install_process_only()`.
  - **Why:** keeps signal/panic installation next to the guard type and avoids
    a circular dependency on `AppService` from `executable.rs`.
  - **Rejected:** duplicating the enrolment block in each CLI function; that is
    how TUI-only coverage happened.

- **Decision:** install the service bootstrap immediately after a successful
  `open_service` in each affected async entry, holding the guard for the
  function's lifetime.
  - **Why:** matches TUI ownership — bootstrap outlives the service work and
    uninstalls handlers when the entry returns.
  - **Rejected:** installing inside `open_service` itself, which would double-
    install when `run_tui` also bootstraps after the same `open_service`.

- **Decision:** `acp` installs process-only bootstrap because it never opens
  `AppService`.
  - **Why:** still registers panic/signal backstop for anything enrolled with
    `process_force_dispose` during the session driver.
  - **Rejected:** constructing a throwaway `AppService` just to enrol disposal.

## Compatibility and migration

Non-breaking for operators. Behavior change is confined to abnormal exit paths
(signals, panics). Happy-path `Drop` disposal is unchanged.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Double signal-handler registration if a future entry nests bootstraps | helper is called once per entry; TUI keeps bootstrap inside `run_tui` only | test |
| Service children still leak on signalled headless run | integration test: bootstrap + `AppService` + SIGTERM releases registered children | test |
| ACP path skips service enrolment and leaves ACP-owned resources unlinked | document as intentional; process backstop still runs | spec |
