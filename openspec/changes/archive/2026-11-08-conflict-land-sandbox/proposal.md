# Change: ไม่รายงาน conflict ปลอมกับงานที่ Land แล้วซึ่งถูกคัดลอกเข้า sandbox

- **Change:** `conflict-land-sandbox` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-07

## เหตุผล

เมื่อ Land หลาย change ติดกันโดยยังไม่ commit sandbox ของ change ถัดไปจะคัดลอกงานที่ Land แล้วมา แต่หลังจากแก้ไฟล์นั้น ระบบลืมว่าเริ่มจากงานที่ Land แล้ว และ merge ซ้ำจนได้ conflict ปลอมทุกครั้ง การแก้นี้ให้ระบบจำต้นทางของการคัดลอก เพื่อไม่ต้องแก้ไฟล์โดยไม่จำเป็นเพื่อผ่าน sync

## User story

- **P1** ในฐานะ ผู้ใช้ที่ Land หลาย change ก่อน commit ฉันต้องการ ให้ change ถัดไปไม่ติด conflict ปลอมกับงานที่ Land แล้ว เพื่อ ไม่ต้องแก้ไฟล์โดยไม่จำเป็นเพื่อผ่าน sync Requirement: landed-carry-no-false-conflict.

## เกณฑ์ความสำเร็จ

- สถานการณ์ที่เคยเกิด (sandbox เริ่มจากงานที่ Land แล้วและแก้บรรทัดติดกัน) ไม่มี conflict และ Land ยังเก็บงานของทั้งสอง change ครบ

## ขอบเขต

- **In scope (`sandbox`):** sync ไม่รายงาน conflict ปลอมกับงานที่ Land แล้วซึ่ง sandbox มีอยู่แล้ว
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/landed-carry-sync.test.mjs`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `CHANGELOG.md`; the authored Non-goals below

## Non-goals

- เปลี่ยนการตรวจของ Land ว่าไม่เขียนทับงานที่ Land แล้ว
- path ที่ sandbox ไม่ได้คัดลอกจากงานที่ Land แล้ว

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| landed-carry-no-false-conflict | แก้ต่อจากงานที่คัดลอกมา | success | T001 | test: `.claude/harness/tests/landed-carry-sync.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | target เปลี่ยนหลังคัดลอก | boundary | T001 |  |  |
|  | path ที่ไม่ได้คัดลอก | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-drop-guard: For a path with a matching `landedCarriedFrom`, the replay marks it resolved without calling `resolutionKeepsLanded`. If the agent deletes or overwrites the carried landed lines, Land accepts that and overwrites them in the target. The ordinary conflict path refuses this case. It is arguably intentional, because the sandbox started from the landed bytes and saw them. No test pins either behaviour. Consider a test or a comment stating the choice. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:2274) | minor | ยังเปิดอยู่ | claude-opus |
