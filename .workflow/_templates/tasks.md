# Tasks: <title>

**Plan**: [./plan.md](./plan.md) · **Spec**: [./spec.md](./spec.md)
**Status**: draft | approved | done

> **For humans** — each `- [ ]` is one build step, in order; read the action + its `verify:`. The `T001`/`[P]`/`[AC1]`/`path#anchor` codes are for the build agents. `🎯` = smallest shippable slice.

Phased + dependency-ordered. `[P]` = parallel-safe (different files, no unmet dependency). `[AC#]` ties the task to the acceptance scenario it delivers/verifies (`[DoD]` / `[SC-###]` for a Definition-of-Done or measurable-outcome task). MVP = the Phase 3 (P1) block.

Task format: `T### [P?] [AC#] <action> — path#anchor (new | edit | delete) — verify: <command or observable>`

## Phase 1: Setup

- [ ] **T001** Scaffold project + tooling — `path` (new) — verify: <command>
- [ ] **T002** [P] <parallel-safe setup task> — `path` (new) — verify: <command>

## Phase 2: Foundational (blocks all stories)

- [ ] **T003** <shared model / core the stories depend on> — `path#anchor` (new) — verify: <command>

## Phase 3: US1 — <title> (P1) 🎯 MVP

- [ ] **T004** [AC1] <action> — `path#anchor` (new) — verify: `<test that asserts AC1>`
- [ ] **T005** [AC2] <boundary / on-error action> — `path#anchor` (edit) — verify: `<test that asserts AC2>`

**Checkpoint** — US1 testable on its own. Shippable MVP.

## Phase 4: US2 — <title> (P2)

- [ ] **T006** [AC3] <action> — `path#anchor` (edit) — verify: `<test>`

## Phase 5: Polish

- [ ] **T007** [P] [SC-001] <measurable-outcome check> — observe — verify: <observable>

---
*Dependencies: Phase 2 blocks the story phases; within a story model→component→wiring. `[P]` tasks touch different files. Every AC has ≥ 1 delivering+verifying task; list the AC→task coverage at the bottom. Format + parallel-phase contract → **lead.md > Mode A** · **plan-writing**.*
