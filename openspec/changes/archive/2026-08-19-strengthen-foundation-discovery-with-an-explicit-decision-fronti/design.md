# Design

## Current state

- `brainstorming` already resolves repository facts itself and asks
  prerequisite-ready material decisions in rounds.
- `grill-task-gu` already requires full source discovery and one Decision Sheet,
  but it does not say how conditional dependent choices fit that sheet.
- `/feature` invokes `grill-task-gu`; `/change` owns the durable OpenSpec packet.
- The interview capture format preserves `call_seq`, so tests can distinguish
  questions asked in the same round from questions deferred to a later round.

## Decisions

- **Decision:** Keep one private dependency tree during discovery and persist
  only its compact agreement and locked answers in existing OpenSpec artifacts.
  - **Why:** OpenSpec remains the durable agreement and `tasks.md` the sole
    ledger; a tree or interview ledger would create competing truth.
  - **Rejected:** A new decision-tree artifact or lifecycle phase.
- **Decision:** Restrict successive question rounds to pre-lifecycle
  brainstorming. Feature intake presents dependency-aware alternatives and
  dependent effects in one finalized Decision Sheet.
  - **Why:** This preserves the existing single-gate contract without asking a
    dependent decision before its prerequisite is understood.
  - **Rejected:** An unbounded or one-question-at-a-time feature interview.
- **Decision:** Reuse a prior compact agreement and every locked answer in
  `/change`; retain only the existing audited batched contradiction amendment.
  - **Why:** Routine re-asking weakens the lock and can produce inconsistent
    answers across artifacts.
  - **Rejected:** Reconfirming settled decisions at every lifecycle boundary.

## Compatibility and migration

No CLI, runtime, protocol, persisted-data, command, or `grounding.yaml` shape
changes. Existing active changes and locks remain valid. Consumers receive the
new behavior on their next installation of the shipped instruction files.
Rollback restores the three instruction files and their assertions; no stored
state requires migration.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A second approval gate is accidentally permitted | Pin the boundary between multi-round brainstorming and one finalized feature sheet | test, review |
| Conditional alternatives omit dependent effects | Require effects in the sheet and assert the cross-skill contract | test, review |
| Added wording exceeds a skill context budget | Run existing individual and aggregate skill budgets | test |
