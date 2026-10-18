# Change: ให้ผู้อนุมัติเห็นและลองงานก่อนอนุมัติ ตามบทบาทของตน

- **Change:** `approval-package-route-change` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-18

## สรุป

เพิ่ม Scratch Router ใน change เดียวแบ่ง 3 ส่วน: approval package ที่ปรับความลึกตามความเสี่ยงและแบ่งตามบทบาท, ขั้น preview ที่เลือกใช้ได้เพื่อลองผลจริงก่อน Build และการอนุมัติราย lane ตามบทบาท

## เหตุผล

ตอนนี้ผู้อนุมัติเห็นเพียง packet markdown, diagram เป็นโค้ด mermaid ที่ไม่ได้ render, ไม่มีผลทดลองก่อน Build และมีผู้อนุมัติคนเดียว ทีมที่มีหลายบทบาทจึงตรวจงานได้ยากก่อนลงมือ change นี้ทำให้ผู้อนุมัติเห็นและลองงานได้ตามขอบเขตของตนก่อนเริ่ม Build

## User story

- **P1** ในฐานะ ผู้อนุมัติ change ฉันต้องการ เปิดหน้าเดียวแล้วเห็น flow, design, ผลกระทบ, test และสถานะหลักฐานที่ตรงกับความเสี่ยงของงาน เพื่อ ตัดสินใจหรือขอแก้ได้ก่อนมีโค้ด Requirement: route-change, package-render, package-labels, preview-suggestions, approval-links-package.
- **P2** ในฐานะ Tech Lead ฉันต้องการ ลองผลจริงจาก scratch เช่น mock API, migration dry-run หรือ plan ก่อนอนุมัติ เพื่อ อนุมัติจากผลทดลอง ไม่ใช่จาก diagram อย่างเดียว Requirement: preview-run, preview-never-proof, preview-optional, preview-external-authority, preview-stale.
- **P3** ในฐานะ ทีมที่มีหลายบทบาท ฉันต้องการ ให้แต่ละบทบาทอนุมัติเฉพาะ lane ของตน เพื่อ ไม่ต้องให้ทุกคนอนุมัติทุกงาน Requirement: approval-lanes, approval-lane-record, legacy-approval, lane-carry.

## เกณฑ์ความสำเร็จ

- change ที่ compile แล้วทุกตัว รวม draft v3 สร้าง package ได้ด้วยคำสั่งเดียว และ state digest ไม่เปลี่ยน
- preset ถอนเงินได้ระดับ Critical และ preset docs-only ได้ artifact เพียง change impact กับ test map ตาม unit test
- preview receipt ที่ถูกคัดลอกเข้า receipts ถูกปฏิเสธเป็น preview-evidence ทุกครั้ง
- เมื่อไม่ได้เปิด approval.roles ผลการรัน full suite เท่ากับก่อนเปลี่ยน

## ขอบเขต

- ตาราง router 28 domain ใน runtime/contracts ครอบ workType และ riskSignals เดิม
- คำสั่ง package สร้าง HTML อ่านอย่างเดียว
- คำสั่ง preview รัน provider ใน .foundation/previews/<id>/
- guard ปฏิเสธ preview receipt ใน Prove
- approval.roles ใน foundation.json และ advance --approve-spec --role
- bump protocol และ runtime API พร้อมเอกสาร EN/TH

- **In scope:** routeChange() คืน intent, domain จาก 28 ประเภท, ระดับ Low/Medium/High/Critical และ artifact ที่ไม่ซ้ำพร้อมบทบาท; คำสั่ง package เขียนไฟล์ HTML ของ change ใน .foundation/packages ที่มี diagram, artifact แยกตามบทบาท และสถานะหลักฐาน; ป้าย proof ปรากฏเฉพาะ artifact ที่มี receipt ใช้ได้ตาม receiptValidity; package มีส่วน preview ที่แนะนำ ซึ่งบอก capability, provider ที่ตรงกันใน evidence.yaml และคำสั่งที่ใช้รัน; ผลของ change start และ advance ที่หยุดรออนุมัติมี path ของ package; คำสั่ง preview คัดลอก target ไปยัง workspace ใน .foundation/previews ของ change รัน provider ที่เลือก และเขียน preview receipt; receiptValidity คืน preview-evidence สำหรับ receipt ที่มี kind preview ไม่ว่าอยู่ที่ใด; change ระดับ Critical ที่ไม่มี preview เข้า Build ได้หลังอนุมัติ; receipt ของ provider external บันทึก decisionRef และ environment; package แสดง preview ของ revision เก่าด้วยป้าย stale; lane ที่ต้องมีคือบทบาทที่ routeChange() เลือกและอยู่ใน approval.roles; advance --approve-spec --role พร้อม --decision-ref บันทึก lane ของบทบาทนั้นใน specApproval.lanes พร้อม identity, revision, decisionRef และ approvedAt; state เดิมและ consumer ที่ไม่ตั้ง approval.roles ทำงานเหมือนก่อนเปลี่ยน; กฎเดียวกับ carrySpecApproval ใช้กับทุก lane
- **Out of scope:** edits outside `.claude/harness/runtime/contracts/scratch-router.mjs`, `.claude/harness/tests/scratch-router.test.mjs`, `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/runtime/composition/bootstrap.mjs`, `.claude/harness/runtime/core/cli-router.mjs`, … +40 more; the authored Non-goals below

## Non-goals

- ไม่เปลี่ยนหรือแยกค่า workType
- ไม่ยืนยันตัวตนผู้อนุมัติกับระบบภายนอก
- ไม่บังคับ preview ที่ระดับความเสี่ยงใด
- ไม่สร้าง scratch ลงใน working tree ของ target

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| approval-package | route-change, package-render, package-labels, preview-suggestions, approval-links-package | T001, T002, T003, T007 |
| preview-stage | preview-run, preview-never-proof, preview-optional, preview-external-authority, preview-stale | T004, T005, T007 |
| approval-lanes | approval-lanes, approval-lane-record, legacy-approval, lane-carry | T006, T007 |

## ผลกระทบและความเสี่ยง

change นี้แตะ gate อนุมัติก่อน Build ซึ่งเป็นสัญญาด้านสิทธิ์ ค่าเริ่มต้นจึงคงพฤติกรรมเดิมทั้งหมด (ไม่ตั้ง approval.roles เท่ากับอนุมัติครั้งเดียวแบบเดิม) preview ที่เรียก sandbox ภายนอกได้ต้องมี decision-ref ราย run ส่วน working tree ปัจจุบันมีไฟล์ runtime ที่ยังไม่ commit หลายไฟล์ซ้อนกับ change นี้ Land จะ merge กับไฟล์เหล่านั้นตามกติกา target-edit-sync

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เพิ่มคำสั่ง package สำหรับ approval package, คำสั่ง preview ที่เลือกใช้ได้ และการอนุมัติตามบทบาทเมื่อเปิดใน foundation.json

## วิธีตรวจด้วยตัวเอง

1. รัน package กับ change นี้ แล้วเปิด .foundation/packages/scratch-router.html ควรเห็นระดับความเสี่ยง, domain และส่วนของแต่ละบทบาท
2. ตั้ง approval.roles เป็น tech-lead กับ qa แล้วอนุมัติแค่ tech-lead จากนั้นสั่ง Build ควรถูกปฏิเสธพร้อมชื่อ qa
3. ลบ approval.roles ออก ทุกอย่างควรทำงานเหมือนเดิม

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| route-change | ตัวอย่างถอนเงิน | success | T001 | test: `.claude/harness/tests/scratch-router.test.mjs` | — |
|  | งาน docs อย่างเดียว | boundary | T001 |  |  |
|  | workType ที่ไม่รู้จัก | failure | T001 |  |  |
| package-render | สร้าง package | success | T002, T007 | test, accessibility: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/command-registry.test.mjs`, `.claude/tests/harness/run-installer-tests.sh`, `.claude/tests/run-all.sh` | — |
|  | ไม่แก้ state | boundary | T002, T007 |  |  |
|  | draft v3 ไม่มี draftSource | boundary | T002, T007 |  |  |
|  | ไม่พบ change | failure | T002, T007 |  |  |
| package-labels | มี receipt ใช้ได้ | success | T002 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/command-registry.test.mjs`, `.claude/tests/harness/run-installer-tests.sh` | — |
|  | มีแต่ preview | failure | T002 |  |  |
| preview-suggestions | Critical มี provider | success | T002 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/command-registry.test.mjs`, `.claude/tests/harness/run-installer-tests.sh` | — |
|  | ระดับ Medium | boundary | T002 |  |  |
|  | ไม่บล็อก | boundary | T002 |  |  |
|  | ยังไม่มี provider | failure | T002 |  |  |
| approval-links-package | แนบ package | success | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs` | — |
|  | render ล้มเหลว | failure | T003 |  |  |
| preview-run | รัน provider | success | T004, T007 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/preview-runtime.test.mjs`, `.claude/tests/harness/run-installer-tests.sh`, `.claude/tests/run-all.sh` | — |
|  | provider ไม่มี | failure | T004, T007 |  |  |
| preview-never-proof | คัดลอก preview เข้า receipts | failure | T005 | test: `.claude/harness/tests/preview-evidence.test.mjs` | — |
| preview-optional | Critical ไม่มี preview | boundary | T004 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/preview-runtime.test.mjs`, `.claude/tests/harness/run-installer-tests.sh` | — |
| preview-external-authority | มีสิทธิ์ | success (allow) | T004 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/preview-runtime.test.mjs`, `.claude/tests/harness/run-installer-tests.sh` | — |
|  | ไม่มีสิทธิ์ | failure (deny) | T004 |  |  |
| preview-stale | revise หลัง preview | boundary | T004 | test: `.claude/harness/tests/public-command-golden.test.mjs`, `.claude/harness/tests/preview-runtime.test.mjs`, `.claude/tests/harness/run-installer-tests.sh` | — |
| approval-lanes | ครบทุก lane | success (allow) | T006, T007 | test: `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/user-decisions.test.mjs`, `.claude/harness/tests/change-revise.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | บทบาทที่ router ไม่เลือก | boundary | T006, T007 |  |  |
|  | ขาด lane | failure (deny) | T006, T007 |  |  |
| approval-lane-record | บันทึก lane | success | T006 | test: `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/user-decisions.test.mjs`, `.claude/harness/tests/change-revise.test.mjs` | — |
|  | บทบาทที่ไม่รู้จัก | failure | T006 |  |  |
| legacy-approval | อนุมัติไม่ระบุ role | success | T006 | test, compatibility: `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/user-decisions.test.mjs`, `.claude/harness/tests/change-revise.test.mjs` | — |
|  | state เก่า | boundary | T006 |  |  |
| lane-carry | revision แบบเพิ่ม | success | T006 | test: `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/user-decisions.test.mjs`, `.claude/harness/tests/change-revise.test.mjs` | — |
|  | revision ลบ requirement | failure | T006 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (31).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: การสืบค้น

- **ID:** scratch-router
- **ผลลัพธ์:** ready-for-change
- **สรุป:** ทำได้ และ harness มีส่วนประกอบราว 60% อยู่แล้ว ได้แก่ workType, riskSignals, discovery dimensions, ความลึกตามความเสี่ยง, design blueprints, mermaid, prototype sandbox และ provider catalog ส่วนที่ขาดจริงมี 3 อย่าง: (1) ตารางที่รวมทุกอย่างเป็น domain tags → artifact → บทบาท และ package ที่ render ให้คนดูได้ (2) ยังไม่มีขั้น preview ที่รันได้ก่อน Build (3) การอนุมัติมีผู้อนุมัติคนเดียว แนะนำเริ่มที่ o1-package-projection ซึ่งไม่เปลี่ยน protocol และไม่รันโค้ด แล้วค่อยทำ o2 กับ o3 เป็น change แยก เพราะทั้งสองแก้สัญญาหลักฐานและสัญญาสิทธิ์อนุมัติ กฎ evidence-based approval ของผู้ใช้จะครบจริงก็ต่อเมื่อทำ o2 แล้ว
- **เจตนาของ change:** Scratch Router ใน change เดียว 3 slice: (P1) ตาราง router ใน runtime/contracts ครอบ workType/riskSignals เดิม + คำสั่ง package สร้าง approval package HTML แบบอ่านอย่างเดียว แบ่งตามบทบาท ติดป้าย preview/proof; (P2) ขั้น preview ที่เลือกใช้ได้ระหว่าง compile กับ approve รันใน workspace แยก ออก preview receipt ที่ไม่มีวันนับเป็น Prove อนุญาต sandbox ภายนอกภายใต้สิทธิ์ external operation; (P3) specApproval ราย lane ตามบทบาทที่ router เลือก บันทึกตามคำบอก state เก่าที่มีการอนุมัติครั้งเดียวถือว่าครบทุก lane
- **State:** .foundation/investigations/scratch-router.json @ 03125b88bbf42a8729b7027166d323b674c258a96c54df3f079170f4ca023c2b
- **Sources:** sha256:2ae0b955b551d24ce1c71ae04da7442c0c90a83f8e3a9f36c7de45d3c10e92b0

เป้าหมาย: ให้เห็นงานก่อนอนุมัติ ปรับปรุงได้ก่อนลงมือ และเริ่มงานได้ง่าย

ผลลัพธ์ที่ต้องการ: รู้ว่า Scratch Router ทำได้แค่ไหนบน harness ปัจจุบัน ส่วนไหนมีแล้ว ส่วนไหนขาด แนวทางที่แนะนำ และตัวอย่าง scratch ของงานนี้เอง

### ขอบเขตและผู้เกี่ยวข้อง

- runtime/contracts/work-types.mjs
- runtime/workflow/validation/design-blueprints.mjs
- runtime/workflow/validation/semantic-intake.mjs
- runtime/workflow/validation/semantic-intake-intelligence.mjs
- runtime/evidence/review-routing.mjs
- .claude/skills/harness-html-report
- user
- agent
- harness
- product-owner
- tech-lead
- qa
- devops-security

### ความครบของ requirement

| Source | Requirement | สถานะ | Targets | รายละเอียด |
|---|---|---|---|---|
| see-before-approve@1 | สร้าง approval package ที่ให้ผู้อนุมัติเห็นงานก่อนอนุมัติ และปรับปรุงก่อนลงมือได้ | behavior / stated / user | requirement: package-render; requirement: approval-links-package | — |
| three-dimensions@1 | router จำแนกงานด้วย 3 มิติ: Change Intent (WHY), Technical Domain (WHERE, 28 ประเภทใน 6 กลุ่ม), Risk Level (Low/Medium/High/Critical) งานเดียวมีได้หลาย domain | behavior / stated / user | requirement: route-change | — |
| no-workflow-per-type@1 | ไม่ทำ 28 workflow แยกกัน ใช้ pipeline เดียว: Task → Intent → Codebase Analysis → Domain Detection → Risk → Scratch Generator → Approval Package → Implementation | constraint / stated / user | requirement: route-change; design: d-table-in-contracts | — |
| existing-code-first@1 | ถ้ามีโค้ดเดิม ต้องวิเคราะห์ As-Is และ Change Impact ก่อนสร้าง scratch | behavior / stated / user | requirement: route-change | — |
| dedupe-artifacts@1 | งานหลาย domain สร้าง artifact ร่วมกันโดยไม่ซ้ำ | behavior / stated / user | scenario: route-change / ตัวอย่างถอนเงิน | — |
| risk-based-depth@1 | ความเสี่ยงต่ำใช้เพียง diff preview + test ไม่ต้องทำ prototype ทุกงาน | behavior / stated / user | scenario: route-change / งาน docs อย่างเดียว | — |
| evidence-based-approval@1 | ผู้อนุมัติต้องเห็นผลทดลองจริง ไม่ใช่เพียง diagram ที่ AI สร้าง | constraint / stated / user | requirement: preview-run; requirement: package-labels | — |
| role-scoped@1 | แต่ละบทบาท (PO, Tech Lead, QA, DevOps/Security) เห็นและอนุมัติเฉพาะขอบเขตของตน ไม่ต้องอนุมัติทุกงาน | behavior / stated / user | requirement: approval-lanes; requirement: approval-lane-record | — |
| keep-worktype@1 | ไม่แยก workType ใหม่ ใช้ตาราง mapping ครอบ workType/riskSignals เดิม ไม่เปลี่ยน protocol | constraint / stated / user | non-goal: ไม่เปลี่ยนหรือแยกค่า workType; design: q-taxonomy | — |
| investigate-only@1 | รอบนี้ทำ investigation หา solution และแสดงว่า scratch ของงานนี้จะเป็นอย่างไร ยังไม่แก้โค้ด | constraint / stated / user | design: q-phases | — |
| all-phases@1 | ทำครบ P1 (ตาราง router + approval package), P2 (scratch ที่รันได้ก่อนอนุมัติ), P3 (อนุมัติตามบทบาท) แล้ว Land ทีเดียว | behavior / stated / user | design: q-phases | — |
| preview-optional@1 | scratch ที่รันได้เลือกใช้ได้ทุกระดับความเสี่ยง ไม่บังคับและไม่บล็อกการอนุมัติ | behavior / stated / user | requirement: preview-optional; non-goal: ไม่บังคับ preview ที่ระดับความเสี่ยงใด | — |
| external-sandbox@1 | scratch ใช้ sandbox ภายนอกได้ (เช่น payment sandbox, staging) ต้องมี credential และสิทธิ์ external operation ทุกครั้ง | constraint / stated / user | requirement: preview-external-authority | — |
| role-recorded@1 | P3 บันทึกผู้อนุมัติแต่ละบทบาทตามที่แจ้ง (decisionRef + บทบาท) harness ไม่ยืนยันตัวตน | constraint / stated / user | requirement: approval-lane-record; non-goal: ไม่ยืนยันตัวตนผู้อนุมัติกับระบบภายนอก | — |
| preview-suggestions@1 | package แนะนำ preview ที่เหมาะกับงาน โดยไม่บังคับ | behavior / stated / user | requirement: preview-suggestions | — |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

### สาระจากบทสนทนา

- u-idea [user]: เสนอ Scratch Router: 28 ประเภทงานใน 6 กลุ่มพร้อม approval artifact, 3 มิติ (intent/domain/risk), ตัวอย่างระบบถอนเงิน, กฎ 4 ข้อ (existing code first, multi-type, risk-based depth, evidence-based approval), pipeline เดียว และอนุมัติตามบทบาท (session message)
- u-scope [user]: investigation และหา solution และ scratch ของงานนี้จะเป็นยังไง (session AskUserQuestion answer)
- u-taxonomy [user]: ยังไม่แยก ใช้ตารางครอบ (Recommended) (session AskUserQuestion answer)
- u-all [user]: ทำจนถึง p1-p3 เลยได้ไหม ต้องทำอะไรบ้าง (session message)
- u-p2p3 [user]: preview: เลือกได้ทุกระดับ; boundary: อนุญาต sandbox ภายนอก; identity: บันทึกตามคำบอก; delivery: ทำครบ 3 phase แล้ว Land ทีเดียว (session AskUserQuestion answer)
- u-suggest [user]: เพิ่ม preview ที่แนะนำ (session message)

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | package-render, approval-lanes |  |  |
| compatibility | covered | legacy-approval, package-render |  |  |
| input-boundary | covered | route-change, approval-lane-record |  |  |
| security-privacy | covered | approval-lanes, preview-external-authority |  |  |
| permission-rejection | covered | approval-lanes, preview-external-authority |  |  |
| data-migration | covered | legacy-approval |  |  |
| rollout-rollback | covered | legacy-approval, preview-optional |  |  |
| recoverability | covered | approval-links-package, lane-carry |  |  |
| operability | covered | approval-links-package, preview-run |  |  |
| accessibility | covered | package-render |  |  |
| external-authority | covered | preview-external-authority |  |  |

Harness derive จากเนื้อหา draft (6): affected-actor, desired-behavior, success-path, failure-path, non-goals, verification.

## Amendment discovery coverage

Reason: Prove review found three approval-lane cases the agreement did not settle; the user chose to fix them before Land

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| security-privacy | covered | lane-recompute | none | none |
| permission-rejection | covered | lane-recompute, lane-after-full | none | none |
| input-boundary | covered | approval-config-type | none | none |
| compatibility | covered | lane-recompute | none | none |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (11); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ประวัติการแก้ไข

- Revision 2 (2026-10-18): Build พบว่าการ render mermaid ในหน้าโดยไม่โหลดอะไรจากภายนอกต้องรวม mermaid library ไว้ใน harness ซึ่งไม่มี จึงฝัง mermaid block ที่ viewer ที่รองรับ render ได้ และอ่าน source ได้เมื่อไม่รองรับ
- Revision 3 (2026-10-18): The runtime API pin is also asserted by the landing page and the upgrade matrix test, so the pin task must update them
- Revision 4 (2026-10-18): Prove review found three approval-lane cases the agreement did not settle; the user chose to fix them before Land

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-proof-label-status-mismatch: buildModel adds a capability to `proven` only when `(result.receipt?.status ?? result.status) === "passed"`. Harness receipts use status values pass\|fail\|inconclusive\|error (receipt-runtime.mjs:566; receiptValidity returns `{ validity: "valid", receipt: value }` at receipt-validity.mjs:435), so a real valid passing `test` receipt has status "pass" and the test map is labeled "no evidence yet" instead of `proof`. The package-labels requirement (valid receipt => proof) therefore never holds outside tests. approval-package.test.mjs:90 uses a fabricated `receipt: { status: "passed" }` fixture that hides the mismatch. Accept the canonical "pass" status (and fix the fixture to the real receipt shape). (root/.claude/harness/runtime/workflow/approval-package.mjs:187) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-lane-approval-revokes-whole-approval: After a role-less approval (which by spec covers every lane and stores no `lanes`), a later `--approve-spec --role qa` rebuilds `lanes` from the empty prior set, finds other required lanes missing, and replaces specApproval with a partial `{ required, lanes, requiredLanes }` without identity, revoking the whole approval. Likewise preserveSpecApprovalAcross (user-decisions.mjs:200) carries identity but not lane identities, so a later lane re-approval filters the carried lanes out. Fail-safe (Build asks again) but contradicts 'approval without role covers every lane'. (root/.claude/harness/runtime/workflow/change-lifecycle.mjs:2383) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-change-resolve-role-ignored: `role` is now an accepted value flag for `change resolve`, but resolveChange only checks `--role applies only to --approve-spec` inside the decision branch; `change resolve <id> --role qa --impact high` (no decision flag) silently ignores --role instead of refusing, unlike `advance --role` which is rejected without --approve-spec. (root/.claude/harness/runtime/core/cli-router.mjs:209) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-vacuous-preview-optional-test: 'a Critical change without any preview still passes the approval gate' passes `specApproval: null`, which makes assertSpecApproval return at its legacy early exit; it never exercises an approved Critical change through the gate or advance --through build, so it does not establish the preview-optional / 'ไม่บล็อก' scenario (behavior holds only by code inspection: no Build path reads previews). (root/.claude/harness/tests/preview-runtime.test.mjs:116) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 3 | M1-role-approval-downgrades-full-approval: A `--role` approval rebuilds `specApproval` only from the lanes already recorded. If a full approval without a role already exists, it has no `lanes`. A later `--approve-spec --role qa` then gives `lanes = { qa }`, and because the other required lanes are missing, line 2390 overwrites `specApproval` with `{ required, lanes, requiredLanes }`. That drops the existing `identity` and `decisionRef`. A full approval the user already gave is withdrawn, and Build stops asking for lanes that the legacy-approval requirement says it already covers. It fails safe (more approval, never less), so this is minor. Suggested fix: when the current `specApproval.identity` matches this packet and revision, keep it and only add the lane record. (root/.claude/harness/runtime/workflow/change-lifecycle.mjs:2383) | minor | แก้แล้วในรอบ 4 | claude-opus |
| 3 | M2-change-resolve-role-silently-ignored: The `change resolve` parser now accepts `--role`, but `resolveChange` checks it only inside the decision-flag branch. `change resolve <id> --role qa --impact high`, with no `--approve-spec`, goes down the attribute-edit path and drops `--role` without an error. `advance` rejects `--role` without `--approve-spec` (cli-router.mjs:476), but `change resolve` does not. Suggested fix: refuse `flags.role` outside the `approve-spec` branch. (root/.claude/harness/runtime/workflow/change-lifecycle.mjs:2332) | minor | แก้แล้วในรอบ 4 | claude-opus |
| 4 | F1-amendment-lane-recompute-uses-stale-risk-signals: In the semantic-amendment path, `carrySpecApproval(priorState, nextState, …)` runs at line 3313. The amendment's risk signals are merged into `nextState.riskSignals` only later, at lines 3327-3329. Inside the carry, the new lane recompute (`approvalLanes(id, next)`, line 2745, which calls `routeForState` in foundation.mjs) therefore routes on the pre-amendment `riskSignals`. It also gets no current draft: `nextState.draftSource.contractRevision` is the old revision, so `currentDraft` returns null and draft `integrations` are dropped too. Example: an amendment adds `access-control` or `financial`, which routes domain 10 or 11 and so the `security` role. `security` is not in `required`, `missing` is empty, and the full approval carries with its `identity` and the old `requiredLanes`. `assertSpecApproval` then passes at Land without the security lane. This breaks the lane-recompute requirement ("recompute required lanes when a revision or amendment carries approval, and ask only for the added lanes"). It fails open on an access-control gate. The revise path is correct because `persistRiskSignals` (line 2949) and `next.draftSource` (line 2966) are set before its carry. The change-revise tests mock `approvalLanes` and cover only `change revise`, so this path is untested. Fix: merge the amendment's `riskSignals` (and refresh any draft-derived routing inputs) into `nextState` before calling `carrySpecApproval`, and add an amendment test where a new risk signal routes a new lane. (root/.claude/harness/runtime/workflow/change-lifecycle.mjs:3313) | major | ยืนยันการแก้ในรอบ 5 | claude-opus |
