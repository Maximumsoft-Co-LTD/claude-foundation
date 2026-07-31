# Design

## Current state

Runtime API 7 and proof protocol 4 are unreleased on this branch. Agent plan
internally calls a noisy validator, pending-only dependency validation rejects
completed prerequisites, and task claim annotations are not validated. Packet
limits use compact JSON while stdout is pretty JSON. Repository packets retain
every task and global packets retain every claim. Context JSONL writes are
blocking and unbounded. Existing installations preserve a numeric 65,536-byte
policy. Six commonly co-triggered auth/backend skills total over 6,500 words.

## Decisions

- **Decision:** Keep API 7, introduce packet schema 4 and plan schema 2.
  - **Why:** API 7 has not shipped; output shapes do require explicit schema
    revisions.
  - **Rejected:** Incrementing an unreleased runtime API for every internal
    checkpoint.
- **Decision:** Default machine surfaces to compact JSON and offer `--pretty`.
  - **Why:** The byte budget must equal the actual handoff.
  - **Rejected:** Measuring compact JSON but emitting a larger representation.
- **Decision:** Degrade large collections to preview/digest/reference.
  - **Why:** A budget should bound context, not make a valid change impossible.
  - **Rejected:** Raising limits or forcing users to split behavioral claims.
- **Decision:** Preserve custom legacy policy and migrate only the exact former
  default.
  - **Why:** Project-owned configuration must not be overwritten.
  - **Rejected:** Replacing every numeric policy during install.
- **Decision:** Choose one primary construction skill plus required
  cross-cutting skills.
  - **Why:** Loading every applicable layer repeats guidance and inflates
    context.
  - **Rejected:** Removing security/observability triggers.

## Compatibility and migration

The installer recognizes the exact legacy default and rewrites only that value.
Custom numeric values remain supported with a doctor warning. Packet consumers
branch on schema version. Rollback is the prior runtime/config; persisted plans
and context events remain readable.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Machine consumers break on output changes | Schema version, compact JSON tests, compatibility docs | compatibility |
| Compaction hides needed authority | Task-scoped expansion plus path/digest references | review |
| Skill slimming lowers quality | Preserve checklists in focused references and run auth benchmark | review |
| Concurrent telemetry corrupts metrics | Best-effort atomic event files and tolerant reader | test |
