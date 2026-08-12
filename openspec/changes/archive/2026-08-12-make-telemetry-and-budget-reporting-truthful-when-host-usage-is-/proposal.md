# Change: Make telemetry and budget reporting truthful when host usage is unavailable, and correlate Codex sessions without inventing measured zero usage

## Why

Metrics currently report zero requests when no host telemetry was ingested, while
the active budget window treats its initialized zero as measured usage. In this
session that made a real Codex run appear to consume no requests or tokens. The
harness must preserve unknown usage as unknown and correlate an available Codex
thread identity without claiming usage it did not observe.

## What changes

- Metrics distinguish an unavailable measurement from a measured zero.
- Budget decisions remain unmeasured until at least one real host event exists.
- Codex thread identity can correlate phase and imported telemetry records, but
  identity alone never creates a usage event.
- Existing Claude, generic, Cursor, OpenTelemetry, and explicit Codex imports
  retain their current normalized event contract.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** telemetry normalization, metrics JSON, persisted budget state
- **Security triggers:** none

## Non-goals

- Automatically discovering private Codex transcript storage.
- Reconstructing token usage from conversation text or elapsed time.
- Changing budget limits, pricing, or model-selection policy.
- Packet sizing, proof readiness, capability inference, and test discovery; those
  remain separate changes.
