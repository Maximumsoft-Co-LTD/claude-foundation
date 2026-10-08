# Change: ตรวจและแก้คำสั่งขัดกันใน skills และเอกสารอ้างอิงหลังนำแนวคิด pstack มาใช้ โดยปรับ workflow ที่เกี่ยวข้องทั้งชุดให้ตรงกับ Change Loop

- **Change:** `skills-pstack-workflow-change-loop` · **Lane:** rapid (low risk; see Impact)
- **Owner:** unassigned · **Created:** 2026-10-08 · **Status:** `claude-foundation changes`

## Scope

- **In scope (`skill-contract-consistency`):** ใช้ agreement, isolation, task ownership, proof
- **Out of scope:** edits outside `.claude/skills/**`, `.claude/tests/docs/**`

## Work type

docs

## Acceptance traceability

Tasks and checks: `tasks.md`. Evidence: static-analysis.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| agreement-isolation-task-ownership-proof › agent-refactoring-git-g | unclassified | T001 | — |
| agreement-isolation-task-ownership-proof › agent-skill-authoring-e | unclassified | T001 | — |
| agreement-isolation-task-ownership-proof › agent-requirement-proof | unclassified | T001 | — |

## Definition of done

- Fresh evidence for every claim (3).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Specs:** none; docs-only work modifies no living spec
