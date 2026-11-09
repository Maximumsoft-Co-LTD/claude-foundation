# Change: ตรวจ UI ที่ build จริงเทียบกับ prototype ที่ผูกกับ change

- **Change:** `ui-build-prototype-change` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-07

## เหตุผล

ตอนนี้ prototype จาก Investigate หรือไฟล์ HTML ถูกส่งต่อเป็นแค่บันทึกว่าเลือกตัวไหน Build ไม่ได้เปิดอ่าน และ Prove ไม่เคยเทียบภาพ UI ที่ส่งมอบจึงไม่ตรงกับ prototype และผู้ใช้เพิ่งเจอหลัง Land ต้องเปิด change ใหม่ทั้งรอบ การผูก prototype เข้า agreement แล้วตรวจภาพจริงใน Prove จะจับความต่างได้ก่อน Land โดยผู้ใช้ยังข้ามได้เมื่อต้องการ

## User story

- **P1** ในฐานะ ผู้อนุมัติงาน UI ฉันต้องการ ให้ UI ที่ส่งมอบถูกเทียบกับ prototype ที่ผมอนุมัติก่อน Land เพื่อ ไม่ต้องเจอหน้าจอไม่ตรงหลัง Land แล้วเปิด change ใหม่ Requirement: prototype-bound-reference, visual-check-judgement, visual-repair-budget.
- **P2** ในฐานะ ผู้ใช้ที่ใช้ prototype เป็นแค่แนวทาง ฉันต้องการ ข้ามหรือยอมรับความต่างได้ด้วยการตัดสินใจที่ถูกบันทึกไว้ เพื่อ งานไม่ถูก block ด้วยรายละเอียดที่ผมไม่สนใจ Requirement: visual-check-mode, visual-drift-decision.

## เกณฑ์ความสำเร็จ

- Change ที่มี prototype ผูกแบบ strict ไม่สามารถถึง archived ได้ถ้าภาพไม่ตรง เว้นแต่ user เลือก waive พร้อมเหตุผลหรือ amend
- Change ที่ไม่มี prototype ไม่มี provider visual และไม่มีขั้นตอนเพิ่ม

## ขอบเขต

- **In scope (`visual-verification`):** prototypeSelection ถูกคัดลอกเข้า packet และผูก digest กับการอนุมัติ; Build task ที่ cover requirement ที่ผูก prototype ได้ prototype ใน contextFiles; capability ใหม่ visual ที่ agent reviewer เทียบ screenshot กับ prototype; repair budget 2 รอบสำหรับ visual แล้วเลื่อนการตัดสินใจไปรวมกับ Land; waiver ของ visual บันทึกรายการความต่างที่ user ยอมรับ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/runtime/workflow/prototype-binding.mjs`, `.claude/harness/tests/prototype-binding.test.mjs`, `.claude/harness/tests/design-render.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, … +34 more; the authored Non-goals below

## Non-goals

- Pixel diff หรือ threshold แบบตัวเลข
- Harness รัน browser หรือจับ screenshot เอง โปรเจกต์ยังเป็นผู้ผลิต screenshot ผ่าน adapter ที่มีอยู่
- ดึง artifact จาก claude.ai ผ่าน harness เอเจนต์บันทึกเป็นไฟล์ในโปรเจกต์ก่อน
- ฟื้น skill prototype หน้า approval

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

Change ที่ผูก prototype จะถูกตรวจภาพ UI จริงเทียบกับ prototype ก่อน Land

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| prototype-bound-reference | ผูก prototype จาก investigate | success | T001, T006 | test: `.claude/harness/tests/prototype-binding.test.mjs`, `.claude/harness/tests/design-render.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | prototype ใน packet ถูกแก้หลังอนุมัติ | boundary | T001, T006 |  |  |
|  | อ้างไฟล์ที่ไม่มีหรืออยู่นอกโปรเจกต์ | failure | T001, T006 |  |  |
|  | covers อ้าง requirement ที่ไม่มี | failure | T001, T006 |  |  |
| prototype-build-context | task ที่เกี่ยวข้องได้ prototype | success | T002 | test: `.claude/harness/tests/advance-runtime.test.mjs` | — |
|  | task ที่ไม่เกี่ยวข้อง | boundary | T002 |  |  |
|  | change ไม่มี prototype | boundary | T002 |  |  |
| visual-check-mode | strict เป็นค่าเริ่มต้น | success | T003, T006 | test: `.claude/harness/tests/visual-review.test.mjs`, `.claude/harness/tests/provider-input-identity.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | advisory รายงานอย่างเดียว | boundary | T003, T006 |  |  |
|  | ไม่มี prototype | boundary | T003, T006 |  |  |
| visual-check-judgement | ภาพตรงกัน | success | T003 | test: `.claude/harness/tests/visual-review.test.mjs`, `.claude/harness/tests/provider-input-identity.test.mjs` | — |
|  | ใช้ผลเดิมเมื่อไม่มีอะไรเปลี่ยน | boundary | T003 |  |  |
|  | ภาพไม่ตรง | failure | T003 |  |  |
|  | ไม่มี screenshot | failure | T003 |  |  |
| visual-repair-budget | ซ่อมสำเร็จในรอบแรก | success | T004 | test: `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/advance-recovery.test.mjs` | — |
|  | ครบ 2 รอบยังไม่ตรง | boundary | T004 |  |  |
|  | finding ระดับ minor | boundary | T004 |  |  |
| visual-drift-decision | user ยอมรับความต่าง | success | T005, T006 | test: `.claude/harness/tests/visual-drift-decision.test.mjs`, `.claude/harness/tests/waive-gate.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | user ขอซ่อมต่อ | success | T005, T006 |  |  |
|  | user แก้ agreement | success | T005, T006 |  |  |
|  | ภาพเปลี่ยนหลังยอมรับ | boundary | T005, T006 |  |  |
|  | ยอมรับโดยไม่ให้เหตุผล | failure | T005, T006 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (22).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (5); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 2 (2026-11-07): Prove review found an advisory visual provider is never scheduled: the scheduler runs only required providers. Delivering the approved advisory scenario needs the scheduler and proof evaluation paths.
- Revision 3 (2026-11-07): Prove review advisories: advisory visual differences appear only in the receipt file, and an advisory provider whose adapter throws or whose dependency is missing aborts or blocks the proof run. The user asked to close both before Land.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | advisory-visual-never-scheduled: In advisory mode the visual provider never runs in Prove, so the scenario "advisory reports only" is not delivered. `withVisualRequirement` adds the `visual` capability only for strict bindings. `requiredProvidersOperation` (change-validation.mjs:785) builds the required set only from claim capabilities, review, acceptance and policy. `neededExecutionProviders` (provider-scheduler.mjs:4) schedules only `requiredProviders`. An advisory binding therefore leaves `visual` out of the required set, and the provider is never executed, even when it is wired in execution.yaml. No receipt is written and no differences are reported. `claimsForCapability` makes the provider cover the bound claims in advisory mode, but that only matters if the provider runs. The visual-review test for this scenario (visual-review.test.mjs:84) checks the claim lists and calls `runVisualReview` directly, so it never goes through proof scheduling. WORKFLOW.md:946 and EVIDENCE.md state that the provider reports in advisory mode. Fix: schedule a configured or built-in visual provider as a non-blocking, non-deciding node for advisory bindings, record its receipt, and add a test through the scheduler or proof advance. That test must show an advisory `fail` receipt does not change proof status. (root/.claude/harness/runtime/evidence/evidence-contract.mjs:559) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | strict-requirement-drops-when-copy-not-intact: `visualRequiredClaimIds` returns an empty list when `binding.intact` is false, whether the prototype copy is missing or its digest changed. That silently removes the strict visual requirement instead of failing closed. The approval hash over the packet should normally stop an edited copy first, so this is non-blocking. A tampered or deleted copy should still fail the visual gate or raise a readiness issue, not drop the gate. (root/.claude/harness/runtime/evidence/visual-review.mjs:55) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | reference-edit-no-start-level-test: Tests cover `materializePrototype` rejecting an outside or missing reference, and `prototypeSelectionIssues` naming unknown covers keys. No test drives `change start` to show that the result is an EDIT naming `prototypeSelection.reference` or the unknown key, or that no packet is created. The wiring in change-lifecycle.mjs:1597 and :1623 is therefore untested. (root/.claude/harness/tests/prototype-binding.test.mjs:54) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | advisory-repeated-contract-reads: Each `executionNodes` call evaluates `advisoryExecutionProviders` three times: once inside `neededExecutionProviders`, once directly at line 70, and once more for `reusedNodes`. Each evaluation re-runs `evidence(id)`, which re-reads and re-validates evidence.yaml, execution.yaml and the prototype binding with its sha256. Results stay correct, but the selection cost is multiplied. Compute the advisory set once per call and pass it down. (root/.claude/harness/runtime/evidence/provider-scheduler.mjs:70) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | non-intact-binding-drops-strict-visual: The comment says `readVisualBinding` follows fail-closed rules, but the code fails open. When the packet's prototype copy no longer matches `binding.sha256`, `visualRequiredClaimIds` returns `[]` and `withVisualRequirement` sets `visualAdvisory` to false. A strict binding then quietly stops requiring `visual`, and nothing reports why. The approval gate does catch an edit made after approval. But if the user re-approves the hand-edited packet without compiling it again, Prove goes ahead with no visual check at all. A non-intact binding should keep the claims requiring `visual`, or raise a validation or readiness issue that tells the user to compile the packet again. (root/.claude/harness/runtime/evidence/visual-review.mjs:54) | minor | ยังเปิดอยู่ | claude-opus |
| 3 | advisory-rows-outlive-binding: `recordAdvisoryEvidence` merges new rows into `state.advisoryEvidence.rows` and never removes old ones. `proof-runtime`, the advance DONE envelope, and `landAdvisoryLines` print every stored row. So after an amendment switches the binding from advisory to strict or removes it, the proof and the Land report still show an 'advisory visual' row from the old binding. Drop rows for providers that `advisoryProviders(id)` no longer returns, or for a row whose contract revision differs from the current one. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs:785) | minor | ยังเปิดอยู่ | claude-opus |
| 3 | land-helper-between-imports: `landAdvisoryLines` is declared between `import` statements. ESM hoists imports, so the code works, but it breaks the file's layout convention and makes later edits more likely to go wrong. Move it below the import block. (root/.claude/harness/runtime/workflow/land-runtime.mjs:8) | minor | ยังเปิดอยู่ | claude-opus |
