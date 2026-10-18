<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: scratch-router

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-18T10:18:10.910Z · 03125b88bbf42a8729b7027166d323b674c258a96c54df3f079170f4ca023c2b

## ปัญหา

ผู้อนุมัติยังไม่เห็นงานในรูปที่ตรวจได้ก่อนอนุมัติ Change: design ที่ compile แล้วเป็นข้อความใน design.md ตามชนิดงาน ไม่มีชุดเอกสารอนุมัติ (approval package) ที่เลือกตามประเภทงาน × ส่วนของระบบ × ความเสี่ยง และไม่มีผลทดลองจริงก่อน Build

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** ให้เห็นงานก่อนอนุมัติ ปรับปรุงได้ก่อนลงมือ และเริ่มงานได้ง่าย

**ผลลัพธ์ที่ต้องการ:** รู้ว่า Scratch Router ทำได้แค่ไหนบน harness ปัจจุบัน ส่วนไหนมีแล้ว ส่วนไหนขาด แนวทางที่แนะนำ และตัวอย่าง scratch ของงานนี้เอง


### ผู้เกี่ยวข้อง

- user
- agent
- harness
- product-owner
- tech-lead
- qa
- devops-security

### ขอบเขต

- runtime/contracts/work-types.mjs
- runtime/workflow/validation/design-blueprints.mjs
- runtime/workflow/validation/semantic-intake.mjs
- runtime/workflow/validation/semantic-intake-intelligence.mjs
- runtime/evidence/review-routing.mjs
- .claude/skills/harness-html-report

### ข้อกำหนดล่าสุด

- **see-before-approve@1** [behavior / stated] สร้าง approval package ที่ให้ผู้อนุมัติเห็นงานก่อนอนุมัติ และปรับปรุงก่อนลงมือได้; ที่มา: user (u-idea)
- **three-dimensions@1** [behavior / stated] router จำแนกงานด้วย 3 มิติ: Change Intent (WHY), Technical Domain (WHERE, 28 ประเภทใน 6 กลุ่ม), Risk Level (Low/Medium/High/Critical) งานเดียวมีได้หลาย domain; ที่มา: user (u-idea)
- **no-workflow-per-type@1** [constraint / stated] ไม่ทำ 28 workflow แยกกัน ใช้ pipeline เดียว: Task → Intent → Codebase Analysis → Domain Detection → Risk → Scratch Generator → Approval Package → Implementation; ที่มา: user (u-idea)
- **existing-code-first@1** [behavior / stated] ถ้ามีโค้ดเดิม ต้องวิเคราะห์ As-Is และ Change Impact ก่อนสร้าง scratch; ที่มา: user (u-idea)
- **dedupe-artifacts@1** [behavior / stated] งานหลาย domain สร้าง artifact ร่วมกันโดยไม่ซ้ำ; ที่มา: user (u-idea)
- **risk-based-depth@1** [behavior / stated] ความเสี่ยงต่ำใช้เพียง diff preview + test ไม่ต้องทำ prototype ทุกงาน; ที่มา: user (u-idea)
- **evidence-based-approval@1** [constraint / stated] ผู้อนุมัติต้องเห็นผลทดลองจริง ไม่ใช่เพียง diagram ที่ AI สร้าง; ที่มา: user (u-idea)
- **role-scoped@1** [behavior / stated] แต่ละบทบาท (PO, Tech Lead, QA, DevOps/Security) เห็นและอนุมัติเฉพาะขอบเขตของตน ไม่ต้องอนุมัติทุกงาน; ที่มา: user (u-idea)
- **keep-worktype@1** [constraint / stated] ไม่แยก workType ใหม่ ใช้ตาราง mapping ครอบ workType/riskSignals เดิม ไม่เปลี่ยน protocol; ที่มา: user (u-taxonomy)
- **investigate-only@1** [constraint / stated] รอบนี้ทำ investigation หา solution และแสดงว่า scratch ของงานนี้จะเป็นอย่างไร ยังไม่แก้โค้ด; ที่มา: user (u-scope)
- **all-phases@1** [behavior / stated] ทำครบ P1 (ตาราง router + approval package), P2 (scratch ที่รันได้ก่อนอนุมัติ), P3 (อนุมัติตามบทบาท) แล้ว Land ทีเดียว; ที่มา: user (u-all, u-p2p3)
- **preview-optional@1** [behavior / stated] scratch ที่รันได้เลือกใช้ได้ทุกระดับความเสี่ยง ไม่บังคับและไม่บล็อกการอนุมัติ; ที่มา: user (u-p2p3)
- **external-sandbox@1** [constraint / stated] scratch ใช้ sandbox ภายนอกได้ (เช่น payment sandbox, staging) ต้องมี credential และสิทธิ์ external operation ทุกครั้ง; ที่มา: user (u-p2p3)
- **role-recorded@1** [constraint / stated] P3 บันทึกผู้อนุมัติแต่ละบทบาทตามที่แจ้ง (decisionRef + บทบาท) harness ไม่ยืนยันตัวตน; ที่มา: user (u-p2p3)
- **preview-suggestions@1** [behavior / stated] package แนะนำ preview ที่เหมาะกับงาน โดยไม่บังคับ; ที่มา: user (u-suggest)

### สาระจากบทสนทนา

- **u-idea** [user]: เสนอ Scratch Router: 28 ประเภทงานใน 6 กลุ่มพร้อม approval artifact, 3 มิติ (intent/domain/risk), ตัวอย่างระบบถอนเงิน, กฎ 4 ข้อ (existing code first, multi-type, risk-based depth, evidence-based approval), pipeline เดียว และอนุมัติตามบทบาท (session message)
- **u-scope** [user]: investigation และหา solution และ scratch ของงานนี้จะเป็นยังไง (session AskUserQuestion answer)
- **u-taxonomy** [user]: ยังไม่แยก ใช้ตารางครอบ (Recommended) (session AskUserQuestion answer)
- **u-all** [user]: ทำจนถึง p1-p3 เลยได้ไหม ต้องทำอะไรบ้าง (session message)
- **u-p2p3** [user]: preview: เลือกได้ทุกระดับ; boundary: อนุญาต sandbox ภายนอก; identity: บันทึกตามคำบอก; delivery: ทำครบ 3 phase แล้ว Land ทีเดียว (session AskUserQuestion answer)
- **u-suggest** [user]: เพิ่ม preview ที่แนะนำ (session message)

## ข้อสรุปปัจจุบัน

ทำได้ และ harness มีส่วนประกอบราว 60% อยู่แล้ว ได้แก่ workType, riskSignals, discovery dimensions, ความลึกตามความเสี่ยง, design blueprints, mermaid, prototype sandbox และ provider catalog ส่วนที่ขาดจริงมี 3 อย่าง: (1) ตารางที่รวมทุกอย่างเป็น domain tags → artifact → บทบาท และ package ที่ render ให้คนดูได้ (2) ยังไม่มีขั้น preview ที่รันได้ก่อน Build (3) การอนุมัติมีผู้อนุมัติคนเดียว แนะนำเริ่มที่ o1-package-projection ซึ่งไม่เปลี่ยน protocol และไม่รันโค้ด แล้วค่อยทำ o2 กับ o3 เป็น change แยก เพราะทั้งสองแก้สัญญาหลักฐานและสัญญาสิทธิ์อนุมัติ กฎ evidence-based approval ของผู้ใช้จะครบจริงก็ต่อเมื่อทำ o2 แล้ว

## ข้อเสนอแนะและเหตุผล

Scratch Router ใน change เดียว 3 slice: (P1) ตาราง router ใน runtime/contracts ครอบ workType/riskSignals เดิม + คำสั่ง package สร้าง approval package HTML แบบอ่านอย่างเดียว แบ่งตามบทบาท ติดป้าย preview/proof; (P2) ขั้น preview ที่เลือกใช้ได้ระหว่าง compile กับ approve รันใน workspace แยก ออก preview receipt ที่ไม่มีวันนับเป็น Prove อนุญาต sandbox ภายนอกภายใต้สิทธิ์ external operation; (P3) specApproval ราย lane ตามบทบาทที่ router เลือก บันทึกตามคำบอก state เก่าที่มีการอนุมัติครั้งเดียวถือว่าครบทุก lane

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **worktype-mixes-why-where:** WORK\_TYPES มี 23 ค่าที่ปนทั้ง intent (feature, bugfix, refactor, migration, experiment, deprecation) และ domain (api, ui, data, async, integration, infra, observability, privacy, ml, client-release) ไม่มี incident, enhancement, mobile, ci-cd, auth, payment, a11y/l10n, bi แยก ([.claude/harness/runtime/contracts/work-types.mjs](<../../.claude/harness/runtime/contracts/work-types.mjs>))
- **blueprints-by-worktype:** BY\_WORK\_TYPE ผูก workType กับ design section ที่ต้องมี: api→apiContracts, data→dataModel, ui→uiStates, config→configContract, async→jobContract+diagrams, integration→integrations, bugfix→reproduction/rootCause/regression, refactor→invariants/characterization ส่วนที่ขาดหรือบางแค่เตือน ไม่บล็อก และ render เป็นข้อความใน design.md ([.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>))
- **risk-to-dimensions:** RISK\_SIGNAL\_DIMENSIONS ผูก riskSignals 9 ค่ากับ discovery dimension ที่ agreement ต้องครอบ เช่น financial→timeout-retry-idempotency+recoverability, access-control→security-privacy+permission-rejection และ impact=high บังคับ CORE\_DISCOVERY\_DIMENSIONS 9 มิติ (current-behavior ... verification) ([.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>))
- **risk-to-depth:** planSemanticIntakeDepth ให้คะแนนจาก impact, ขนาด, coupling, RISK\_WEIGHTS และจำนวน integration เพื่อเลือกระดับ focused/standard/deep (12/24/48 ไฟล์) ซึ่งตรงกับ risk-based depth ในฝั่งการสำรวจ ไม่ใช่ฝั่ง artifact ([.claude/harness/runtime/workflow/validation/semantic-intake-intelligence.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake-intelligence.mjs>))
- **risk-to-review-tier:** SECURITY\_RISK\_SIGNAL\_TIERS: access-control และ financial ยก review เป็น high, input-domain เป็น medium ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))
- **single-approval:** การอนุมัติ spec มีผู้อนุมัติคนเดียว: state.specApproval {identity, revision, decisionRef, approvedAt} บันทึกด้วย advance --approve-spec --decision-ref ผู้ใช้เห็นเพียง packet ใน openspec/changes/\<id\>/ พร้อม open questions ไม่มีบทบาทผู้อนุมัติแยกตาม domain ([WORKFLOW.md](<../../WORKFLOW.md>), [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>), [.claude/commands/change.md](<../../.claude/commands/change.md>))
- **compliance-roles:** บล็อก compliance (requester, approver, implementer; approver ต้องไม่ใช่ implementer) มีเฉพาะเมื่อ openspec/config.yaml ตั้ง compliance: change-record เป็นที่เดียวที่มีบทบาทผู้อนุมัติ ([WORKFLOW.md](<../../WORKFLOW.md>))
- **no-prebuild-evidence:** ไม่มีขั้นหลักฐานก่อน Build: ก่อน Build harness บันทึกแค่ execution-preparation identity และ provider รันเฉพาะใน Prove ([.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>))
- **preview-capable-providers:** provider catalog มี capability ที่ใช้ทำ preview ได้: plan-check, data-migration, browser (playwright), contract-digest/cross-repo-contract, static-analysis, performance, concurrency, resilience และ acceptance (มนุษย์ที่ระบุชื่อยอมรับ แต่รันใน Prove) ([.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>))
- **prototype-sandbox:** /investigate --compare สร้าง prototype แบบใช้แล้วทิ้งได้เฉพาะใน .foundation/prototypes/\<id\>/ บันทึกตัวที่เลือกใน selection.md ไม่ถือเป็นหลักฐาน และส่งต่อเข้า Change ผ่าน draft prototypeSelection ([WORKFLOW.md](<../../WORKFLOW.md>), [.claude/harness/runtime/workflow/investigation-runtime.mjs](<../../.claude/harness/runtime/workflow/investigation-runtime.mjs>))
- **no-code-in-change:** ขั้น Change ห้ามแตะโค้ด product (No product code during Change) ([.claude/commands/change.md](<../../.claude/commands/change.md>))
- **mermaid-unrendered:** diagrams (mermaid/svg/png) จำเป็นสำหรับ async หรือ coupled, userFlow เป็น mermaid flowchart, dataModel เป็น erDiagram แต่ออกมาเป็น fenced block ใน design.md เท่านั้น ไม่มีที่ไหน render ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>), [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>))
- **html-report-readonly:** harness-html-report เป็น projection แบบอ่านอย่างเดียวจาก .foundation/ และ openspec/ ออก HTML self-contained ไม่ใช่หลักฐาน และสรุปภาพรวมรอบงาน ไม่ใช่ชุดเอกสารอนุมัติ ([.claude/skills/harness-html-report/SKILL.md](<../../.claude/skills/harness-html-report/SKILL.md>))

## สมมติฐานและหลักฐาน

- **h-router-is-table — มีหลักฐานสนับสนุน:** Scratch Router ทำเป็นตารางข้อมูลชั้นเดียว (workType+riskSignals+impact → domain tags → artifact kinds → role lanes) บน vocabulary เดิมได้ โดยไม่ต้องเปลี่ยน protocol; หลักฐาน: worktype-mixes-why-where, blueprints-by-worktype, risk-to-dimensions, risk-to-depth, risk-to-review-tier, mermaid-unrendered
- **h-runnable-needs-phase — มีหลักฐานสนับสนุน:** scratch ที่รันได้ (API mock, migration dry-run, terraform plan) ก่อนอนุมัติ ต้องเป็นขั้นใหม่ที่มี workspace แยกจาก Build เพราะ Change ห้ามแตะโค้ด product; หลักฐาน: no-prebuild-evidence, no-code-in-change, prototype-sandbox, preview-capable-providers
- **h-role-needs-authority-change — มีหลักฐานสนับสนุน:** การอนุมัติแยกตามบทบาทก่อน Build ทำไม่ได้ถ้าไม่เปลี่ยนสัญญาสิทธิ์อนุมัติ เพราะ specApproval มีผู้อนุมัติคนเดียว ส่วนบทบาทที่มีอยู่ (compliance, acceptance) อยู่ผิดจุดหรือต้องเปิดใช้เอง; หลักฐาน: single-approval, compliance-roles, preview-capable-providers

## ทางเลือกและข้อแลกเปลี่ยน

### o1-package-projection

P1: ตาราง router เป็นข้อมูลใน runtime/contracts (workType+riskSignals+impact+integrations → domain tags 28 ประเภท → artifact kinds → role lanes) + approval package HTML แบบอ่านอย่างเดียวที่ render จาก design fields และ mermaid ที่มีอยู่ แบ่งแท็บตามบทบาท ติดป้าย preview ไม่ใช่ proof คงการอนุมัติคนเดียว ไม่เปลี่ยน protocol

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o2-preview-providers

P2: scratch ที่รันได้ใน .foundation/prototypes/\<id\>/ (mock API, migration dry-run, plan-check, playwright screenshot) โดยใช้ provider ใน catalog เดิมแบบ preview receipt ที่ไม่มีวันนับเป็น Prove ต้องแก้ EVIDENCE.md:62-66 และ WORKFLOW Change

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o3-role-approval

P3: แยก specApproval เป็นรายบทบาทตาม lane ที่ router เลือก โดยใช้กฎ approver≠implementer ของ compliance เป็นฐาน ต้องแก้สัญญาสิทธิ์อนุมัติและ protocol

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-skill-only

ทางเลือกเบาสุด: ทำเป็น skill ให้ agent สร้าง package เองโดยไม่มีตาราง router ใน runtime ถูกแต่ไม่ deterministic และผลแต่ละครั้งต่างกัน

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **d-taxonomy — ตัดสินใจแล้ว:** แยก intent กับ domain ออกจาก workType ไหม
  ตัวเลือก: ไม่แยก ใช้ตาราง mapping ครอบ; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือกตัวเลือกที่แนะนำ ไม่เปลี่ยน protocol; หลักฐาน: ยังไม่ได้บันทึก
- **d-scope — ตัดสินใจแล้ว:** รอบแรกขอบเขตแค่ไหน
  ตัวเลือก: investigation + solution + ตัวอย่าง scratch ของงานนี้; ข้อเสนอแนะและเหตุผล: ผู้ใช้ตอบเอง; หลักฐาน: ยังไม่ได้บันทึก
- **d-phases — ตัดสินใจแล้ว:** ทำ phase ไหนและส่งมอบอย่างไร
  ตัวเลือก: P1-P3 ใน change เดียว 3 slice และ Land ทีเดียว; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก; หลักฐาน: ยังไม่ได้บันทึก
- **d-preview-policy — ตัดสินใจแล้ว:** บังคับ scratch ที่รันได้ไหม
  ตัวเลือก: เลือกได้ทุกระดับ ไม่บังคับ; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก; หลักฐาน: ยังไม่ได้บันทึก
- **d-boundary — ตัดสินใจแล้ว:** scratch แตะของภายนอกได้แค่ไหน
  ตัวเลือก: อนุญาต sandbox ภายนอก ภายใต้สิทธิ์ external operation; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก; หลักฐาน: ยังไม่ได้บันทึก
- **d-identity — ตัดสินใจแล้ว:** ยืนยันตัวผู้อนุมัติอย่างไร
  ตัวเลือก: บันทึกตามคำบอก; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือกตัวเลือกที่แนะนำ; หลักฐาน: ยังไม่ได้บันทึก

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/commands/change.md](<../../.claude/commands/change.md>)
- [.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>)
- [.claude/harness/runtime/contracts/work-types.mjs](<../../.claude/harness/runtime/contracts/work-types.mjs>)
- [.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>)
- [.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>)
- [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>)
- [.claude/harness/runtime/workflow/investigation-runtime.mjs](<../../.claude/harness/runtime/workflow/investigation-runtime.mjs>)
- [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>)
- [.claude/harness/runtime/workflow/validation/semantic-intake-intelligence.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake-intelligence.mjs>)
- [.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>)
- [.claude/skills/harness-html-report/SKILL.md](<../../.claude/skills/harness-html-report/SKILL.md>)
- [WORKFLOW.md](<../../WORKFLOW.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/approval-package-route-change/design.md](<../changes/approval-package-route-change/design.md>)
- [openspec/changes/approval-package-route-change/proposal.md](<../changes/approval-package-route-change/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [openspec/changes/approval-package-route-change/proposal.md](<../changes/approval-package-route-change/proposal.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [openspec/changes/approval-package-route-change/design.md](<../changes/approval-package-route-change/design.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/scratch-router.json
```

