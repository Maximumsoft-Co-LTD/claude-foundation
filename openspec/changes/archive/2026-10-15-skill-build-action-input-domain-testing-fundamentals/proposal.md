# Change: ให้คำสั่งโหลด skill เป็นขั้นแรกของ Build action และส่ง input-domain ไปที่ testing-fundamentals

- **Change:** `skill-build-action-input-domain-testing-fundamentals` · **Lane:** standard (the draft carries design content (design.md and specs/))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

paid e2e 12 runs หลังเพิ่ม skill routing พบว่าทุก EDIT action มีคำสั่งโหลด skill แต่ไม่มี run ใดโหลดเลย (skillToolCalls เป็น 0) เพราะคำสั่งอยู่บรรทัดสุดท้ายหลัง Then run the resume command และ agent ลงมือแก้ทันที นอกจากนี้ input-domain ส่ง security-fundamentals ให้งานที่ไม่เกี่ยวกับ trust boundary เช่น search ทุกครั้ง

## Scope

- **In scope (`build-skill-routing`):** agent ได้รายชื่อ skill ไม่เกิน 4 ตัว และคำสั่งโหลด skill เป็นบรรทัดแรกของ instructions ก่อนคำสั่งให้แก้ task
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/skill-routing.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/skill-routing.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, `WORKFLOW.md`; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| edit-action-skills › advance-edit | happy | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-2 | happy | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-3 | happy | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-4 | edge | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-5 | edge | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-6 | edge | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-bugfix | failure | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |
| edit-action-skills › advance-edit-7 | edge | T001 | .claude/harness/tests/skill-routing.test.mjs, .claude/harness/tests/advance-runtime.test.mjs |

## Definition of done

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## Constraints

- ไม่เปลี่ยนชื่อ field skills, cap 4 หรือการกรอง skill ที่ไม่มีอยู่จริง
- คำสั่งยังเป็นกลางต่อ host และไม่อ่าน prose

## Non-goals

- ไม่ฝังเนื้อหา skill ลงใน action
- ไม่เปลี่ยน bench skillUsage

## Derived by harness

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
