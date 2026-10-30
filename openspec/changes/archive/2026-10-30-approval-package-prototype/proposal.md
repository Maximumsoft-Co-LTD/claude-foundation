# Change: skill prototype สร้างหน้าอนุมัติ harness แค่ส่งข้อมูลและตรวจ

- **Change:** `approval-package-prototype` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

หน้า approval package ที่ harness เรนเดอร์เป็นการ์ดและตารางเทคนิค ผู้ใช้อ่านไม่เข้าใจจึงไม่มีใครเปิด และเมื่อ agent ไม่เขียน prototype ก็ไม่มีภาพให้ดู change นี้ให้ skill prototype เป็นผู้สร้างทั้งหน้าอนุมัติ ใช้ design ของแต่ละ project ส่วน harness เลิกสร้างหน้า เหลือส่งข้อมูลที่คำนวณเอง (ความเสี่ยง proof role รายการที่ต้องแสดง สถานะ drift) และตรวจว่าหน้าตรงกับข้อมูลล่าสุดหรือไม่

## ขอบเขต

- **In scope:** skill prototype สร้างทั้งหน้าอนุมัติ ใช้ design token ของ project รู้เองว่า change นี้ต้องแสดงอะไร ครบทุก work type; harness เลิกเรนเดอร์ HTML คำสั่ง package พิมพ์ข้อมูล JSON แทน ได้แก่ ความเสี่ยง proof role รายการที่ต้องแสดง สถานะครอบคลุม และ drift; harness เตือนเมื่อหน้าถูกแก้หลังฉบับล่าสุด หรือข้อมูลของ harness ในหน้าล้าสมัย โดยไม่กั้น; แก้ prototype แล้ว skill ต้อง revise หรือ amend change ให้ตรงในรอบเดียวกัน; ถ้า host มีที่แสดงผลแบบ design (skill /design หรือ Artifact ชนิด design) skill แสดงที่นั่นด้วย
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/prototype-checklist.mjs`, `.claude/harness/runtime/workflow/scratch-fields.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/prototype-checklist.test.mjs`, `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/tests/run-all.sh`, … +20 more; the authored Non-goals below

## Non-goals

- ไม่ให้ harness สร้างหน้าอนุมัติหรือภาพจำลองแทน skill
- ไม่ลบคำสั่ง package (เปลี่ยนเป็นพิมพ์ข้อมูล) และไม่แก้หน้า package เก่าที่เคยสร้างไว้
- ไม่ลบ vendor/mermaid.min.js เพื่อไม่กระทบตัวติดตั้ง
- ไม่ให้ agent หรือหน้าที่ skill เขียนกำหนดความเสี่ยง proof หรือ role
- ไม่ทำให้หน้าอนุมัติหรือ covers ที่ประกาศเป็น evidence หรือเป็นเงื่อนไขของ Prove หรือ Land
- ไม่ให้ prototype เป็นแหล่งความจริงแทน agreement: สิ่งที่หน้าเพิ่มหรือเปลี่ยนต้องไปแก้ใน change แล้วรออนุมัติตามกติกาเดิม
- ไม่ให้ skill แชร์หรือเผยแพร่หน้าให้ผู้อื่นโดยผู้ใช้ไม่สั่ง
- ไม่เปลี่ยนกติกา approval.roles

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| approval-package | 35: approval-data, approval-page-authored-by-skill, prototype-checklist, prototype-coverage-declared, facts-from-harness-only, prototype-sync, … +29 more | T001, T002, T003, T004, T005 |
| skill-guidance | approval-page-contract, prototype-skill-contract | T004 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

skill prototype สร้างหน้าอนุมัติ ส่วน harness ให้ข้อมูลผ่านคำสั่ง package และตรวจว่าหน้าตรงกับข้อมูลล่าสุด

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| approval-data | พิมพ์ข้อมูลครบ | success | T003, T005 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs` | — |
|  | ค่าที่ไม่ทราบ | boundary | T003, T005 |  |  |
|  | change ที่ไม่มี draft แบบ typed | boundary | T003, T005 |  |  |
|  | อ่าน evidence บางส่วนไม่ได้ | failure | T003, T005 |  |  |
| approval-page-authored-by-skill | มีหน้าแล้ว | success | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs` | — |
|  | ไม่เขียนไฟล์หน้า | boundary | T003 |  |  |
|  | ตัวอย่างใน draft ยังถูกตรวจ | boundary | T003 |  |  |
|  | ยังไม่มีหน้า | failure | T003 |  |  |
| prototype-checklist | งาน API | success | T001, T005 | test: `.claude/harness/tests/prototype-checklist.test.mjs`, `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | งานข้อมูล | success | T001, T005 |  |  |
|  | งานหน้าจอ | success | T001, T005 |  |  |
|  | ครบทุก work type | success | T001, T005 |  |  |
|  | หลายชนิดรวมกัน | success | T001, T005 |  |  |
|  | ฟิลด์ไม่ระบุ | boundary | T001, T005 |  |  |
|  | งานที่ไม่ต้องมีภาพมาก | boundary | T001, T005 |  |  |
|  | ชนิดใหม่ที่ยังไม่มีรายการ | failure | T001, T005 |  |  |
|  | ไม่กั้นการเริ่ม | failure | T001, T005 |  |  |
| prototype-coverage-declared | ครอบคลุมครบ | success | T001, T004 | test: `.claude/harness/tests/prototype-checklist.test.mjs`, `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ไม่ประกาศ covers | boundary | T001, T004 |  |  |
|  | key ที่ไม่รู้จัก | boundary | T001, T004 |  |  |
|  | ประกาศไม่ใช่ proof | boundary | T001, T004 |  |  |
|  | ยังขาด | failure | T001, T004 |  |  |
| facts-from-harness-only | ค่าความเสี่ยงมาจาก draft | success | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs` | — |
|  | preview ไม่ใช่ proof | boundary | T003 |  |  |
|  | หน้าอ้าง proof เอง | failure | T003 |  |  |
| prototype-sync | แก้ไฟล์แล้วเตือน | success | T002 | test: `.claude/harness/tests/prototype-sync.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | revise แล้วหายเตือน | success | T002 |  |  |
|  | ไม่มีไฟล์ | boundary | T002 |  |  |
|  | คำเตือนไม่ใช่หลักฐาน | boundary | T002 |  |  |
|  | ข้อมูลของ harness ในหน้าล้าสมัย | failure | T002 |  |  |
|  | แก้ไฟล์แต่ไม่แก้ change | failure | T002 |  |  |
| plain-approval-wording | คำถามอนุมัติ | success | T003, T005 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs` | — |
|  | ใช้คำสั่งเดิม | boundary | T003, T005 |  |  |
| approval-page-contract | ลำดับของหน้า | success | T004 | test | — |
|  | แถบข้อเท็จจริงคัดลอกจากข้อมูล | success | T004 |  |  |
|  | ค่าที่ไม่ทราบ | boundary | T004 |  |  |
|  | ป้ายไม่ใช่ proof | boundary | T004 |  |  |
|  | ไม่พึ่งเครือข่าย | boundary | T004 |  |  |
|  | ใช้คีย์บอร์ดและไม่พึ่งสี | boundary | T004 |  |  |
| prototype-skill-contract | อ่าน change ก่อนสร้าง | success | T004 | test | — |
|  | รู้เองว่าต้องแสดงอะไร | success | T004 |  |  |
|  | ใช้ design ของ project | success | T004 |  |  |
|  | แก้หน้าแล้วแก้ change | success | T004 |  |  |
|  | ใช้ canvas เมื่อมี design skill | success | T004 |  |  |
|  | แก้บน canvas แล้วส่งออกใหม่ | success | T004 |  |  |
|  | ทุก work type มีแนวทาง | boundary | T004 |  |  |
|  | ไม่มีที่แสดงผลแบบ design | boundary | T004 |  |  |
|  | ไม่แชร์เอง | boundary | T004 |  |  |
|  | ยังไม่มี change | failure | T004 |  |  |
|  | ขัดกับ agreement ที่อนุมัติแล้ว | failure | T004 |  |  |
|  | canvas ใช้ไม่ได้ | failure | T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (51).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| accessibility | covered | approval-page-contract |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (11); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for approval-data, approval-page-authored-by-skill, prototype-checklist, prototype-coverage-declared, facts-from-harness-only, prototype-sync, plain-approval-wording, approval-page-contract, prototype-skill-contract, package-render, package-content, package-preview-output, failure-table-filter, scratch-summary, scratch-examples, example-actual, package-language, package-offline-diagrams, decision-first-page, reviewer-details-collapsed, risk-meter, before-after-and-questions, failure-cards, type-cards, required-checklist, scratch-undo-who, thai-readable, cards-new-types, flow-in-card-a, sequence-in-cards, prototype-visible, diagram-layout, visual-fixes, no-decision-bar, approval-status-line, visual-polish, approval-links-package.

## Appendix: Amendment history

- Revision 9 (2026-10-30): Build found five other documents that still describe the harness writing an approval package; they must match the new behavior or readers are told something false
- Revision 10 (2026-10-30): The Thai quickstart must change with the English one to keep English/Thai parity

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | m1-advance-mixed-language: With no page yet, the advance approval message wraps the localized page name in fixed English: a Thai draft reads 'No หน้าอนุมัติ yet; the prototype skill writes it.' and an English draft reads 'No Approval page yet' with an unusual capital. No test covers how failureAction formats the approval message (only approvalPackageLine and approvalPageLink are tested). (root/.claude/harness/runtime/workflow/advance-runtime.mjs:1073) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | m2-landed-unreadable-receipt-silent: For a landed (archived or applied) change, a receipt that cannot be read or parsed is caught as 'no receipt for this provider' and adds no entry to warnings, unlike the unlanded path, which adds a notice naming the provider. The scenario asks for warnings that name the unreadable receipt. No test makes one provider's receipt check fail. (root/.claude/harness/runtime/workflow/approval-package.mjs:236) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | m3-covers-allowed-without-declared-types: coversIssues checks keys only against declared work types. When the draft declares none, any catalog surface key is accepted, while package and the change start note use a narrower list inferred from paths (or only 'ba'). A covers key outside this change's list then passes intake, although the spec asks for an EDIT for such a key. (root/.claude/harness/runtime/workflow/prototype-checklist.mjs:169) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | m4-states-label-hardcoded: The 'states' surface label always lists loading, empty, error and success instead of naming the screens and states the draft's uiStates declare, so a draft state such as 'offline' is not named in the checklist. (root/.claude/harness/runtime/workflow/prototype-checklist.mjs:18) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | m5-api-item-no-error-cases: The API checklist item gives a fixed label ('every error case') and the source field apiContracts, but does not name the draft's declared error cases (for example the 400 when the title is empty). The package data also does not include apiContracts, so the prototype skill must read the draft itself to show them. (root/.claude/harness/runtime/workflow/prototype-checklist.mjs:21) | minor | ยังเปิดอยู่ | claude-opus |
