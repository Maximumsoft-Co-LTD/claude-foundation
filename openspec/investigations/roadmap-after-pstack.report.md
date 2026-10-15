<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: roadmap-after-pstack

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-15T12:07:51.125Z · 6c159896b9e4b71fda1053a152fb0e2b136a895f31553cc453770bc578416093

## ปัญหา

หลังงาน pstack (evidence gates, skill procedures, skill routing) และการตรวจเอกสาร change ต้องปรับและทำอะไรต่อบ้าง เรียงลำดับอย่างไร และอะไรเข้า v3.6.4

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** รวบรวมสิ่งที่ต้องปรับทั้งหมดเป็นแผนเดียวที่เรียงลำดับและแยก release

**ผลลัพธ์ที่ต้องการ:** roadmap ที่ระบุงานแต่ละชิ้น, ลำดับ, release ที่อยู่, การตัดสินใจที่ได้แล้ว และคำถามที่ต้องให้ผู้ใช้ตอบ


### ผู้เกี่ยวข้อง

- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ขอบเขต

- skill triggering
- change document readability
- outline contract
- hybrid authoring
- work types
- renderer defects
- budgets
- release v3.6.4
- housekeeping

### ข้อกำหนดล่าสุด

- **complete-readable-docs@1** [constraint / stated] เอกสาร change ต้องครบ อ่านง่าย เรียงลำดับถูก และเขียนให้คนอ่าน โดยเพิ่ม budget ได้; ที่มา: user (u2)
- **outline-contract@1** [behavior / stated] กำหนดหน้าที่และหัวข้อสูงสุดของแต่ละไฟล์ change แล้วให้แต่ละงานเลือกหัวข้อตามเงื่อนไข เพื่อตรวจความครบได้ รวม test strategy, NFR, ADR, mapping, diagram และ API contract; ที่มา: user (u3, u4)
- **hybrid-authoring@1** [behavior / stated] ใช้ทาง B: ส่วนโครงสร้างเป็น typed, prose เป็น markdown ที่ผู้เขียนแก้ตรงและ harness ตรวจตาม outline; ที่มา: user (u5)
- **skill-trigger@1** [behavior / stated] ทำให้ skill ถูกใช้จริงใน flow ส่งมอบงานก่อน release; ที่มา: user (u1)
- **release-patch@1** [constraint / stated] release ครั้งเดียวเป็น v3.6.4 หลังงานเสร็จและทดสอบ paid e2e ภายในงบ 100$; ที่มา: user (u7)
- **work-type-coverage@1** [behavior / stated] ตรวจและเติมประเภทงานให้ครบ; ที่มา: user (u6)

### คำถามและคำตอบ

- **q-skill-trigger-path** [answered]: ทางแก้การ trigger skill: (1) ฝังขั้นตอนสำคัญลง action, (2) ลองถ้อยคำแบบระบุไฟล์, (3) ยอมรับว่า skill ใช้เมื่อเรียกเองแล้ว release → (3) ยอมรับ: routing คงเป็นคำแนะนำ และ release note บอกตามจริงว่า skill ใช้เมื่อถูกเรียก (u9)
- **q-adr-mode** [answered]: ADR: (ก) decision อยู่ใน packet และ decision ที่ยังมีผลตามไป spec ถาวร หรือ (ข) โฟลเดอร์ ADR แยก → (ก) (u9)
- **q-work-types** [answered]: เพิ่ม 6 ประเภท performance, migration, dependency, deprecation, infra, observability และให้ security fix/hotfix ใช้ bugfix + riskSignal หรือไม่ → เพิ่ม 6 ประเภท และ security fix/hotfix ใช้ bugfix + riskSignal (u9)
- **q-work-types-catalog** [answered]: ขยายประเภทงานให้ครบทุกงานตาม Work type catalog แทน 6 ประเภทหรือไม่ → ครบตาม catalog: performance, migration, dependency, deprecation, infra, observability, library, privacy, experiment, client-release, ml; security fix และ hotfix เป็นรูปแบบย่อยของ bugfix; ขยาย field ของประเภทเดิม (u11, u12)
- **q-release-scope** [answered]: v3.6.4 รวมเฉพาะงานที่เสร็จแล้ว + แก้ renderer เล็ก (object Object, amendment ซ้ำ, traceability ชื่อ scenario) และให้ outline contract กับทาง B เป็นรุ่นถัดไป หรือไม่ → ไม่: รอทาง B เสร็จก่อน แล้ว release ครั้งเดียว (u9)
- **q-outline-gaps** [answered]: เพิ่มรายการที่ตกหล่นจาก gap review (KEP PRR, SaaS tenancy, SLSA/SBOM, ODCS, tracking plan, i18n, cost, communication, compliance, decision log, review record, demo) หรือไม่ → เพิ่มทั้งหมดตามคำแนะนำ; รายการ nice เป็นช่องเสริมไม่บังคับ; compliance change record เปิดผ่าน openspec/config.yaml (u10, u12)

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- **paid-skill-trigger** [complete]: skill ถูกโหลดใน flow /dev เมื่อมีเนื้อหาใหม่, routing และ load-first หรือไม่; เกณฑ์ตัดสิน: skillToolCalls มากกว่า 0 ใน scenario ที่ mapping ตรง; ผลที่พบ: 40 runs ใน 3 รอบ: skillToolCalls = 0 ทุก run / routing ส่งคำสั่งถึง agent ครบทุก run; agent ข้ามทั้งคำสั่งบรรทัดสุดท้ายและบรรทัดแรก / agent ข้าม contextFiles ทุก run ที่ตรวจ / ผลลัพธ์ระหว่างแขนอยู่ในช่วงความแปรปรวน; ข้อจำกัด: n = 2-3 ต่อแขน / วัดเฉพาะ Claude Code กับ claude-sonnet-5-5 ใน bench lab / ไม่ได้ทดสอบการฝังขั้นตอนลง action; refs: skill-trigger@1

### งานอิสระที่ทำต่อได้

- housekeeping: ยกเลิก change ว่าง id change และเพิ่มผลรอบ routing/load-first ลงรายงาน
- release-scope: ขอบเขตและลำดับของ v3.6.4
- hybrid-design: investigation ทาง B: outline contract, field ใหม่, draft v5, ประเภทงาน

### สาระจากบทสนทนา

- **u1** [user]: ทำ 1 (แก้การ trigger ของ skill ก่อน release) (session message)
- **u2** [user]: เพิ่ม budget ได้นะ ฉันต้องการความครบถ้วนของเอกสารและอ่านง่ายเรียงลำดับถูกด้วย และ เขียนให้คนอ่าน (session message)
- **u3** [user]: เรามากำหนดไหม ว่าแต่ละไฟล์ change spec ทำหน้าที่อะไร มีหัวข้ออะไรบ้าง แบบสูงสุด และแต่ละงานค่อยเลือกไปว่าต้องใช้หัวข้ออะไรบ้าง (session message)
- **u4** [user]: Test strategy, NFR, ADR, Mapping, Diagram, API Contract ต่างๆ ครบหรือยัง; research เพิ่มว่าต้องมีหัวข้ออะไรแบบ full ที่สุด และค่อยให้แต่ละงานเลือกหัวข้อไปใช้ (session messages)
- **u5** [user]: แบบ B ดีกว่า (hybrid: โครงสร้าง typed, prose เป็น markdown ที่ harness ตรวจ) (session message)
- **u6** [user]: ประเภทงานเราครบหรือยัง (session message)
- **u7** [user]: เดี๋ยวฉันรองานนี้เสร็จและทดสอบ และ ถึงจะ release ทีเดียวใน version +0.0.1; ต้องทดสอบ paid e2e ด้วย budget 100$ (session messages)
- **u8** [user]: /investigate ทั้งหมดนี้ ว่าเราต้องปรับและทำอะไรบ้าง (session message)
- **u9** [user]: release: รอทาง B เสร็จก่อน; skill trigger: ยอมรับและ release; ADR: (ก) decision ใน packet + ตามไป spec; ประเภทงาน: เพิ่ม 6 ประเภท (AskUserQuestion answers)
- **u10** [user]: มีเรื่อง Data Model schema / uxui หรือยัง; review ขาดอะไรอีกไหมด้วย skill ux-ui, architecture, programming, api-design; แก้ทั้งหมดเลย (session messages)
- **u11** [user]: รองรับครบทุกงานทุกประเภทงานหรือยัง; ทำเพิ่มให้ครบ (เพิ่ม library, privacy, experiment, client-release และ security fix/hotfix เป็นรูปแบบย่อยของ bugfix) (session messages)
- **u12** [user]: research and review ว่ามีอะไรตกหล่นอีกไหม; ทำตามที่แนะนำทั้งหมด (must + should + Change Loop process items, nice เป็นช่องเสริม, ml เป็นประเภทงาน, compliance record เปิดผ่าน openspec/config.yaml) (session messages)

## ข้อสรุปปัจจุบัน

v3.6.4 จะรวมทั้งหมด: งานที่ commit แล้ว + outline contract + hybrid authoring (ทาง B) + ประเภทงานครบตาม catalog (11 ประเภทใหม่ + รูปแบบย่อยของ bugfix) และหัวข้อจาก gap review + ADR แบบ (ก) + แก้ renderer (object Object, amendment ซ้ำ, traceability, id/story ภาษาไทย, budget) แล้วจึง checkpoint paid ภายในงบ 100$ และ release ครั้งเดียว; skill routing คงเป็นคำแนะนำและ release note บอกตามจริงว่า skill ใช้เมื่อถูกเรียก

## ข้อเสนอแนะและเหตุผล

ส่งมอบ v3.6.4 ด้วยเอกสาร change แบบ hybrid ที่ครบ อ่านง่าย และเรียงลำดับสำหรับคน: (1) outline contract เดียวที่กำหนดหน้าที่ หัวข้อสูงสุด เงื่อนไข และบ้านของทุก field สำหรับ proposal, design, spec, tasks และไฟล์สำหรับเครื่อง ตาม openspec/investigations/change-doc-outline.md; (2) hybrid authoring (draft v5 อยู่ร่วมกับ v4): โครงสร้าง typed และ prose เป็น markdown ที่ผู้เขียนแก้ตรงได้และ harness ตรวจตาม outline (ลำดับ, หัวข้อที่เงื่อนไขเป็นจริง, ความครบ, ไม่ซ้ำ); (3) field ใหม่ตาม outline: boundaries, domain, ui, config, consumers, rollout (enablement, rollbackProof, versionSkew, upgradeSteps), threatModel, nfr, eventContracts, observability, trackingPlan, tenancy, capacity, recovery, testStrategy, dependencies, alternatives, decisionLog, communication, releaseNote, demo, compliance (opt-in) และ subfield ของ apiContracts และ dataModel; (4) workType ครบตาม Work type catalog: performance, migration, dependency, deprecation, infra, observability, library, privacy, experiment, client-release, ml และรูปแบบย่อย security/hotfix ของ bugfix รวมถึงแก้ test ที่ขาดใน WORK\_TYPES; (5) ADR แบบ (ก): decision มีสถานะและ decision ที่ยังมีผลตามไปเป็น rationale ใน spec ถาวรตอน archive; (6) แก้ renderer: rejected options, amendment แทนที่, traceability ชื่อ scenario, id และ story ภาษาไทย, budget ใหม่และคำเตือนไม่ให้ตัดเนื้อหา; ทำเป็นหลาย change ตามลำดับ dependency แล้ว checkpoint paid e2e ภายใน 100$ ก่อน release; skill routing คงเป็นคำแนะนำ

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **amend-duplicates:** writeSemanticAmendment ต่อส่วน Latest amended investigation agreement ทุกครั้งที่ amend (semantic-amendment.mjs:1167); change-pstack-agent มี 3 ชุด = 1791 คำ (44% ของ proposal) ([.claude/harness/runtime/workflow/semantic-amendment.mjs](<../../.claude/harness/runtime/workflow/semantic-amendment.mjs>))
- **rejected-object-bug:** renderer ของ decision แสดง rejected ที่เป็น object เป็น \[object Object\] (change-lifecycle.mjs:433) พบใน 5 จุดของ packet ที่ archive ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **thai-id-slug:** change id มาจาก slugify(draft.id || draft.intent) (change-lifecycle.mjs:2156) intent ภาษาไทยจึงได้ id ว่า change ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **story-frame:** storyText ใช้กรอบภาษาอังกฤษตายตัวแม้ language เป็น th (reader-guide.mjs:25) ([.claude/harness/runtime/workflow/validation/reader-guide.mjs](<../../.claude/harness/runtime/workflow/validation/reader-guide.mjs>))
- **budgets:** validationDocumentBudgets ใช้ 900/1400/900 หรือ 1600/2600/1600 และคำเตือนบอกให้ตัดเหลือแต่สาระ ([.claude/harness/runtime/workflow/change-validation.mjs](<../../.claude/harness/runtime/workflow/change-validation.mjs>))
- **work-types:** WORK\_TYPES มี feature, bugfix, refactor, api, ui, data, config, async, integration, chore, docs; ไม่มี performance, migration, dependency, deprecation, infra, observability ([.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>))
- **no-adr-store:** change workflow ห้ามสร้าง ADR store; decision อยู่ใน packet และหายจากมุมมองปัจจุบันหลัง archive ([.claude/skills/change/references/workflow.md](<../../.claude/skills/change/references/workflow.md>))
- **outline-research:** research ได้โครงสูงสุดของ proposal/design/spec/tasks พร้อมเงื่อนไข, ตาราง field → บ้าน, การเลือกตามชนิดงาน และ field ที่ต้องเพิ่ม (rollout, threatModel, nfr, eventContracts, observability, testStrategy, dependencies, alternatives, subfield ของ apiContracts) ([openspec/investigations/change-doc-outline.md](<change-doc-outline.md>))
- **skill-not-loaded:** paid e2e 40 runs: skill ไม่ถูกโหลดเลย แม้ routing ส่งคำสั่งเป็นบรรทัดแรก ([docs/reports/scenario-pstack-gates-2026-10-15.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.md>), [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>))
- **file-level-only:** schema.yaml กำหนดหน้าที่และเงื่อนไขการสร้างระดับไฟล์ แต่ไม่มีโครงหัวข้อระดับ section ยกเว้น design ที่เลือกตาม workType ([openspec/schemas/foundation-standard/schema.yaml](<../schemas/foundation-standard/schema.yaml>), [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>))

## สมมติฐานและหลักฐาน

- **h-renderer-root — มีหลักฐานสนับสนุน:** ปัญหาความอ่านง่ายส่วนใหญ่มาจาก renderer จึงแก้ได้โดยไม่เปลี่ยน draft schema สำหรับบั๊กเฉพาะจุด แต่ความครบถ้วนแบบตรวจได้ต้องมี outline contract; หลักฐาน: amend-duplicates, rejected-object-bug, story-frame, file-level-only

## ทางเลือกและข้อแลกเปลี่ยน

### o-v364-small

v3.6.4: งานที่ commit แล้ว + แก้ renderer เล็ก (object Object, amendment ซ้ำ, traceability ชื่อ scenario, Thai id/story, budget) + checkpoint

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-next-hybrid

รุ่นถัดไป: outline contract + hybrid authoring (draft v5) + field ใหม่ + 6 ประเภทงาน + ADR แบบ (ก)

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-skill-inline

ทดลองฝังขั้นตอนสั้นของ skill ลง action เฉพาะ riskSignal ที่ผูกขั้นตอนชัด (performance-slo, financial, access-control) และวัดด้วย oracle

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **authoring-direction — ตัดสินใจแล้ว:** วิธีเขียนเอกสาร change
  ตัวเลือก: A-json-render / B-hybrid / C-markdown-only; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก (u5); หลักฐาน: ยังไม่ได้บันทึก
- **release-scope — ตัดสินใจแล้ว:** ขอบเขต v3.6.4
  ตัวเลือก: o-v364-small / o-next-hybrid; ข้อเสนอแนะและเหตุผล: o-v364-small; หลักฐาน: amend-duplicates, rejected-object-bug, skill-not-loaded

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>)
- [.claude/harness/runtime/workflow/change-validation.mjs](<../../.claude/harness/runtime/workflow/change-validation.mjs>)
- [.claude/harness/runtime/workflow/semantic-amendment.mjs](<../../.claude/harness/runtime/workflow/semantic-amendment.mjs>)
- [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>)
- [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>)
- [.claude/harness/runtime/workflow/validation/reader-guide.mjs](<../../.claude/harness/runtime/workflow/validation/reader-guide.mjs>)
- [.claude/harness/tests/semantic-draft.test.mjs](<../../.claude/harness/tests/semantic-draft.test.mjs>)
- [.claude/skills/change/references/workflow.md](<../../.claude/skills/change/references/workflow.md>)
- [README.th.md](<../../README.th.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md>)
- [openspec/changes/change/design.md](<../changes/change/design.md>)
- [openspec/changes/change/proposal.md](<../changes/change/proposal.md>)
- [openspec/investigations/change-doc-outline.md](<change-doc-outline.md>)
- [openspec/schemas/foundation-standard/schema.yaml](<../schemas/foundation-standard/schema.yaml>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [README.th.md](<../../README.th.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/change/design.md](<../changes/change/design.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/change/proposal.md](<../changes/change/proposal.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [.claude/harness/tests/semantic-draft.test.mjs](<../../.claude/harness/tests/semantic-draft.test.mjs>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/roadmap-after-pstack.json
```

