# Change: Implement the H1–H5 harness behavior plan for v3.5.9

## Why

Make partial completion truthful, resume and recovery ownership reliable, and diagnostic/context projections safe and current.

## What changes

- The user projection distinguishes TARGET_REACHED from DELIVERED while preserving DONE and reached machine fields.
- Current lease fencing rejects stale results, active workers are not duplicated, and telemetry cannot complete lifecycle work.
- Internal waits stay harness-owned and recovery reuses ready work while actual external dependencies retain external ownership.
- Read-only projections expose truthful target, delivery, owner, freshness and availability; diagnostic exports use allowlisted non-sensitive fields.
- A bounded packet derived from current state provides the task frontier, decisions, leases, findings and next route without claiming stale context or dispatching duplicate work.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:**

## Non-goals

- none
