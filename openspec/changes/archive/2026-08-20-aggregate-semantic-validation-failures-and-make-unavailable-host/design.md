# Design

## Current state

Validation already aggregates structural preflight failures, then runs semantic
checks in dependency order. Claim and task loops call `fail` inside each branch,
so only their first independent error is visible. Metrics preserve unknown usage
as `null`, while explicit Claude, Codex, Cursor, OTEL, generic, and host-result
imports already exist; only Claude transcript discovery is automatic because
the other installed adapters expose no equivalent lifecycle hook.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| validation layer | Checks whose inputs are already valid and which can safely report together | run every check after malformed input |
| usage availability | Structured explanation of whether host usage was observed and how it may be recovered | treating unknown as zero |

## Decisions

- **Decision:** Aggregate only errors within dependency-safe claim and task layers.
  - **Why:** This removes serial correction loops without dereferencing malformed
    artifacts or weakening fail-closed ordering.
  - **Rejected:** Catching arbitrary thrown validation errors and continuing,
    because later checks may rely on invalid inputs.
- **Decision:** Project an availability object from observed events and phase
  correlation; do not generate telemetry events.
  - **Why:** Host absence is an operational state, not evidence of usage.
  - **Rejected:** Counting lifecycle commands as model requests.

## Compatibility and migration

The metrics object gains one additive field. Existing numeric/null fields,
usageMeasurement, event normalization, import commands, and packet schemas stay
unchanged. Validation retains non-zero exit behavior and existing message text
inside a multi-line layer summary.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Aggregation hides the exact cause | Preserve each existing diagnostic as a separate list item | test |
| Recovery guidance names an unsupported route | Derive commands only from package-owned supported import surfaces | test |
| Unknown usage becomes measured accidentally | Assert no event is created and requests/tokens/cost remain null | test |
