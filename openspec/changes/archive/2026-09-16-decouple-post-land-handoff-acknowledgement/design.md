# Design

## Current state

A post-land safe-before-activation operation blocks Land until a named actor records accepted status and a tracking reference; handoffs are inspectable only by known change ID.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| `none` | This change introduces no project-specific term. | `none` |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** A valid post-land safe-before-activation declaration is non-blocking without accepted status, actor, or tracking reference.
  - **Why:** The user owns the semantic decision, the agent owns coding, and the harness owns bookkeeping and lifecycle automation.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** Pre-land and activation-coupled operations require valid completed evidence unless an enforceable activation boundary makes the merged artifact safely inactive.
  - **Why:** Removing acknowledgement must not weaken activation safety.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** Archived changes retain discoverable operational obligations that can be completed, cancelled, or superseded without reopening implementation tasks.
  - **Why:** Post-deployment work belongs to an operational lifecycle rather than the implementation ledger.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

Continue reading accepted and completed version-1 handoff records. Keep pre-land and activation-coupled operations fail-closed. Preserve existing handoff status, packet, and record commands while adding non-blocking dispositions and an aggregate list command.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| none | none | none |
