# Change: Land accepts a harness replay and agrees with proof after sync

- **Change:** `land-accepts-a-harness-replay-and-agrees-with-proof-after-sync` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

ใน run จริง 29 ต.ค. change B ที่ซ้อนบน change A ซึ่ง land แล้ว ถูก Land ปฏิเสธว่าจะทับ server.mjs ซ้ำจน HANDOFF ทั้งที่ sandbox sync ของ harness เองเพิ่ง merge งานของ A เข้า sandbox ได้สะอาด เพราะ Land ตรวจด้วยการ merge ซ้ำซึ่ง conflict เมื่อบรรทัดที่สอง change เพิ่มอยู่ติดกัน และ landedResolved บันทึกเฉพาะกรณี conflict หลังจากนั้น advance ยังตอบขัดกันเอง (proof current ขณะ Land บอก building) เพราะ sync ไม่ลบ proof checkpoint การเปลี่ยนนี้ให้ Land ยอมรับผล merge ที่ harness สร้างเองเมื่อ target ไม่เปลี่ยนตั้งแต่นั้น และทำให้ proof กับ lifecycle สอดคล้องกันหลัง sync ลด Land ของ change ซ้อนจาก 53 คำสั่งเหลือเส้นทางเดียว

## ขอบเขต

สิ่งที่เปลี่ยน:

- Land (root และ repository sandbox) ถือไฟล์ที่ landedReplay ตรงกับ sandbox และ landedSynced.target ตรงกับ target ว่า carry งานที่ land แล้ว
- advance ส่ง proof advance เมื่อ cursor PASS แต่ lifecycle ยัง building แทนการขอ Land authority
- sandbox sync ที่ invalidate proof ลบ proof-advance.json

ไม่ทำ:

- ไม่เปลี่ยนการนับ AI review wave หรือ allowlist ของ headless (change ถัดไป)
- ไม่เปลี่ยนกติกา conflict ที่ agent ต้อง resolve เอง

- **In scope (`land`):** Land ของ change ที่ซ้อนกันไม่ปฏิเสธไฟล์ที่ harness เองเป็นคน merge; advance --through proven และ --through archived ให้คำตอบที่สอดคล้องกันหลัง sync
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/target-edits.mjs`, `.claude/harness/runtime/workflow/repository-delivery-saga.mjs`, `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/tests/repository-delivery-saga.test.mjs`, `.claude/harness/tests/target-edits.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, … +8 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| replay-carries-landed | insertion ติดกันใน repository sandbox | success | T001, T003 | test: `.claude/harness/tests/repository-delivery-saga.test.mjs`, `.claude/harness/tests/target-edits.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/tests/fixtures/concurrent-changes.mjs` | — |
|  | insertion ติดกันใน root workspace | success | T001, T003 |  |  |
|  | target เปลี่ยนหลัง sync | failure | T001, T003 |  |  |
|  | sync รายงาน conflict ที่ยังไม่ resolve | failure | T001, T003 |  |  |
| proof-agrees-with-lifecycle | cursor PASS แต่ lifecycle building | success | T002, T003 | test: `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs` | — |
|  | sync ที่ invalidate ลบ checkpoint | success | T002, T003 |  |  |
|  | lifecycle proven และ cursor ตรง | boundary | T002, T003 |  |  |
|  | sync ที่ไม่ invalidate คง checkpoint | boundary | T002, T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | replay-carries-landed, proof-agrees-with-lifecycle |  |  |
| compatibility | covered | replay-carries-landed |  |  |
| non-goals | covered | replay-carries-landed |  |  |
| input-boundary | not-applicable |  |  | input คือ state และไฟล์ที่ harness เขียนเอง ไม่มีค่าจากภายนอก |

## Amendment discovery coverage

Reason: Build พบว่า coordinator ถือ cursor PASS ที่ hash เดิมเป็น proof current โดยเจตนา (review supersession) และ lifecycle กลายเป็น proven ตอน proof finalize เท่านั้น สาเหตุจริงของคำตอบขัดกันคือ checkpoint ที่ sync ไม่ลบ จึงแก้ที่ sync และเขียน scenario ให้ตรงกลไกจริง

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | proof-agrees-with-lifecycle | none | none |
| compatibility | covered | proof-agrees-with-lifecycle | none | none |
| non-goals | covered | proof-agrees-with-lifecycle | none | none |
| input-boundary | not-applicable | none | none | input คือ state และไฟล์ที่ harness เขียนเอง |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-29): Build พบว่า git merge-file ไม่ conflict ซ้ำกับ clean replay ในกรณีบรรทัดติดกันแบบง่าย จึงเขียน scenario root ให้ merge สะอาดได้จริง (บรรทัด 3 และ 5) และพบว่าการปฏิเสธเพราะ conflict ที่ยังค้างต้องส่ง route resolve กลับไปด้วย ไม่ใช่ข้อความ overwrite เปล่า
- Revision 2 (2026-10-29): Build พบว่า coordinator ถือ cursor PASS ที่ hash เดิมเป็น proof current โดยเจตนา (review supersession) และ lifecycle กลายเป็น proven ตอน proof finalize เท่านั้น สาเหตุจริงของคำตอบขัดกันคือ checkpoint ที่ sync ไม่ลบ จึงแก้ที่ sync และเขียน scenario ให้ตรงกลไกจริง

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1: The repository saga now re-offers the sync when the target changes after a clean replay (`targetUnchanged` in `overwriteError`). Root Land does not: `landedReplayExhausted` (lines 315-319, called at 366) compares only the sandbox bytes against `landedReplay`. So when a target edited after the sync makes `replayCarriesLanded` fail, root Land skips `landedChangeSyncStop` and falls through to the agent-owned target-conflict stop. The CHANGELOG entry ('in the root workspace and in repository sandboxes ... a target edited after the sync routes to the sync again') reads as if both behave the same. Comparing `landedSynced[path].target` with the current target bytes there, the same way the saga does, would make them agree. Non-blocking: the user's bytes are never overwritten; only the recovery route differs. (root/.claude/harness/runtime/workflow/apply-runtime.mjs:315) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1: The new recovery assertion uses a stub `invalidateProof` that only records the id. It proves `recoverAmendedReplay` calls the hook once. It does not prove that the real hook (sandbox-runtime.mjs:1888-1898) deletes proof-advance.json or moves the lifecycle to building. If someone later drops the checkpoint deletion from that hook, this test still passes. The sync path is covered by real-file assertions in sandbox-runtime-sync.test.mjs; the recovery path has none. Non-blocking: the production code is correct as written. (root/.claude/harness/tests/sandbox-replay-preparation.test.mjs:143) | minor | ยังเปิดอยู่ | claude-opus |
