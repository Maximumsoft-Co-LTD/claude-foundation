# Design

## Current state

- `changedSurfaceIssues(id)` (`runtime/evidence/proof-readiness.mjs:82–103`)
  fires only for multi-repository changes and already lists every offending
  path in its blocker string:
  `repository '<id>' changed outside task paths: a, b, …`.
- `proofPreflight` renders blockers plus `recoveryLines(next)`; recovery
  entries already carry copy-paste channels (`wiring.command`,
  `request.command`, `choices[].instruction`), deduped before printing.
- `/build` (`.claude/commands/build.md`) tells the agent to update the ledger
  but never says a new test file must be declared the moment it is created;
  the Hydra round paid for that gap with 10 readiness blocks.
- Single-repository changes use different mechanisms (apply-time deletion
  guard, snapshot filter) and are out of scope.

## Decisions

- **Decision:** attach the fix-it to the existing readiness `next`/recovery
  channel for the changed-surface blocker, rendering the undeclared paths as a
  ready-to-paste `[paths:...]` annotation grouped by repository.
  - **Why:** the render pipeline and dedup already exist; readiness stays the
    single source of recovery text.
  - **Rejected:** auto-editing `tasks.md` (the ledger is agent-written by
    contract); a new output section (second vocabulary for the same recovery).
- **Decision:** regression at the lowest boundary — a Node `node:test` suite
  that instantiates the proof-readiness factory with stubbed dependencies and
  asserts the fix-it text for a synthetic multi-repo state, wired per the
  repo's `test-discovery` + TAP pattern.
  - **Why:** the formatting decision lives in one function; a full git
    multi-repo fixture proves nothing extra about it and costs minutes.
  - **Rejected:** extending `contracts/multi-repository.sh` (overlaps the
    region another active change already edits; higher land-conflict cost).
- **Decision:** one added sentence in `/build` requiring new test files to be
  declared in the owning task's `[paths:]` in the same step that creates them.
  - **Why:** prevents the drift at the source; one sentence fits the command's
    context budget.

## Compatibility and migration

Output-only addition to readiness recovery text; no wire format, packet, or
protocol pin changes. `/build` text change is instruction-lane; context budget
checked by the existing docs suites.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Fix-it misformats paths with spaces/commas | Unit suite covers formatting edge cases | test |
| Command text growth breaks context budget | run-all.sh docs/context-budget suites | test |
