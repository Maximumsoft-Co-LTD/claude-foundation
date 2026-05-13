# Spec: <title>

**ID**: NNNN-type-slug
**Type**: feat | fix | refactor | chore | docs | spike
**Date**: YYYY-MM-DD
**Status**: draft | approved
**Ship as**: one-drop | staged   <!-- `staged` is the ONLY thing that unlocks epic split. Default one-drop. -->
**Parent**: none | <parent-id>   <!-- set when this spec is a slice of an epic, else `none` -->
**Open PR on ship**: yes | no    <!-- user decision; orchestrator asks once and records it here -->

## Goal
One sentence describing what "done" looks like.

## Users
Who uses this and in what context.

## Scope
**In**:
- ...

**Out (non-goals)**:
- ...

## Acceptance criteria
Observable behaviours. `engineer` ticks these as they land; `lead` re-checks during review; `qa` maps each to a specific test in `tests.md`.

- [ ] Observable behaviour 1
- [ ] Observable behaviour 2

## Reproduction <!-- REQUIRED for type=fix; delete this section for other types -->
Concrete steps to make the bug happen on the pre-fix code. The regression test in `plan.md` must encode these steps.

1. ...
2. ...
**Expected**: ...
**Actual**: ...

## Timebox <!-- REQUIRED for type=spike; delete for other types -->
Hard ceiling for exploration. When hit, write `recommendations.md` even if questions remain.

- **Limit**: e.g., 1 day / 4 hours
- **Deliverable**: `recommendations.md` with at least one named next action

## Constraints
Tech stack (new project) OR integration points (existing code). Deadlines, dependencies, compliance.

## Carried-over follow-ups
Items from `.workflow/FOLLOWUPS.md` that this run is consuming. Leave empty if none.

- ...

## Open questions
Things to confirm before planning. Empty when status = `approved`.
