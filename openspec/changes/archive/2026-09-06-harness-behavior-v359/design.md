# Design

## Current state

Build and proven targets are projected as DELIVERED; internal worker waits appear external; diagnostics and resume projections need bounded truthful context.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| `none` | This change introduces no project-specific term. | `none` |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Add TARGET_REACHED for build/proven and reserve DELIVERED for archived, preserving machine action DONE.
  - **Why:** User authorized implementation of the harness plan and v3.5.9 release; this corrects the reproduced projection mismatch with versioned compatibility.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

Preserve existing command names, arguments, DONE/reached/completed fields. Add versioned TARGET_REACHED user state and version new projection fields. Keep telemetry observations separate from lifecycle authority.

Advance protocol 5 and lifecycle outcome 2 distinguish target completion from
delivery. Runtime API 32, packet schema 11, feedback schema 3 and dashboard
snapshot schema 3 identify the changed consumer projections. Existing command
names and machine DONE/reached/completed/next fields retain their meanings.
Inspection rejects combinations with execution/import flags before side effects.

Required review preparation reuses the existing proof chain, including request
deduplication and policy enforcement. Configured reviewer handoffs remain
harness-owned; actual acceptance and authority decisions retain their complete
decision payload. Build-only targets never start this proof preparation.

## Conformance boundaries and evidence

| Boundary | Implementation and deterministic evidence |
| --- | --- |
| Native host behavior | The shipped adapters/host-capabilities.json remains canonical. host-capability-matrix.test.mjs checks truthful declarations; it is not a live-host execution test. |
| Observation import | host-execution-contract.test.mjs proves first accepted observation wins even when duplicate payloads conflict, and historical usage remains observable without lifecycle authority. Existing provenance/telemetry suites verify append deduplication. |
| Task acceptance | lease-acquisition-helpers.test.mjs checks owner, lease ID, fencing generation, contract/graph revision, scoped writes and locked release; agent-dispatch.test.mjs checks restart with live and expired leases. |
| Ownership and recovery | delivery-convergence.test.mjs and advance-runtime.test.mjs cover internal versus external waits, returned operation decisions, setup re-entry and semantic progress without a fixed product retry cap. |
| Read-only consumer behavior | delivery-convergence.test.mjs installs a real consumer and compares runtime, snapshot, lease, receipt, evidence, plan, instruction, authority and transaction files across inspection calls. It also exercises amendment, live lease, wiring and base movement across processes. |
| Archived and partial Land resume | Retained archive references never claim a current removed workspace. Tests cover the packet factory without workspace access and preserve the partial Land action without applying again; existing Land recovery suites own transaction replay correctness. |
| Dashboard freshness | snapshot.test.mjs distinguishes recorded results from live workspace validity, including code-only changes. |

Lease expiry does not prove a native process stopped. Runtime fencing constrains
accepted results; it does not provide operating-system process isolation.
Claude Code and OpenCode have their declared hook/plugin guards; Codex and
Cursor retain final-audit-only phase enforcement without an equivalent host
boundary. This change adds no live-host parity claim, model caller, or handshake.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| none | none | none |
