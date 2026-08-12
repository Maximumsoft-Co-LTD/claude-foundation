# Design

## Current state

- `metrics-runtime.mjs` emits `requests: events.length`, so no imported events
  appears as a measured numeric zero even though its top-level measurement says
  `operations-only`.
- `initialBudget()` initializes the active window with numeric zero request and
  token usage. `budgetDecision()` interprets either number as measured even while
  the lifetime fields and measurement source remain unavailable.
- Runtime phase telemetry recognizes Claude transcript context and the generic
  `FOUNDATION_SESSION_ID`, but ignores the available `CODEX_THREAD_ID`.
- Explicit telemetry import already accepts `--format codex`; it is the safe
  ingestion boundary because identity does not prove usage.

## Decisions

- **Decision:** Determine measurement truth from observed events and the recorded
  measurement source, not from initialized numeric counters.
  - **Why:** zero is meaningful only after an observation boundary ran.
  - **Rejected:** treating every initialized counter as measured, which recreates
    the current false-zero state.
- **Decision:** Keep budget window counters nullable until host events synchronize
  them; baseline arithmetic treats an absent baseline as zero only after events
  exist.
  - **Why:** this preserves arithmetic while making the pre-observation state legal.
  - **Rejected:** adding a second boolean whose value could drift from the counters.
- **Decision:** Use `CODEX_THREAD_ID` only as session correlation fallback for
  phase/context records and explicitly imported Codex events.
  - **Why:** the environment exposes identity but not trustworthy token totals.
  - **Rejected:** synthesizing a request or estimating tokens from the thread ID.

## Compatibility and migration

Existing state with numeric zero plus `measurement: unavailable-until-external-events`
is read as unmeasured. The next real telemetry import writes measured totals using
the existing state schema. Metrics JSON changes absent-event usage fields from `0`
to `null`; consumers already accept nullable token and cost fields, and tests pin
the new request semantics.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A real measured zero is mistaken for unknown | Require an observed-event measurement source; test zero-valued event fields separately | test |
| A Codex thread ID is treated as usage | Correlate identity only and require explicit events for counters | test |
| Existing telemetry import formats regress | Run telemetry contract and seam suites | compatibility |
