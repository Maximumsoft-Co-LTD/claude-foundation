# Change: ติดตั้ง ux-ui-principles จาก hashtagf/skills และถอน gridgeist ออกจาก Change Loop

- **Change:** `ux-ui-principles-hashtagf-skills-gridgeist-change-loop` · **Lane:** rapid (low risk; see Impact)
- **Owner:** unassigned · **Created:** 2026-10-09 · **Status:** `claude-foundation changes`

## Scope

- **In scope (`change`):** ส่งมอบ ux-ui-principles พร้อม workflow และ resources ที่ใช้งานได้โดยไม่พึ่ง repo ต้นทาง; แยกหลักการ UX/UI ออกจากการค้น design intelligence และการลงมือทำ frontend; ถอนเฉพาะไฟล์ gridgeist ที่เป็น managed ระหว่าง upgrade โดยรักษา custom consumer files
- **Out of scope:** edits outside `.claude/skills/ux-ui-principles/**`, `.claude/skills/gridgeist/**`, `.claude/skills/frontend-design/SKILL.md`, `.claude/skills/ui-ux-pro-max/SKILL.md`, `.claude/skills/ui-ux-pro-max/references/experience-workflow.md`, `.claude/skills/skill-evaluation/references/evaluation-cases.json`, … +4 more

## Work type

docs

## Acceptance traceability

Tasks and checks: `tasks.md`. Evidence: static-analysis.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| ux-ui-skill-bundle | unclassified | T001 | .claude/tests/harness/run-installer-tests.sh |
| ux-ui-routing | unclassified | T001 | .claude/tests/harness/run-installer-tests.sh |
| retired-grid-skill | unclassified | T001 | .claude/tests/harness/run-installer-tests.sh |

## Definition of done

- Fresh evidence for every claim (3).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Specs:** none; docs-only work modifies no living spec
