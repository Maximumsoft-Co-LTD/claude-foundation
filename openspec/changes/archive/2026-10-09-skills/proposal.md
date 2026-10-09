# Change: ปรับโครงสร้างเอกสารอ้างอิงของ skills ให้มีสารบัญและอ้างหัวข้อปัจจุบันอย่างถูกต้อง

- **Change:** `skills` · **Lane:** rapid (low risk; see Impact)
- **Owner:** unassigned · **Created:** 2026-10-08 · **Status:** `claude-foundation changes`

## Scope

- **In scope (`skill-reference-structure`):** มีสารบัญพร้อมลิงก์หัวข้อภายในไฟล์; ใช้ขอบเขตการเรียกใช้และหัวข้อที่สอดคล้องกับ skill ปัจจุบัน
- **Out of scope:** edits outside `.claude/skills/concurrency-fundamentals/references/shared-state-and-async.md`, `.claude/skills/ddd-strategic/references/aggregate-design.md`, `.claude/skills/delivery-engineering/references/pipeline-and-deploy.md`, `.claude/skills/hexagonal-backend/references/go.md`, `.claude/skills/hexagonal-backend/references/typescript.md`, `.claude/skills/hexagonal-backend/references/patterns-and-pitfalls.md`, … +3 more

## Work type

docs

## Acceptance traceability

Tasks and checks: `tasks.md`. Evidence: static-analysis.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| reference-navigation | unclassified | T001 | — |
| hexagonal-reference-alignment | unclassified | T001 | — |

## Definition of done

- Fresh evidence for every claim (2).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Specs:** none; docs-only work modifies no living spec
