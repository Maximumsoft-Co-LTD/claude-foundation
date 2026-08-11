# Design

## Current state

- `change validate` already parses requirement sections to protect existing
  capabilities from scenario loss inside `MODIFIED Requirements`.
- The parser knows the delta capability path and the canonical
  `openspec/specs/<capability>/spec.md` location, but it currently skips a
  capability when that canonical file is absent.
- OpenSpec rejects `MODIFIED` and `REMOVED` operations for a capability with no
  canonical specification. Today that rejection arrives during archive.

## Decisions

- **Decision:** Extend the existing pure spec-delta validation in
  `change-validation.mjs` and invoke it from `change validate`.
  - **Why:** This is the earliest deterministic boundary that already owns
    OpenSpec delta correctness and runs before Build.
  - **Rejected:** Calling the OpenSpec archive command as a preflight, because
    archive is mutating and would couple validation to rollback behavior.
- **Decision:** Report every offending section and capability in one failure.
  - **Why:** Authors should be able to repair the contract in one pass.
  - **Rejected:** Failing on only the first heading, which creates avoidable
    validate/edit loops.

## Compatibility and migration

No persisted shape or protocol changes. Existing valid deltas retain the same
behavior. A previously accepted but unarchivable delta now fails earlier.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A parser mistake rejects a valid new capability | Inspect only requirement section headings and cover `ADDED` success plus `MODIFIED`/`REMOVED` failures | test |
| A nested spec path is mapped to the wrong capability | Reuse the first path segment convention already used by scenario-loss validation | test |
