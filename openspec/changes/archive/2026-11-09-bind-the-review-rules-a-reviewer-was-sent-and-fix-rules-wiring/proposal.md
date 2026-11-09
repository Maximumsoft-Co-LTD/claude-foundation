# Change: Bind the review rules a reviewer was sent and fix rules wiring

- **Change:** `bind-the-review-rules-a-reviewer-was-sent-and-fix-rules-wiring` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

change ก่อนหน้า (bind-the-project-s-advisory-review-md-to-every-ai-review) ทำให้ 2 suite ของ harness ล้ม เพราะ `currentReviewRulesHash` ไม่มีค่า default และ receipt อ่าน REVIEW.md ตอนบันทึก จึงผูกเกณฑ์ผิดฉบับถ้าไฟล์ถูกแก้ระหว่างรีวิว change นี้แก้ทั้งสองจุด เพิ่มเทสต์ staging ของ installer และบันทึก incident แรกของ repo

## ขอบเขต

- **In scope (`review-policy`):** receipt ผูกเกณฑ์ฉบับที่ reviewer ได้อ่านจริง; runtime ที่ไม่ส่ง callback ไม่ล้ม และตรวจ receipt ได้ตามปกติ; ไฟล์ตั้งต้นอยู่ใน index พร้อมไฟล์ที่ติดตั้ง และการแก้ของโปรเจกต์ไม่ถูก stage ให้
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/receipt-validity.mjs`, `.claude/harness/tests/receipt-validity.test.mjs`, `.claude/harness/runtime/evidence/review-attempt-store.mjs`, `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/tests/review-dispatch-helpers.test.mjs`, … +5 more; the authored Non-goals below

## Non-goals

- เปลี่ยนผลผ่าน/ไม่ผ่านของรีวิว
- ย้อนแก้ receipt หรือ attempt ที่บันทึกไปแล้ว
- bump reviewProtocol หรือ reviewPacketSchema

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** bind-the-project-s-advisory-review-md-to-every-ai-review

## วิธีตรวจด้วยตัวเอง

1. รัน `node .claude/tests/harness/run-risk-tiered-review-tests.mjs` ต้องผ่านทุก case รวม CASE-REVIEW-REPAIR-CLOSURE
2. รัน full suite (`bash .claude/tests/run-all.sh`) ใน sandbox ก่อน Land

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| dispatched-review-binds-sent-rules | บันทึก hash ที่ส่งไป | success | T002 | test: `.claude/harness/tests/review-dispatch-helpers.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs` | — |
|  | dispatch ตอนไม่มีเกณฑ์ | boundary | T002 |  |  |
|  | attempt รุ่นเก่าไม่มีฟิลด์ | boundary | T002 |  |  |
|  | receipt ที่ไม่ผ่าน dispatch | boundary | T002 |  |  |
|  | แก้ REVIEW.md ระหว่างรีวิว | failure | T002 |  |  |
| receipt-validity-without-rules-lookup | ไม่ส่ง callback และ receipt บันทึก null | success | T001, T004 | test: `.claude/harness/tests/receipt-validity.test.mjs` | — |
|  | ไม่ส่ง callback แต่ receipt มี hash | boundary | T001, T004 |  |  |
| seeded-review-rules-staged | installer สร้างไฟล์ | success | T003 | test: `.claude/tests/harness/run-installer-tests.sh` | — |
|  | ไฟล์ของโปรเจกต์ที่ยังไม่ commit | boundary | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (9).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | dispatched-review-binds-sent-rules |  |  |
| compatibility | covered | dispatched-review-binds-sent-rules, receipt-validity-without-rules-lookup |  |  |
| current-behavior | covered | dispatched-review-binds-sent-rules |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for dispatched-review-binds-sent-rules, receipt-validity-without-rules-lookup, seeded-review-rules-staged.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
