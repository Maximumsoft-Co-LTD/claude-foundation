# Change: การตรวจ visual ไม่หายเมื่อ binding ไม่มี claim ที่ใช้ได้

- **Change:** `visual-binding-claim` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-07

## เหตุผล

ถ้า binding ของ prototype แบบ strict มี claims ว่าง หรือระบุ claim ที่ไม่มีใน contract จะไม่มี claim ใดต้องการ visual และการตรวจภาพหายไปเงียบ ๆ การแก้นี้ทำให้ทุก claim ต้องการ visual และแจ้ง error ให้ revise เพื่อไม่ให้หลักฐานอ่อนลงโดยไม่มีใครรู้

## User story

- **P1** ในฐานะ ผู้อนุมัติงาน UI ฉันต้องการ ให้การตรวจภาพไม่หายเมื่อ binding ระบุ claim ผิดหรือไม่ระบุเลย เพื่อ UI ที่ไม่ได้เทียบ prototype จะไม่ผ่านไปถึง Land โดยไม่มีใครรู้ Requirement: visual-binding-claims-fail-closed.

## เกณฑ์ความสำเร็จ

- ทั้ง 3 กรณี (claims ว่าง, ไม่รู้จักทั้งหมด, ไม่รู้จักบางส่วน) ทำให้ทุก claim ต้องการ visual และ receipt visual เป็น error โดย reviewer ถูกเรียก 0 ครั้ง

## ขอบเขต

- **In scope (`visual-verification`):** binding ที่ระบุ claim ผิดไม่ทำให้การตรวจภาพหายไป
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/tests/visual-binding-claims.test.mjs`, `.claude/harness/tests/visual-binding-record.test.mjs`, `.claude/harness/EVIDENCE.md`, `.claude/tests/run-all.sh`, … +2 more; the authored Non-goals below

## Non-goals

- ตรวจ binding.file ที่ชี้ออกนอก packet หรืออ่านไม่ได้
- reset สถานะ repair และ drift เมื่อเปลี่ยน mode
- bug sync conflict ของ harness

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** visual-prototype-digest

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| visual-binding-claims-fail-closed | claims ถูกต้อง | success | T001 | test: `.claude/harness/tests/visual-binding-claims.test.mjs`, `.claude/harness/tests/visual-binding-record.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | claims ไม่รู้จักบางส่วน | boundary | T001 |  |  |
|  | claims ว่าง | failure | T001 |  |  |
|  | claims ไม่รู้จักทั้งหมด | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | visual-binding-claims-fail-closed |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 2 | ไม่มีข้อค้นพบ | — | — | claude-opus |
