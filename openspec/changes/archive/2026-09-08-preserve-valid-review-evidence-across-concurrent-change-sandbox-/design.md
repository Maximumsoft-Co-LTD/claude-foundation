# Design

## Current state

none

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| `none` | This change introduces no project-specific term. | `none` |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Implement the first delivery slice of the approved concurrent-change review efficiency plan; defer new impact-review routes until measured need.
  - **Why:** User approved the plan and requested implementation; reuse existing review and proof machinery.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** Preserve review policy, immutable attempt history, acceptance authority, explicit Land and separate Git authority.
  - **Why:** Efficiency must not reset review limits or infer approval.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** Extend contribution identity to copy sandboxes conservatively under the existing diff-and-packet review reuse contract; fail closed for incomplete or ambiguous composite bindings and do not introduce automatic dependency narrowing.
  - **Why:** Existing worktree reuse already has this contract; new impact analysis is deferred and must not be implied by identity equality.
  - **Rejected:** none
  - **Consequences:** No consequence beyond the bounded change
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

none

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| none | none | none |
