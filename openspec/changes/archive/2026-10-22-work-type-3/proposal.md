# Change: เพิ่ม work type 3 ชนิดและบังคับส่วนที่ขาดก่อนอนุมัติ

- **Change:** `work-type-3` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-21

## เหตุผล

งานแก้ข้อมูลครั้งเดียว งานเสริมความปลอดภัยโดยไม่มี bug เจาะจง และงานแก้ pipeline ยังไม่มี work type ของตัวเอง จึงตกเป็น code หรือ chore และไม่ต้องมีข้อมูลที่ผู้อนุมัติต้องใช้ นอกจากนี้ ml, experiment และ infra ยังอนุมัติได้โดยไม่มีเกณฑ์ประเมิน เงื่อนไขหยุด และค่าใช้จ่าย และงานระดับ high ไม่ต้องบอกวิธีย้อนกลับ change นี้เพิ่มชนิดงานและข้อบังคับเหล่านั้นสำหรับ draft ที่เริ่มใหม่เท่านั้น

## User story

- **P1** ในฐานะ ผู้อนุมัติ ฉันต้องการ งานแก้ข้อมูล งานเสริมความปลอดภัย และงาน pipeline มีข้อมูลตัดสินใจครบเหมือนงานชนิดอื่น เพื่อ ไม่ต้องอนุมัติงานเสี่ยงจากข้อมูลที่ขาด Requirement: new-work-types, data-fix-sections, security-sections, cicd-sections, cards-new-types.
- **P1** ในฐานะ ผู้อนุมัติ ฉันต้องการ งานระดับ high ต้องบอกวิธีย้อนกลับ และ ml, experiment, infra ต้องมีส่วนที่ขาด เพื่อ รู้ก่อนอนุมัติว่าถอยได้ หยุดได้ และเสียค่าใช้จ่ายเท่าไร Requirement: undo-required-high, per-type-required-fields.
- **P2** ในฐานะ ผู้เขียน draft ฉันต้องการ ถูกเตือนเมื่อ path บ่งชี้ความเสี่ยงที่ draft ไม่ได้ครอบคลุม เพื่อ เติมได้ก่อนขออนุมัติโดยไม่ถูกบล็อก Requirement: path-risk-note.

## เกณฑ์ความสำเร็จ

- work type ทั้งสามชนิดผ่านการตรวจเมื่อมี section บังคับครบ และได้ EDIT ระบุฟิลด์ที่ขาดเมื่อไม่ครบ ตามที่ test ตรวจ
- draft high ที่ไม่มี undo ได้ EDIT 100% ของเคสที่ทดสอบ และ change ที่เริ่มแล้วไม่ถูกบล็อกในเคสใดเลย
- ทุกข้อบังคับใหม่ผ่านได้ด้วยค่าที่ระบุชัดว่า ไม่มี หรือ ไม่ทราบ พร้อมเหตุผล และไม่มี gate ใหม่ใดถามผู้ใช้หรือกั้น advance หรือ Land หลัง start

## ขอบเขต

- **In scope:** งานทั้งสามแบบประกาศได้โดยไม่ต้องใช้ชนิดที่ไม่ตรง; ผู้อนุมัติรู้จำนวนแถวที่แก้ มี snapshot ย้อนกลับได้ และรันซ้ำไม่เสียหาย; งานเสริมความปลอดภัยที่ไม่มี bug เจาะจงมี threat model และวิธีพิสูจน์ครบ; การแก้ pipeline ที่รันด้วยสิทธิ์สูงมี plan และไม่ถูกมองเป็นโค้ดทั่วไป; ผู้อนุมัติเห็นเกณฑ์ประเมิน เงื่อนไขหยุด และค่าใช้จ่ายก่อนอนุมัติ; งานเสี่ยงสูงไม่ถูกอนุมัติโดยไม่บอกวิธีถอย; ผู้เขียนรู้ว่าความเสี่ยงจาก path ยังไม่ถูกครอบคลุม; งานสามชนิดใหม่มีการ์ดตัดสินใจและรายการตรวจที่ตรงกับกฎบังคับ; ไม่มีกฎใหม่ใดทำให้ draft ติดโดยไม่มีทางไปต่อ และงานถึง Land ได้เสมอ
- **Out of scope:** edits outside `.claude/harness/runtime/contracts/work-types.mjs`, `.claude/harness/runtime/workflow/validation/work-type-fields.mjs`, `.claude/harness/runtime/workflow/validation/design-blueprints.mjs`, `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/outline-contract.mjs`, `.claude/harness/runtime/workflow/change-policy.mjs`, … +13 more; the authored Non-goals below

## Non-goals

- ไม่เปลี่ยน protocol.json
- ไม่บังคับ discovery coverage จาก path
- ไม่บล็อก change ที่เริ่มหรืออนุมัติแล้ว
- ไม่เพิ่ม provider ใหม่ที่ผู้ใช้ต้องตั้งค่า
- ไม่มี gate ใหม่ที่ถามผู้ใช้ หรือกั้น Land

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| work-type-catalog | 8: new-work-types, data-fix-sections, security-sections, cicd-sections, per-type-required-fields, undo-required-high, … +2 more | T001, T002, T003, T004 |
| approval-package | cards-new-types | T003, T004 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เพิ่ม work type data-fix, security, cicd บังคับ undo ที่ระดับ high และส่วนที่ขาดของ ml, experiment, infra และเตือนเมื่อ path เสี่ยงไม่มี discovery

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| new-work-types | ประกาศชนิดใหม่ | success | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | ชนิดเดิมไม่เปลี่ยน | boundary | T001, T004 |  |  |
|  | ชนิดไม่รู้จัก | failure | T001, T004 |  |  |
| data-fix-sections | ครบ | success | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | ระบุไม่ทราบ | boundary | T001, T004 |  |  |
|  | ขาด snapshot | failure | T001, T004 |  |  |
|  | ไม่มี dataFix | failure | T001, T004 |  |  |
| security-sections | ครบ | success | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | ขาด verification | failure | T001, T004 |  |  |
| cicd-sections | อนุมานจาก path | success | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | ไม่เพิ่ม provider | boundary | T001, T004 |  |  |
|  | ขาดสิทธิ์ | failure | T001, T004 |  |  |
| per-type-required-fields | change ที่เริ่มแล้ว | boundary | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | ระบุไม่ทราบ | boundary | T001, T004 |  |  |
|  | ml ขาด evaluation | failure | T001, T004 |  |  |
|  | experiment ขาด stopRules | failure | T001, T004 |  |  |
|  | infra ขาด costDelta | failure | T001, T004 |  |  |
| undo-required-high | มี rollback เดิม | success | T002, T004 | test: `.claude/harness/tests/**` | — |
|  | ระดับ medium | boundary | T002, T004 |  |  |
|  | amend ไม่ถูกบล็อก | boundary | T002, T004 |  |  |
|  | ระบุว่าย้อนกลับไม่ได้ | boundary | T002, T004 |  |  |
|  | high ไม่มี undo | failure | T002, T004 |  |  |
| path-risk-note | path เสี่ยงไม่มี coverage | success | T002, T004 | test: `.claude/harness/tests/**` | — |
|  | มี coverage แล้ว | boundary | T002, T004 |  |  |
|  | ไม่มี path เสี่ยง | boundary | T002, T004 |  |  |
| cards-new-types | การ์ดข้อมูล | success | T003, T004 | test: `.claude/harness/tests/**` | — |
|  | การ์ด pipeline | success | T003, T004 |  |  |
|  | ไม่มีป้ายแนะนำแล้ว | boundary | T003, T004 |  |  |
| never-blocks-land | ระบุไม่ทราบพร้อมเหตุผล | success | T001, T002, T003, T004 | test: `.claude/harness/tests/**` | — |
|  | ระบุไม่มีวิธีย้อนกลับ | success | T001, T002, T003, T004 |  |  |
|  | ไม่ถามผู้ใช้ | boundary | T001, T002, T003, T004 |  |  |
|  | หลัง start ไม่ขวาง Land | boundary | T001, T002, T003, T004 |  |  |
|  | ไม่มีเหตุผล | failure | T001, T002, T003, T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (33).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | new-work-types, undo-required-high, path-risk-note, never-blocks-land |  |  |
| input-boundary | covered | data-fix-sections, security-sections, cicd-sections, per-type-required-fields |  |  |
| compatibility | covered | per-type-required-fields, undo-required-high |  |  |
| non-goals | covered | path-risk-note, new-work-types |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (10); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 2 (2026-10-21): รายการตรวจต้องแสดงฟิลด์ย่อยที่บังคับ (modelCard.evaluation, experimentDesign.guardrails/stopRules, infraPlan.costDelta และฟิลด์ของ dataFix hardening pipelinePlan) เป็น ✕ เมื่อขาด โดยใช้รายการเดียวกับ validator จึงต้อง export รายการนั้นจาก work-type-fields.mjs และให้ dev-document.mjs อ่าน

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-cicd-path-deployment: cicd-sections-prove says a cicd change needs no capability that requires a provider beyond test. The change only checks the work-type map: capabilitiesForWorkTypes(['cicd']) returns [] (tested at change-policy-surface.test.mjs:431). But the existing path policy (change-policy.mjs:265-267) still adds the 'deployment' capability for any `.github/workflows/` path. That is the exact path used by cicd-sections-compile, so a typical inferred cicd change still requires 'deployment' at Prove. The comment 'a pipeline change adds none beyond the default test' is therefore only true for the work-type contribution. Either word the claim and comment as 'the work type adds none', or exempt cicd-declared or cicd-inferred changes from the path rule if the stronger outcome is intended. (root/.claude/harness/runtime/workflow/change-policy.mjs:71) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F2-undo-level-divergence: undoIssues computes the level with riskLevel({ riskSignals, impact }) only. The approval page level (routeChange) also counts path-inferred signals, such as high-operational-risk from `.tf` or `.github/workflows/`, and applies the browser-storage `light` exemption. As a result a medium draft touching terraform can show as High on the page without being asked for undo. In the other direction, a browser-storage draft that declares persisted-data-change is forced to give an undo even though the page shows Medium. The comment that the page and the rule 'cannot disagree' holds for the undo answer, not for the level. (root/.claude/harness/runtime/workflow/undo-plan.mjs:53) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F3-undo-bare-rollback: undoPlan treats any non-empty text in an existing rollback field as an answer. A High draft with rollout.rollback, migrationPlan.rollbackWindow or dependencyChange[].rollbackPin set to a bare 'none' or 'unknown' therefore passes the undo rule without a reason. bareAbsenceIssue is applied only to scratch.undo, and to dataFix/pipelinePlan through their own validators. The requirement asks that 'none' always comes with a reason. (root/.claude/harness/runtime/workflow/undo-plan.mjs:36) | minor | ยังเปิดอยู่ | claude-opus |
