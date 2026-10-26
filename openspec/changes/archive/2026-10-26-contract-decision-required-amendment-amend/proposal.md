# Change: ทำให้ทางตัน CONTRACT_DECISION_REQUIRED หลัง amendment บอกทางต่อที่มีอยู่จริง และเตือนตั้งแต่ตอน amend

- **Change:** `contract-decision-required-amendment-amend` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-26

## เหตุผล

เมื่อ AI review รอบ delta สุดท้ายล้ม แล้ว amendment เปลี่ยน contract harness ปิด review แบบ deterministic ไม่ได้จนกว่าจะมี Decision Sheet revision ที่ lock แล้ว gate นี้ถูกต้อง แต่ผลลัพธ์ของ advance ไม่บอกคำสั่งที่เปิด revision, next ชี้ไป packet --phase build ที่ไม่เกี่ยวข้อง และ change amend ไม่เตือน agent จึงเสียเวลาขอ waive review ซึ่งปลด gate นี้ไม่ได้ change นี้ทำให้ทางตันบอกทางต่อที่มีอยู่แล้ว โดยไม่ผ่อน gate

## ขอบเขต

- advance ระบุคำสั่งเปิด Decision Sheet revision ตามชนิดของ change (grounding หรือ non-grounding)
- change amend เตือนเรื่องเดียวกันทันทีที่ amendment ติด gate
- WORKFLOW.md อธิบายทางต่อนี้
- ไม่อยู่ในขอบเขต: ผ่อน gate, เปลี่ยนความหมายของ waiver, ทำ fingerprint รายคำร้อง, เปลี่ยน protocol.json

- **In scope:** ทางตัน CONTRACT_DECISION_REQUIRED ระบุคำสั่งเปิด Decision Sheet ที่ใช้ได้จริง; change amend เตือนทันทีเมื่อ amendment จะติด Decision Sheet gate
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/review-closure-helpers.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, … +3 more

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| review-closure | decision-route-command | T001 |
| change-amend | amend-decision-notice | T002 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## วิธีตรวจด้วยตัวเอง

- ทำให้ delta รอบสุดท้ายล้ม แล้ว change amend ที่เปลี่ยน contract ดูว่า output มีคำสั่ง Decision Sheet
- รัน advance ต่อ ดูว่า ASK_USER มีคำสั่งเดียวกัน

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| decision-route-command | gate ไม่ถูกผ่อน | boundary | T001 | test: `.claude/harness/tests/review-closure-helpers.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs` | — |
|  | change แบบ grounding | failure | T001 |  |  |
|  | change แบบ non-grounding | failure | T001 |  |  |
| amend-decision-notice | amend หลัง delta ที่ล้ม | success | T002 | test: `.claude/harness/tests/amendment-invalidation.test.mjs` | — |
|  | amend ที่ไม่มี review ล้ม | boundary | T002 |  |  |
|  | amend ที่ไม่เปลี่ยน contract | boundary | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered |  | .claude/harness/runtime/evidence/receipt-runtime.mjs, .claude/harness/runtime/evidence/proof-execution-runtime.mjs, .claude/harness/runtime/workflow/change-lifecycle.mjs | อ่านโค้ดยืนยัน: receipt-runtime คืน reason ไม่มีคำสั่ง, proof-execution-runtime ใส่ packet --phase build, amendChangeUnlocked ไม่ตรวจ review ที่ล้ม |
| affected-actor | covered |  | WORKFLOW.md | agent ที่ต้องอธิบายทางต่อ และผู้ใช้ที่ต้องตัดสินใจ |
| compatibility | covered |  | .claude/harness/protocol.json | เพิ่มเฉพาะคำสั่งและข้อความ ไม่เปลี่ยน route, status หรือ protocol; consumer ที่อ่านเหตุผลเดิมยังได้ข้อความเดิม |
| non-goals | covered |  | WORKFLOW.md | ไม่ผ่อน gate, ไม่ทำ fingerprint รายคำร้อง, ไม่เปลี่ยนความหมายของ waiver |
| operability | covered |  | .claude/harness/commands.json | ทางตันระบุคำสั่งที่มีอยู่ใน commands.json |
| recoverability | covered |  | .claude/harness/runtime/workflow/change-lifecycle.mjs | ไม่เขียน state เพิ่ม ข้อความเตือนอ่านจาก state เดิมเท่านั้น |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-26): การเตือนตอน amend ต้องต่อ decisionGateNotice ผ่าน foundation.mjs และใช้ receipt-runtime ซึ่งอยู่นอก path ของ task เดิม
- Revision 2 (2026-10-26): test ของ output change amend ต้องใช้ fixture ใน change-revise.test.mjs ซึ่งอยู่นอก path ของ task เดิม

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | M1: No test runs the code that joins the tested pieces. Nothing covers the mapping from a blocked closure's `command` into the `{kind:"contract-decision"}` next row (proof-execution-runtime.mjs:1282-1301), and nothing covers proofOperationAction copying that command onto the ASK_USER result (advance-runtime.mjs:585). The closure test checks both command types and the coordinatorAction test uses a hand-built proofCursor with only the non-grounding command, so nothing runs end to end from closure to ASK_USER, and the grounding command is never checked at the advance level. Suggest adding a closeBoundedReviewAttempts or proofOperationAction test that feeds in a grounding closure. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs:1282) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | M2: decisionGateNoticeOperation is looser than the closure. It skips deterministicClosureIsBound and the closure's filter to review providers whose receipt is not currently valid (missingByCapability). If the review receipt on disk is not tied to the failed final delta, amend prints a decision-revision command, but the closure still blocks on the 'Neither the failed final AI delta nor a valid deterministic closure...' branch, which returns no command and is not cleared by that decision. This is a rare case and is advisory only. (root/.claude/harness/runtime/evidence/receipt-runtime.mjs:222) | minor | ยังเปิดอยู่ | claude-opus |
