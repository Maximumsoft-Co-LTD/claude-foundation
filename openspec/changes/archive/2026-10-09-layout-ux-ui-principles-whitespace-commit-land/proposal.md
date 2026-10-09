# Change: ปรับบรรทัดท้ายไฟล์ layout ของ ux-ui-principles ให้ผ่านการตรวจ whitespace ก่อน commit งานที่ Land แล้ว

- **Change:** `layout-ux-ui-principles-whitespace-commit-land` · **Lane:** rapid (low risk; see Impact)
- **Owner:** unassigned · **Created:** 2026-10-09 · **Status:** `claude-foundation changes`

## Scope

- **In scope (`land`):** ลงท้ายด้วย newline เดียวโดยรักษาเนื้อหาและลิงก์เดิม
- **Out of scope:** edits outside `.claude/skills/ux-ui-principles/assets/layouts/**`

## Work type

docs

## Acceptance traceability

Tasks and checks: `tasks.md`. Evidence: static-analysis.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| layout-whitespace | unclassified | T001 | — |

## Definition of done

- Fresh evidence for every claim (1).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Specs:** none; docs-only work modifies no living spec
