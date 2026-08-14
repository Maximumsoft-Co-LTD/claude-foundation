# Design

## Current state

- `syncClaudeTelemetry(id, options)` (`observability/telemetry-runtime.mjs:391`)
  resolves the transcript from an explicit source or
  `FOUNDATION_CLAUDE_TRANSCRIPT_PATH`, imports incrementally with persisted
  cursors, and already tolerates a missing transcript by returning
  `{ imported: 0 }` (quietly with `quiet: true`).
- Its only callers are the manual `telemetry-sync` CLI route and a
  pre-operation drain for already-known sessions. Nothing in
  `runtime/workflow/` calls telemetry at all.
- `archive(id)` (`workflow/apply-runtime.mjs:393–539`) has a natural
  pre-destructive window after the pending-tasks gate (:489) and before
  `captureSpecSyncInputs`/`openspec archive` (:494–498), and an existing
  warning cluster just before `ARCHIVED` (:533–536).
- The harness test fixture unsets `FOUNDATION_CLAUDE_TRANSCRIPT_PATH` and
  `FOUNDATION_CLAUDE_SESSION_ID`, so any archive-time sync must be silent when
  unbound — which the existing early return already guarantees.

## Decisions

- **Decision:** call `syncClaudeTelemetry(id, { quiet: true })` in `archive()`
  after the pending-tasks gate and before spec-sync capture, wrapped so any
  thrown error degrades to a warning.
  - **Why:** last point where telemetry is still attributable to an active
    change and nothing irreversible has happened; a telemetry failure must
    never cost an archive.
  - **Rejected:** syncing in `landCheck` (runs three routes and must stay
    read-only); a post-archive sync (change already archived, attribution
    ambiguous).
- **Decision:** warn at the existing end-of-archive warning cluster when the
  change still has zero imported model-usage rows, naming
  `claude-foundation telemetry sync <change> [transcript]`.
  - **Why:** the round ledger's empty cost columns become a stated fact with a
    remedy, at the moment the record is sealed.
- **Decision:** thread `syncClaudeTelemetry` and a usage probe into
  `createApplyRuntime` via factory params (wiring-check enforced), not via a
  module import.
  - **Why:** composition-root discipline; telemetry stays an injected
    observability dependency.

## Compatibility and migration

Additive archive-path behavior; no wire formats, pins, or CLI surface change.
Rollback is removing the call and the warning.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Telemetry failure blocks archive | try/catch degrades to warning; contract test archives with no transcript bound | test |
| Double-import on resumed archive | sync is cursor-based and idempotent by construction | test |
