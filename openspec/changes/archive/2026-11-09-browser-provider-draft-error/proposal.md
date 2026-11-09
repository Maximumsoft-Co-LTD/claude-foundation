# Change: ต่อ browser provider ใน draft ได้และ error บอกวิธีแก้

- **Change:** `browser-provider-draft-error` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

draft ที่ต้องใช้หลักฐาน browser เช่นการตรวจภาพ เริ่ม change ไม่ได้ เพราะ error ไม่บอกว่าต้องตั้ง inputMode อย่างไรและที่ไหน และ execution.yaml ใน draft folder ไม่ถูกอ่าน paid lane ของ visual check จึงติดจนจบ การแก้นี้ทำให้ต่อ provider ใน draft folder ได้ และ error บอกวิธีแก้ชัดเจน

## User story

- **P1** ในฐานะ agent ที่ทำงาน UI ที่มีการตรวจภาพ ฉันต้องการ ต่อ browser provider ใน draft แล้วเริ่ม change ได้ในครั้งเดียว เพื่อ ไม่ติดจนต้องหยุดถามผู้ใช้เรื่องรูปแบบ config Requirement: draft-folder-execution, actionable-wiring-errors.

## เกณฑ์ความสำเร็จ

- draft folder ที่มี execution.yaml ถูกต้องผ่าน change start ได้ในครั้งแรก และทุก error ของ wiring ระบุสิ่งที่ต้องแก้

## ขอบเขต

- **In scope (`change`):** agent ต่อ provider ใน draft folder ด้วยไฟล์รูปแบบเดียวกับ packet ได้; agent แก้ wiring ได้จากข้อความ error โดยไม่ต้องเดา
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/draft-folder.mjs`, `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/draft-execution-wiring.test.mjs`, `.claude/tests/harness/run-evidence-contract-tests.mjs`, `.claude/skills/change/references/workflow.md`, … +3 more; the authored Non-goals below

## Non-goals

- เปลี่ยนวิธีสร้าง provider อัตโนมัติจากคำสั่ง verify
- รองรับ YAML ไวยากรณ์เต็ม (execution.yaml ใช้ JSON เหมือน execution.yaml ใน packet)

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| draft-folder-execution | draft folder มี execution.yaml | success | T001 | test: `.claude/harness/tests/draft-execution-wiring.test.mjs`, `.claude/tests/harness/run-evidence-contract-tests.mjs`, `.claude/tests/run-all.sh` | — |
|  | ประกาศ execution สองที่ | failure | T001 |  |  |
|  | execution.yaml ไม่ใช่ JSON | failure | T001 |  |  |
| actionable-wiring-errors | browser provider ที่ถูกต้อง | success | T001 | test: `.claude/harness/tests/draft-execution-wiring.test.mjs`, `.claude/tests/harness/run-evidence-contract-tests.mjs`, `.claude/tests/run-all.sh` | — |
|  | browser provider ไม่มี inputMode | failure | T001 |  |  |
|  | execution ของ draft ไม่มี version | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (4); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | scope-unrelated-visual-prototype: The diff for evidence-contract.mjs and change-lifecycle.mjs also contains the prototype-bound visual check work: the visual-review import, visual provider expansion, prototypeSelection materialization, and the CHANGELOG, README and run-all.sh entries. The agreement does not cover this work. It depends on visual-review.mjs and prototype-binding.mjs, which are untracked and not in changedSurface. If this change is committed alone, those imports would not resolve. Split or land that work together with this change. (root/.claude/harness/runtime/evidence/evidence-contract.mjs:8) | minor | ยังเปิดอยู่ | claude-opus |
