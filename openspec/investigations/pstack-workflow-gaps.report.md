<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: pstack-workflow-gaps

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-14T21:56:55.101Z · e6fb8fd1ef0aea0e946cf81bd0d16bfbef892549059e075115c0a7e666faa53a

## ปัญหา

ข้อเสนอ 10 ข้อที่ได้จาก pstack (routing ตามประเภท×ความเสี่ยง, task contract, observed/hypothesis/unknown, design contract, role agents, handoff artifacts, evidence gates, stuck handling, lessons→checks, metrics) มีข้อใดที่ Change Loop ทำอยู่แล้ว ข้อใดขาดจริง และควรปรับอะไรก่อน

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** ปรับ Change Loop ตามแนวคิด pstack: เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ

**ผลลัพธ์ที่ต้องการ:** gap analysis ต่อข้อเสนอแต่ละข้อเทียบ source ปัจจุบัน พร้อมลำดับปรับที่แนะนำ เพื่อส่งต่อเป็น Change


### ผู้เกี่ยวข้อง

- maintainer
- consumer agent
- human owner

### ขอบเขต

- routing
- task contract
- investigation output
- design contract
- agent roles
- handoff artifacts
- quality gates
- stuck handling
- lessons to checks
- metrics

### ข้อกำหนดล่าสุด

- **core-principle@1** [constraint / stated] การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว; ที่มา: user (u1)
- **risk-not-size@1** [constraint / stated] จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง; ที่มา: user (u1)
- **status-bound-evidence@1** [constraint / stated] สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent; ที่มา: user (u1)
- **lean-checks@1** [constraint / stated] เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact; ที่มา: user (u1)
- **priority-order@1** [example / stated] ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics; ที่มา: user (u1)
- **gap-analysis@2** [success-criterion / proposed] ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; ที่มา: agent (u1)
- **scope-all-gaps@1** [behavior / stated] นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft; ที่มา: user (u2)
- **never-block@1** [constraint / stated] ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate); ที่มา: user (u2)

### ประวัติข้อกำหนด

- **gap-analysis@1** [success-criterion / superseded] ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; ที่มา: agent (u1); เหตุผล: เป็นงานวิเคราะห์ที่ agent ทำได้เอง ไม่ใช่ความหมายที่ต้องให้ผู้ใช้ยืนยัน; → gap-analysis@2

### คำถามและคำตอบ

- **q-scope** [answered]: เลือก gap ที่จะนำเข้า Change (หนึ่งหรือหลายข้อ) → ทั้งหมด 4 กลุ่ม โดยต้องอยู่ในหลักคิดเดิมและห้าม block agent/user (u2)

### งานอิสระที่ทำต่อได้

- map-proposals: ตาราง status/evidence/gap ของ 10 ข้อเสนอ
- change-handoff: handoff เข้า Change ตาม gap ที่เลือก

### สาระจากบทสนทนา

- **u1** [user]: imporce follow สิ่งที่ควรนำจาก pstack ไปปรับ Workflow คือ เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ ... (ข้อเสนอ 10 ข้อ และลำดับเริ่มปรับ 6 ข้อ) (session message /investigate)
- **u2** [user]: เลือกทั้งหมด: Evidence gates, Lessons → checks, Cross-change metrics, Small record/draft fixes. เพิ่มได้ทั้งนั้นแหละ แต่ต้องอยู่ในหลักคิด ห้าม block agent or user ทุกงานต้องมีทางออกจนถึงงานเสร็จ (AskUserQuestion answer (scope))

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- ไม่มี source ของ pstack เอง; ข้อเสนอเป็นสรุปของผู้ใช้ ไม่ได้ตรวจกับ repo pstack ต้นฉบับ

## ข้อสรุปปัจจุบัน

Change Loop ครอบแนวคิด pstack ส่วนใหญ่แล้ว (risk-not-size, task contract, fact/hypothesis, evidence-bound gates, recovery ladder). Gap จริง: lessons→checks (ไม่มี), cross-change metrics, performance evidence contract, financial riskSignal, allow+deny pairing. ไม่ควรนำ role persona agents, artifact brief/plan/handoff แยก, evidence ผูก commit หรือ budget hard-stop เพราะขัดหลักเดิม. ผู้ใช้เลือกนำทั้ง 4 กลุ่มเข้า Change โดยห้าม block agent/user

## ข้อเสนอแนะและเหตุผล

ปิด gap จากแนวคิด pstack ภายในหลักเดิมของ Change Loop โดยไม่สร้างทางตัน: (1) evidence gates: performance provider ที่ receipt เทียบ base vs head ภายใต้ environment เดียวกันหลายรอบ, access-control claim ต้องมีทั้ง allow และ deny path, riskSignal financial map ไป timeout-retry-idempotency/recoverability และ review high; gate ใหม่ต้องคืน REPAIR ที่ระบุ finding และทางทำต่อ; (2) lessons → checks: rollup finding/blocker codes ที่เกิดซ้ำข้าม archived changes เป็นข้อเสนอ check ถาวรแบบ advisory ที่ส่งผ่าน Change ปกติ ไม่สร้าง state คู่ขนาน; (3) cross-change metrics: read-only rollup first-proof pass rate, repair/amend count, decision count, cost per archived change, escaped defects; unknown ไม่รายงานเป็นศูนย์; (4) investigate record ให้ hypothesis อ้าง experiment ที่พิสูจน์ได้ และ change draft มี field constraints. ไม่รวม: role persona agents, artifact brief/plan/handoff แยก, evidence ผูก commit, budget hard-stop

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **risk-not-size:** Assurance เลือกตาม risk/evidence; size มีผลแค่ budget และ slicing ไม่ลด assurance (WORKFLOW.md:24,1175-1176) ตรงกับข้อเสนอ #1 ([WORKFLOW.md](<../../WORKFLOW.md>))
- **risk-signal-map:** riskSignals map เป็น discovery dimensions: access-control, persisted-data-change, external-integration, performance-slo, user-interface, high-operational-risk, external-side-effect, input-domain; ไม่มี signal ด้านการเงิน/payment ([.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>))
- **payment-review-only:** payment/money/billing ถูกจับแค่ regex ใน review-routing เพื่อยก review tier ไม่ได้บังคับ discovery coverage (idempotency/recoverability) ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))
- **worktype-blueprints:** workType (feature,bugfix,refactor,api,ui,data,config,async,integration,chore,docs) เพิ่ม section ตามประเภท เช่น bugfix ต้องมี reproduction/rootCause/regression; ไม่มี perf/migration/permission เป็น workType แต่ครอบด้วย riskSignals ([.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>))
- **design-contract-exists:** design blueprint มี apiContracts, jobContract{states,retry,timeout,idempotency}, failureMatrix, dataModel; section ที่ขาดได้แค่ warning และไม่มี owner ต่อ component ([.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>), [WORKFLOW.md](<../../WORKFLOW.md>))
- **investigation-separation:** investigation record แยก facts (ต้องมี source), hypotheses (open/supported/falsified ต้องมี factKeys), questions, experiments; report สร้าง Unknowns และ Next action แล้ว แต่ hypothesis ไม่ลิงก์ไปยัง experiment ที่จะพิสูจน์ ([.claude/harness/runtime/workflow/investigation-runtime.mjs](<../../.claude/harness/runtime/workflow/investigation-runtime.mjs>), [.claude/harness/runtime/workflow/investigation-report.mjs](<../../.claude/harness/runtime/workflow/investigation-report.mjs>), [.claude/harness/README.md](<../../.claude/harness/README.md>))
- **evidence-gates:** receipt ผูก content/environment; bug ต้อง fail บน base (tests-not-discriminating); access-control ต้องมี negative path (deny); review แยกจาก acceptance; skill checklist ไม่ใช่ proof ([.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>), [WORKFLOW.md](<../../WORKFLOW.md>), [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>))
- **perf-evidence-gap:** การเทียบ baseline กับผลใหม่ภายใต้เงื่อนไขเดียวกันเป็นแค่ข้อความใน skill (สลับรันอย่างน้อย 5 รอบ); EVIDENCE.md ไม่มี adapter/receipt สำหรับ performance comparison ([.claude/skills/performance-investigation/SKILL.md](<../../.claude/skills/performance-investigation/SKILL.md>), [.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>))
- **stuck-handling:** มี recovery ladder (repair → TRY\_ALTERNATE\_APPROACH → no-progress decision), USER\_ENVIRONMENT\_REQUIRED, amend เมื่อ contract เปลี่ยน, การปฏิเสธเขียนข้าม scope ของ task อื่น; budget auto-extend และคืน budget-no-progress หลัง 3 window ไม่มี progress ([WORKFLOW.md](<../../WORKFLOW.md>))
- **no-lessons-loop:** ไม่มีกลไกตรวจ finding/blocker ที่เกิดซ้ำข้าม change แล้วเสนอ check ถาวร (มีแค่ quality ratchet แบบ opt-in) ([WORKFLOW.md](<../../WORKFLOW.md>), [.claude/harness/README.md](<../../.claude/harness/README.md>))
- **metrics-per-change:** metrics/feedback วัดต่อ change (wall/active/humanWait/repair, blocked operations); ไม่มี rollup ข้าม change สำหรับ first-pass acceptance, rework, escaped defects, จำนวนครั้งที่คนต้องตัดสินใจ, cost per archived change ([.claude/harness/runtime/observability/metrics-runtime.mjs](<../../.claude/harness/runtime/observability/metrics-runtime.mjs>), [.claude/harness/runtime/observability/feedback-runtime.mjs](<../../.claude/harness/runtime/observability/feedback-runtime.mjs>), [.claude/harness/README.md](<../../.claude/harness/README.md>))
- **principle-conflicts:** ข้อเสนอบางส่วนขัดหลักเดิม: harness ไม่เรียก model เอง (ไม่มี role persona agents), tasks.md เป็น ledger เดียวและห้าม parallel state (ไม่ควรมี brief/plan/handoff แยก), evidence ผูก content ไม่ใช่ commit, budget ไม่ hard-stop ([.claude/harness/README.md](<../../.claude/harness/README.md>), [WORKFLOW.md](<../../WORKFLOW.md>), [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>))

## สมมติฐานและหลักฐาน

- **h-coverage — มีหลักฐานสนับสนุน:** Change Loop ครอบข้อ 2,3,6,8 เกือบครบแล้ว; ข้อ 1,4,7,10 บางส่วน; ข้อ 9 ยังไม่มี; ข้อ 5 และส่วน artifact แยกใน 6 ขัดหลักเดิม; หลักฐาน: risk-not-size, risk-signal-map, worktype-blueprints, design-contract-exists, investigation-separation, evidence-gates, perf-evidence-gap, stuck-handling, no-lessons-loop, metrics-per-change, principle-conflicts

## ทางเลือกและข้อแลกเปลี่ยน

### g-lessons

Lessons→checks: rollup finding/blocker codes ที่เกิดซ้ำจาก archived changes แล้วเสนอ provider/lint/required capability ผ่าน Change ปกติ

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### g-metrics

Cross-change outcome metrics: first-proof pass rate, repair/amend count, decision count, cost per archived change, escaped defect ผ่าน spec history; read-only rollup + cohort key

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### g-perf

Performance evidence contract: receipt เทียบ base vs head ภายใต้ environment digest เดียว, N รอบสลับ, spread

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### g-financial

riskSignal financial → idempotency, recoverability, review-high แทนการพึ่ง regex

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### g-access-pair

access-control ต้องมีทั้ง allow และ deny path; optional real-surface evidence สำหรับ UI feature

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### g-small

hypothesis→experiment link ใน investigate record และ field constraints ใน draft

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **scope-selection — ตัดสินใจแล้ว:** จะนำ gap ใดเข้า Change
  ตัวเลือก: g-lessons / g-metrics / g-perf / g-financial / g-access-pair / g-small; ข้อเสนอแนะและเหตุผล: g-financial; หลักฐาน: payment-review-only, risk-signal-map

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>)
- [.claude/harness/README.md](<../../.claude/harness/README.md>)
- [.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>)
- [.claude/harness/runtime/observability/feedback-runtime.mjs](<../../.claude/harness/runtime/observability/feedback-runtime.mjs>)
- [.claude/harness/runtime/observability/metrics-runtime.mjs](<../../.claude/harness/runtime/observability/metrics-runtime.mjs>)
- [.claude/harness/runtime/workflow/investigation-report.mjs](<../../.claude/harness/runtime/workflow/investigation-report.mjs>)
- [.claude/harness/runtime/workflow/investigation-runtime.mjs](<../../.claude/harness/runtime/workflow/investigation-runtime.mjs>)
- [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>)
- [.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>)
- [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>)
- [.claude/skills/performance-investigation/SKILL.md](<../../.claude/skills/performance-investigation/SKILL.md>)
- [README.th.md](<../../README.th.md>)
- [WORKFLOW.md](<../../WORKFLOW.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/related-projects-research-2026-09-05.md](<../../docs/reports/related-projects-research-2026-09-05.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/workflow-optimization-summary-2026-07-30.md](<../../docs/workflow-optimization-summary-2026-07-30.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [openspec/changes/change-pstack-agent/design.md](<../changes/change-pstack-agent/design.md>)
- [openspec/changes/change-pstack-agent/proposal.md](<../changes/change-pstack-agent/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [openspec/changes/change-pstack-agent/proposal.md](<../changes/change-pstack-agent/proposal.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [README.th.md](<../../README.th.md>)
- [openspec/changes/change-pstack-agent/design.md](<../changes/change-pstack-agent/design.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/related-projects-research-2026-09-05.md](<../../docs/reports/related-projects-research-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [docs/workflow-optimization-summary-2026-07-30.md](<../../docs/workflow-optimization-summary-2026-07-30.md>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/pstack-workflow-gaps.json
```

