# Change: advance ที่รันซ้อนกันต้องไม่สร้าง no-progress ปลอมหรือ REPAIR ของ lock ปลอม (issue #42)

- **Change:** `advance-no-progress-repair-lock-issue-42` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

เมื่อ advance สองตัวของ change เดียวกันรันซ้อนกัน ตัวที่ตัดสินใจ RUN_PROOF จาก cursor เก่าจะได้ lock หลังอีกตัวรัน gate จบ แล้วรัน gate ซ้ำบนหลักฐานเดิมและเทียบกับ fingerprint ที่เพิ่งเขียน จึงรายงานว่าไม่มีความคืบหน้าทั้งที่ยังไม่มีรอบซ่อม และ owner ของ proof lock ที่กำลัง initialize หรือเพิ่งถูกปล่อยถูกตัดเหลือแค่ pid ทำให้ advance คืน REPAIR_PROOF_LOCK ที่ถูกนับเข้า no-progress

## Scope

- **In scope (`prove`):** advance ที่ซ้อนกันได้ REPAIR ตามปกติแทน NO_PROGRESS_DECISION ปลอม; advance ไม่คืน REPAIR_PROOF_LOCK ที่ถูกนับเข้า no-progress ระหว่างที่ lock กำลังเปลี่ยนมือ
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/proof-advance.test.mjs`, `.claude/harness/tests/advance-recovery.test.mjs`; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| stale-gate-baseline › b-gate | failure | T001 | .claude/harness/tests/proof-advance.test.mjs, .claude/harness/tests/advance-recovery.test.mjs |
| stale-gate-baseline › gate-fail-findings-fingerprint | edge | T001 | .claude/harness/tests/proof-advance.test.mjs, .claude/harness/tests/advance-recovery.test.mjs |
| stale-gate-baseline › advance-proof-run-proof | happy | T001 | .claude/harness/tests/proof-advance.test.mjs, .claude/harness/tests/advance-recovery.test.mjs |
| transient-proof-lock-owner › advance | edge | T002 | .claude/harness/tests/advance-recovery.test.mjs |
| transient-proof-lock-owner › advance-2 | edge | T002 | .claude/harness/tests/advance-recovery.test.mjs |
| transient-proof-lock-owner › advance-3 | failure | T002 | .claude/harness/tests/advance-recovery.test.mjs |

## Definition of done

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Non-goals

- ไม่เพิ่ม lock ให้ advance ทั้งคำสั่ง
- ไม่ล็อก read-modify-write ของ advance-recovery observe ในรอบนี้
- ไม่เปลี่ยนสิ่งที่ no-progress fingerprint ครอบ

## Derived by harness

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.
