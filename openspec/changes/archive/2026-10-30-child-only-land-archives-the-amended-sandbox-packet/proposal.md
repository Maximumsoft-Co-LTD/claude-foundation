# Change: Child-only Land archives the amended sandbox packet

- **Change:** `child-only-land-archives-the-amended-sandbox-packet` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

lane order-inventory-lifecycle ทุก run (26–30 ต.ค.) archive change A โดยไม่มี task ที่ amend และไม่มี Amendment history ทั้งที่ runtime บันทึก amendment ไว้ สาเหตุคือ Land ของ change ที่ไม่มี root เป็น repository ที่เขียนได้ merge เฉพาะ checkbox จาก sandbox กลับเข้า root packet แล้ว openspec archive ใช้ root packet ซึ่งยังเป็น agreement ก่อน amend ผลคือ archive และ spec ที่ sync ไม่ตรงกับสิ่งที่ user อนุมัติ (approval ผูก identity ของ sandbox packet) และที่ agent ทำจริง การเปลี่ยนนี้ให้ child-only Land แทนที่ root packet ด้วย sandbox packet ทั้งชุดเมื่อ change มี amendment ที่ harness บันทึกและ sandbox ตรงกับมัน ส่วน change ที่ไม่มี amendment ยัง merge เฉพาะ tick เหมือนเดิม

## ขอบเขต

สิ่งที่เปลี่ยน:

- applyArchiveWorkspace: child-only + amendment ตรง → แทนที่ root packet ทั้งชุดด้วย sandbox packet (ลบไฟล์ที่ root มีแต่ sandbox ไม่มี) ก่อน archive
- ไม่มี amendment → merge tick เหมือนเดิม
- docs และ test

ไม่ทำ:

- ไม่เปลี่ยน Land ของ change ที่มี root เขียนได้ (projection เดิมครอบ packet อยู่แล้ว)
- ไม่เปลี่ยนกติกา drift ของ packet ที่แก้มือ

- **In scope (`sandbox-apply`):** archive ของ child-only Land เป็น agreement ที่ user อนุมัติและ agent ทำจริง รวม amendment
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/tests/child-only-ledger.test.mjs`, `.claude/harness/tests/concurrent-repositories.test.mjs`, `WORKFLOW.md`, `CHANGELOG.md`

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| child-only-ledger | ทุก task เสร็จ | success | T001, T002 | test: `.claude/harness/tests/child-only-ledger.test.mjs`, `.claude/harness/tests/concurrent-repositories.test.mjs` | — |
|  | amendment ทำให้ packet ทั้งชุดถูกแทนที่ | success | T001, T002 |  |  |
|  | บรรทัดอื่นไม่เปลี่ยน | boundary | T001, T002 |  |  |
|  | มี root | boundary | T001, T002 |  |  |
|  | sandbox packet ไม่ตรง amendment | failure | T001, T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (5).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | child-only-ledger |  |  |
| compatibility | covered | child-only-ledger |  |  |
| non-goals | covered | child-only-ledger |  |  |
| input-boundary | not-applicable |  |  | input คือ packet ที่ harness เขียนเอง |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-seam-untested: The unit tests only call syncChildOnlyPacket with a hand-set amended flag. Nothing tests the wiring in applyArchiveWorkspace (apply-runtime.mjs:1549), where amendedAgreementMatches decides amended. Nothing tests that a sandbox packet hand-edited after an amendment is not projected and Land stops on drift. design.md plans a seam test in concurrent-repositories.test.mjs, but it is not in this diff. The code reads correctly, so this is non-blocking. (root/.claude/harness/tests/child-only-ledger.test.mjs) | minor | ยังเปิดอยู่ | claude-opus |
