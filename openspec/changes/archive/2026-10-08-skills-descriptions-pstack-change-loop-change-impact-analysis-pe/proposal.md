# Change: ปรับปรุง skills ทั้งชุดและ descriptions โดยนำแนวคิดจาก pstack มาใช้กับ Change Loop เพิ่ม change-impact-analysis, performance-investigation, skill-evaluation และ skill-suite-auditor โดยรักษา lifecycle และ authority ของ harness

- **Change:** `skills-descriptions-pstack-change-loop-change-impact-analysis-pe` · **Lane:** rapid (low risk; see Impact)
- **Owner:** unassigned · **Created:** 2026-10-08 · **Status:** `claude-foundation changes`

## Scope

- **In scope (`harness-native-skills`):** มี descriptions ที่ระบุงาน จุดเรียก และขอบเขต; เพิ่มการวิเคราะห์ผลกระทบ การสืบค้น performance
- **Out of scope:** edits outside `.claude/skills/**`, `.claude/rules/fundamentals.md`, `.claude/tests/**`, `README.md`, `README.th.md`

## Work type

docs

## Acceptance traceability

Tasks and checks: `tasks.md`. Evidence: static-analysis.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| descriptions-harness › agent-skill | unclassified | T001 | .claude/tests/** |
| descriptions-harness › agent-skill-build-prove | unclassified | T001 | .claude/tests/** |
| performance-skill-skills-lifecycle-proof › 1 | unclassified | T001 | .claude/tests/** |
| performance-skill-skills-lifecycle-proof › 2 | unclassified | T001 | .claude/tests/** |

## Definition of done

- Fresh evidence for every claim (4).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Specs:** none; docs-only work modifies no living spec
