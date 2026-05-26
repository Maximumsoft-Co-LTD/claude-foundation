# Spec: <title>

**ID**: NNNN-type-slug · **Type**: feat | fix | refactor | chore | docs | spike · **Status**: draft | approved · **Ship as**: one-drop | staged · **Open PR on ship**: yes | no · **Parent**: none | <parent-id>

<!--
Keep Goal + Acceptance criteria always. All other sections are optional — include when they apply, DELETE entirely when they don't. No empty headers, no "N/A".
For unresolved bits, embed `[NEEDS CLARIFICATION: <who> — <what>]` inline AT THE SPOT it matters. Spec cannot reach `Status: approved` while any marker remains.
-->

## Goal
One sentence: what "done" looks like.

## Acceptance criteria
Observable behaviours. Edges live as sub-bullets under the AC they edge.

- [ ] AC1: <observable behaviour>
  - Edge: <only when it changes design>

---

## Problem
<!-- Include when work affects user outcomes / business metrics / unblocks capability. -->
Who hurts, how often, what's the impact.

## Users
<!-- Include when multiple actors or audience is non-obvious from Goal. -->

## User journey
<!-- Include for `feat` with multi-screen UI. Tag each step `[→ AC#]`. -->
1. ...

## Scope — Out
<!-- Include when adjacent features could be wrongly assumed in-scope. -->
- ...

## Non-functional requirements
<!-- Include when there's a measurable target outside the AC. Each line: `<attribute>: <target> — measured: <how>`. No aspirational text. -->
- p95 GET /endpoint < 50ms — measured: `ab -n 1000 /endpoint`

## Definition of Done
<!-- Include when ship needs steps outside writing code. Each item names a concrete artifact plan.md must deliver. -->
- [ ] Telemetry: <metric name>
- [ ] Docs: <path>
- [ ] Rollback: <flag name>

## Reproduction
<!-- Required for `Type=fix`. -->
1. ...
**Expected**: ... · **Actual**: ...

## Timebox
<!-- Required for `Type=spike`. -->
- **Limit**: <e.g., 1 day>
- **Deliverable**: `recommendations.md` with one named next action.

## Constraints
<!-- Include when tech-stack lock / integration boundary / compliance / BC window bounds WHAT we can build. -->
- ...

## Discovery notes
<!-- Include when fanout ran or pre-spec research changed requirements. -->
- Codebase: ...
- Best practice: ...

## Carried-over follow-ups
<!-- Include when this run consumes `FOLLOWUPS.md` items. -->
- F-NNN: <item>
