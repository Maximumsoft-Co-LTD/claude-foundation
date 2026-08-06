# Change: install force dispose in CLI

## Why

`ForceDisposeSignalGuard` is installed only in `run_tui`. Headless conversation
paths (`ask`, `run`, bare prompt), change-control RPCs, `serve`, and `acp` can
spawn projects, tools, MCP servers, and lifecycle children, but a termination
signal or panic that bypasses `Drop` leaves them registered until the kernel
reaps the process.

The TUI bootstrap already chains the service's force-dispose registry onto the
process-wide backstop. CLI entry points that open an `AppService` must do the
same; `acp` must at least install the process backstop because it does not open
a service.

## What changes

- Extract the TUI bootstrap into a reusable helper that installs
  `ForceDisposeSignalGuard::install_with_panic_hook` and, when an
  `AppService` is present, enrols its force-dispose registry with
  `process_force_dispose`.
- Call that helper at the start of headless, headless-control, and `serve`
  entry points after `open_service`.
- Call the process-only bootstrap at the start of `acp`.
- Refactor `run_tui` to use the same helper so semantics stay one place.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** CLI entry points, app-server bootstrap helper
- **Security triggers:** resource containment on abnormal process exit

## Non-goals

- Changing disposal semantics inside `changeloop-project` or the TUI loop.
- Installing the guard on operational commands that never open a service
  (`prove`, `doctor`, `setup`, etc.).
- OS sandbox containment work tracked separately as Track C1.
