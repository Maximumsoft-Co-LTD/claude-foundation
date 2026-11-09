# Change: Recover interrupted cheaper-tier reviews and refuse a trapping abort

- **Change:** `recover-interrupted-cheaper-tier-reviews-and-refuse-a-trapping-a` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

รีวิวของ change 2B ติดทางตันจนต้อง abandon (incident 2026-11-09-review-deadlock-after-target-branch-switch) สาเหตุจริงมี 2 ข้อ: การกู้คืนผลรีวิวคำนวณ model ที่คาดหวังใหม่ จึงปฏิเสธผลของรอบแรกที่ใช้ model ระดับถูกกว่า และ `authority abort` ทิ้ง attempt ที่เสร็จแล้วแต่ยังไม่บันทึกไว้ให้ guard บล็อกตลอดไป change นี้แก้ทั้งสองข้อโดยไม่ลด guard กันรีวิวซ้ำ แล้วปิด incident ด้วย eval

## ขอบเขต

- **In scope (`review-authority`):** รีวิวรอบแรกที่ใช้ model ระดับถูกกว่ากู้คืนและบันทึก receipt ได้หลังถูกขัดจังหวะ; ไม่มีคำสั่ง abort ที่ทำให้ change รีวิวไม่ได้อีก
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/runtime/evidence/review-result-recovery.mjs`, `.claude/harness/tests/**`, `openspec/incidents/**`, `openspec/lessons.md`, `.claude/tests/evals/cases/**`, … +3 more; the authored Non-goals below

## Non-goals

- ลดหรือข้าม guard ที่กันการรันรีวิวใหม่เมื่อมีคำตอบที่ยังไม่บันทึก
- เพิ่มคำสั่งใหม่สำหรับปลดปล่อย attempt ที่ส่งมอบแล้ว
- กู้ change ที่ abandon ไปแล้ว
- เปลี่ยน protocol pin

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## วิธีตรวจด้วยตัวเอง

1. รัน `node --test .claude/harness/tests/workflow-policy.test.mjs` ต้องผ่านกรณีกู้คืนรอบ standard ที่ถูกขัดจังหวะ
2. รัน `node --test .claude/harness/tests/authority-request-operation.test.mjs` ต้องเห็น abort ถูกปฏิเสธเมื่อผลเสร็จแต่ยังไม่บันทึก
3. รัน `npm run evals` ต้องผ่าน และ incident ปิดพร้อม eval

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| interrupted-review-recovers-dispatched-model | รอบ configured ยังกู้ได้ | success | T001, T003 | test: `.claude/harness/tests/**`, `.claude/tests/evals/cases/**` | — |
|  | รอบแรก fast ถูกขัดจังหวะ | boundary | T001, T003 |  |  |
|  | รอบแรก standard ถูกขัดจังหวะ | failure | T001, T003 |  |  |
|  | คำตอบไม่ตรงกับที่ dispatch | failure | T001, T003 |  |  |
| abort-refuses-unrecorded-result | abort ระหว่างรีวิวยังรัน | success | T002, T003 | test: `.claude/harness/tests/**`, `.claude/tests/evals/cases/**` | — |
|  | abort request ที่ยังไม่ dispatch | boundary | T002, T003 |  |  |
|  | abort หลังบันทึกแล้ว | boundary | T002, T003 |  |  |
|  | abort หลังผลเสร็จแต่ยังไม่บันทึก | failure | T002, T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | interrupted-review-recovers-dispatched-model, abort-refuses-unrecorded-result |  |  |
| compatibility | covered | interrupted-review-recovers-dispatched-model |  |  |
| current-behavior | covered | interrupted-review-recovers-dispatched-model |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for interrupted-review-recovers-dispatched-model, abort-refuses-unrecorded-result.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
