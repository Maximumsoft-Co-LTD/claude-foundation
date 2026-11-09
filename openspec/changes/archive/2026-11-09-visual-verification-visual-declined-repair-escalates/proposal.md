# Change: ความต่างด้านภาพที่ agent ไม่แก้ส่งไปให้ user ตัดสิน

- **Change:** `visual-verification-visual-declined-repair-escalates` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

paid e2e พบว่าเมื่อ reviewer ขอให้ทำตาม prototype ในจุดที่ agreement ห้าม และ agent ไม่แก้ ระบบส่ง repair เดิมซ้ำโดยไม่นับรอบ จึงไม่ถึงคำถาม visual-drift และ change ค้าง การแก้นี้ทำให้ resume ที่ไม่มีการแก้ถูกส่งไปให้ผู้ใช้ตัดสินตามที่ออกแบบไว้

## User story

- **P1** ในฐานะ ผู้อนุมัติงาน UI ฉันต้องการ ถูกถามเมื่อ prototype ขอสิ่งที่ agreement ห้าม เพื่อ change ไม่ค้างและไม่ถูกบังคับให้ทำสิ่งที่ห้าม Requirement: visual-declined-repair-escalates.

## เกณฑ์ความสำเร็จ

- repair ของ visual ที่ agent resume โดยไม่แก้ ทำให้มี drift และคำถาม visual-drift ภายในการ resume ครั้งเดียว

## ขอบเขต

- **In scope (`visual-verification`):** ความต่างที่ agent ไม่แก้ไปถึงการตัดสินใจของผู้ใช้
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/repair-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, … +1 more; the authored Non-goals below

## Non-goals

- เปลี่ยนจำนวนรอบซ่อมสูงสุด
- ให้ reviewer รู้ nonGoals ของ agreement

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** ui-build-prototype-change

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| visual-declined-repair-escalates | agent ไม่แก้ | success | T001 | test: `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs` | — |
|  | agent แก้แล้วยังต่าง | boundary | T001 |  |  |
|  | ครบ 2 รอบ | boundary | T001 |  |  |
|  | ไม่มี repair ของ visual ก่อนหน้า | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | visual-declined-repair-escalates |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-multi-visual-provider-shared-budget: `visualRepairSplit` loops over every failed visual provider but plans against one shared `state.visualRepair`. After the first provider's plan sets `lastBatchWorkspaceHash` to the current receipt hash, the second provider's receipt (same workspace) compares equal and `planVisualRepair` returns `drift` with `declined: true`. That provider never got a repair batch, which contradicts the 'first visual fail → round 1, no drift' scenario. Each additional provider also spends another round, and `result.graph` keeps only the last provider's graph. Single-provider changes are unaffected. Either plan once per pass over the combined findings, or key the budget and last-batch hash per provider. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs) | minor | ยังเปิดอยู่ | claude-opus |
