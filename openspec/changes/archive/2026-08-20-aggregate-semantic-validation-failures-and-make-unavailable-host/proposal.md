# Change: Make validation and unavailable telemetry actionable

## Why

`change validate` still stops at the first independent semantic claim or task
error, forcing avoidable edit/validate cycles. Metrics truthfully preserve
unknown host usage, but `usageMeasurement: unavailable` does not say why the
measurement is absent or which supported import path can recover it.

## What changes

- Report all independent claim-contract errors in one validation result.
- Report all independent task-to-claim and multi-repository scope errors in one
  validation result after their prerequisites are valid.
- Add a structured usage-availability reason and supported recovery actions to
  metrics without synthesizing requests, tokens, or cost.
- Keep existing telemetry import formats, budget semantics, and fail-closed
  validation ordering compatible.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** change validation, phase-context telemetry, metrics JSON,
  telemetry guidance, focused harness tests
- **Security triggers:** none

## Non-goals

- Inventing model usage that the host did not emit.
- Adding unavailable Codex or OpenCode lifecycle hooks.
- Publishing a release or changing Homebrew state.
