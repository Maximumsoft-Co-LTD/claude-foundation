<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: hybrid-packets-impact

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-15T12:38:46.609Z · a925458bc2817480272ee6c8d3b2bf969238f199caff83e74fc7ebda5984312e

## ปัญหา

ก่อนเปิด change เดียวของ hybrid change packets ต้องรู้ว่าโค้ด เอกสาร และ test ส่วนไหนกระทบ กลไก draft v5 ทำงานอย่างไร และ change เดียวผ่าน Change → Build → Prove → Land ได้หรือไม่

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** เตรียมข้อมูลให้เปิด change เดียวที่ส่งมอบ outline contract, hybrid authoring, field ใหม่, ประเภทงานครบตาม catalog, ADR แบบ (ก), แก้ renderer และ budget

**ผลลัพธ์ที่ต้องการ:** แผนที่โค้ดที่กระทบพร้อม path, กลไก draft v5 ที่ผู้ใช้เลือกแล้ว, ข้อสรุปว่าขนาด change เดียวรับได้ และ change intent ที่พร้อมส่งต่อ


### ผู้เกี่ยวข้อง

- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ขอบเขต

- draft compile pipeline
- renderer
- amendment
- archive
- work types
- evidence capabilities
- budgets
- docs EN/TH
- website
- schemas
- protocol pins
- tests

### ข้อกำหนดล่าสุด

- **single-change@1** [constraint / stated] ส่งมอบทั้งหมดใน change เดียว; ที่มา: user (u1)
- **fold-reader-first@1** [behavior / stated] change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่); ที่มา: user (u2)
- **roadmap-intent@1** [behavior / stated] ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md; ที่มา: user (u2)

### คำถามและคำตอบ

- **q-v5-layout** [answered]: draft v5 เก็บ prose ที่คนเขียนไว้ที่ไหน → ไฟล์ .md ในโฟลเดอร์ draft: change.json + proposal.md + design.md ตามหัวข้อ outline แล้ว harness ตรวจและรวมเป็น packet (u3)
- **q-typed-format** [answered]: ส่วน typed ของ v5 เป็น JSON (ใช้ parser เดิม) หรือ YAML (ต้องเพิ่ม parser) → JSON (u3)
- **q-new-capabilities** [answered]: หลักฐานที่ยังไม่มี capability (ml evaluation, crash-free, parity, plan check, experiment guardrail) จะทำอย่างไร → เพิ่ม capability ใหม่สำหรับ ml evaluation, crash-free rate, parity, plan check และ experiment guardrail (u3)
- **q-nfr-home** [answered]: nfr และ observability ของ v5 อยู่ที่ไหน → อยู่ใน change.json ของ v5 แล้ว harness derive grounding; v4 ใช้ grounding v2 ตามเดิม (u3)

### งานอิสระที่ทำต่อได้

- code-map: แผนที่โค้ด เอกสาร และ test ที่กระทบ
- v5-design: กลไก draft v5
- evidence: การผูกประเภทงานกับหลักฐาน
- change-ready: change intent พร้อมส่งต่อ

### สาระจากบทสนทนา

- **u1** [user]: เปิด change เลยได้ไหม ต้องการเปิด change เดียว ต้องปิด change อะไรก่อนไหม หรือ investigate ครบหรือยังและรู้หรือยังต้องปรับอะไรบ้าง (session message)
- **u2** [user]: ปิด change ตามทาง ก แล้ว investigate ต่อเลย (session message)
- **u3** [user]: v5 prose: ไฟล์ .md ในโฟลเดอร์ draft; typed: JSON; หลักฐานที่ยังไม่มี: เพิ่ม capability ใหม่; nfr/observability: ใน change.json แล้ว derive grounding (AskUserQuestion answers)

## ข้อสรุปปัจจุบัน

พร้อมเปิด change เดียวที่เขียนด้วย draft v4 (เพราะ runtime ที่ root คอมไพล์ตัว change เอง) ขนาดราว 35-45 task ที่แต่ละ task แคบพอให้ packet ไม่เกิน 20 KB; กลไก v5: โฟลเดอร์ draft มี change.json + proposal.md + design.md ที่คนเขียน, harness ตรวจหัวข้อตาม outline แล้วรวมกับส่วน derive; ต้องแก้ intake gate, check version ราว 40 จุด, revise/amend ให้รักษา prose, pin protocol/runtime ทั้ง 4 จุด, capability ใหม่ 5 ตัว, รวม LIGHT\_WORK 3 ชุด และให้ Rationale อยู่ใน requirement ของ spec delta

## ข้อเสนอแนะและเหตุผล

 — ผู้ใช้เลือก (u3); revise และ amend ไม่ทับ prose, approval digest ใช้ได้เดิม, มีแบบอย่างไฟล์ที่คนเป็นเจ้าของ

- ไม่เลือก:  — เขียนลำบาก
- ไม่เลือก:  — ชนกับ revise, digest, amendment และ parser ตายตัว

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **reader-first-abandoned:** change reader-first (id change) ถูกปิดด้วย change abandon --applied keep ระเบียนอยู่ที่ .foundation/recovery/abandoned/change มี 4 task ที่ยังไม่ Build ([openspec/investigations/roadmap-after-pstack.json](<roadmap-after-pstack.json>))
- **draft-json-only:** draft อ่านด้วย readJson เท่านั้น และ expandMinimalSemanticDraft ตั้ง version 4 เมื่อไม่ระบุ (change-lifecycle.mjs:963, semantic-draft.mjs:869) ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>), [.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>))
- **intake-v4-only:** completedDraftIntake ตรวจ intake เฉพาะ version 4 และ new --draft บล็อกเฉพาะ v4 (change-lifecycle.mjs:2054, 1410); v5 จะข้าม intake gate ถ้าไม่แก้ ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **version-literals:** มี check \[3,4\] และ === 4 ราว 40 จุด: change-lifecycle 28, semantic-draft 5, semantic-intake 4 และอีกหลายไฟล์; protocol.json semanticDraftSchema 4 และ proof receipt ฝังค่านี้ ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>), [.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>), [.claude/harness/protocol.json](<../../.claude/harness/protocol.json>))
- **revise-rewrites:** reviseChangeUnlocked สร้าง packet ใหม่ทั้งหมดจาก draft (change-lifecycle.mjs:2410) prose ที่แก้ใน packet จะถูกทับ ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **approval-digest:** agreementIdentity เป็น SHA-256 ของทุกไฟล์ใน packet; แก้หลังอนุมัติทำให้อนุมัติเป็นโมฆะ และ workspace drift ถูกคืนค่าอัตโนมัติ (user-decisions.mjs:39,77,222) ([.claude/harness/runtime/core/user-decisions.mjs](<../../.claude/harness/runtime/core/user-decisions.mjs>))
- **amend-proposal-only:** writeSemanticAmendment ต่อท้าย proposal.md 3 ส่วนและไม่แตะ design.md (semantic-amendment.mjs:1163) ([.claude/harness/runtime/workflow/semantic-amendment.mjs](<../../.claude/harness/runtime/workflow/semantic-amendment.mjs>))
- **fixed-format-parsers:** validator หลายตัว parse รูปแบบตายตัวใน markdown: Impact lines, Decision ID, ## Work type, Open questions, และ scaffold check ปฏิเสธ TODO/TBD (change-validation.mjs:287, change-lifecycle.mjs:534,593,1017) ([.claude/harness/runtime/workflow/change-validation.mjs](<../../.claude/harness/runtime/workflow/change-validation.mjs>), [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **no-rationale-archive:** archive ใช้ openspec archive และตรวจเฉพาะ requirement; ไม่มีโค้ดนำ decision ไป spec ถาวร (apply-runtime.mjs:1417); Rationale ใส่ใน requirement ของ spec delta แล้วจะตามไปเอง ([.claude/harness/runtime/workflow/apply-runtime.mjs](<../../.claude/harness/runtime/workflow/apply-runtime.mjs>))
- **renderer-map:** renderDraftProposal 481, renderDraftDecisions 418-440 (rejected 433), renderDraftDesign 568, renderDesignBlueprints design-blueprints.mjs:312, packet-overview และ reader-guide เป็นจุดที่ outline renderer ต้องแก้ ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>), [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>), [.claude/harness/runtime/workflow/validation/packet-overview.mjs](<../../.claude/harness/runtime/workflow/validation/packet-overview.mjs>), [.claude/harness/runtime/workflow/validation/reader-guide.mjs](<../../.claude/harness/runtime/workflow/validation/reader-guide.mjs>))
- **light-work-drift:** LIGHT\_WORK มี 3 ชุดไม่ตรงกัน (design-blueprints:17, dev-document:134, packet-overview:190) และ test ไม่อยู่ใน WORK\_TYPES จึงถูกปฏิเสธเมื่อประกาศ ([.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>), [.claude/harness/runtime/workflow/validation/dev-document.mjs](<../../.claude/harness/runtime/workflow/validation/dev-document.mjs>), [.claude/harness/runtime/workflow/validation/packet-overview.mjs](<../../.claude/harness/runtime/workflow/validation/packet-overview.mjs>))
- **worktype-consumers:** work type ถูกใช้ใน inferWorkTypes (path), skill-routing ROUTES, test-discrimination, draft-risk CONTRACT\_TYPES, outcomes cohorts, renderWorkType และ template examples มีแค่ ui/api/config ([.claude/harness/runtime/workflow/validation/dev-document.mjs](<../../.claude/harness/runtime/workflow/validation/dev-document.mjs>), [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>), [.claude/harness/runtime/evidence/test-discrimination.mjs](<../../.claude/harness/runtime/evidence/test-discrimination.mjs>))
- **capability-by-path:** ไม่มีการผูก work type กับ evidence capability; capability มาจาก path (change-policy.mjs:153-200) และ NFR category; provider มี 21 capability แต่ไม่มี evaluation, crash-free, parity, plan-check, experiment guardrail ([.claude/harness/runtime/workflow/change-policy.mjs](<../../.claude/harness/runtime/workflow/change-policy.mjs>), [.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>))
- **grounding-overlap:** nfrAssessment 8 หมวดและ observability rows อยู่ใน grounding v2; grounding v3 มีแค่ decisions; field nfr/observability ใหม่จะซ้อนกับ v2 ([.claude/harness/runtime/workflow/change-validation.mjs](<../../.claude/harness/runtime/workflow/change-validation.mjs>))
- **no-size-cap:** ไม่มีเพดานจำนวน task หรือไฟล์; เพดานจริงคือ packet task 20 KB (packet-runtime.mjs:716), claim ต่อ task 50, plan summary 4 KB; budget เปิด window ใหม่อัตโนมัติ (budget.mjs:361); review inline diff รวม 40 KB ([.claude/harness/runtime/workflow/packet-runtime.mjs](<../../.claude/harness/runtime/workflow/packet-runtime.mjs>), [.claude/harness/runtime/workflow/budget.mjs](<../../.claude/harness/runtime/workflow/budget.mjs>), [.claude/harness/runtime/workflow/agent-planning.mjs](<../../.claude/harness/runtime/workflow/agent-planning.mjs>))
- **root-runtime-bootstrap:** cli.sh รัน runtime ที่ root ไม่ใช่ใน sandbox; provider test รันใน sandbox; change นี้จึงต้องเขียนด้วย draft v4 และฟีเจอร์ใหม่ไม่ใช้กับตัวเอง ([cli.sh](<../../cli.sh>))
- **authored-file-precedent:** writeInvestigationReport เขียนทับเฉพาะไฟล์ที่ขึ้นต้นด้วย generated marker และรักษาไฟล์ที่คนเขียน (investigation-report.mjs:185-201) เป็นแบบอย่างของไฟล์ที่คนเป็นเจ้าของ ([.claude/harness/runtime/workflow/investigation-report.mjs](<../../.claude/harness/runtime/workflow/investigation-report.mjs>))

## สมมติฐานและหลักฐาน

- **h-single-change-feasible — มีหลักฐานสนับสนุน:** change เดียวราว 35-45 task ผ่าน Build ได้ถ้าแต่ละ task แคบพอให้ packet ไม่เกิน 20 KB; หลักฐาน: no-size-cap, root-runtime-bootstrap
- **h-prose-in-packet-risky — มีหลักฐานสนับสนุน:** ให้คนแก้ proposal.md/design.md ใน packet ตรง ๆ ชนกับ revise, approval digest, amendment และ parser รูปแบบตายตัว จึงเสี่ยงกว่าการเก็บ prose ไว้ฝั่ง draft; หลักฐาน: revise-rewrites, approval-digest, amend-proposal-only, fixed-format-parsers

## ทางเลือกและข้อแลกเปลี่ยน

### o-prose-json-strings

v5: prose เป็น markdown string ใน draft JSON; harness จัดเรียงตาม outline

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-prose-draft-files

v5: โฟลเดอร์ draft มี change.json (typed) + proposal.md และ design.md ที่คนเขียนตามหัวข้อ outline; harness ตรวจหัวข้อแล้วรวมกับส่วนที่ derive เป็น packet

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-prose-in-packet

v5: คนแก้ proposal.md/design.md ใน packet ตรง ๆ โดย harness แทรกส่วน derive ด้วย marker

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **v5-layout — ตัดสินใจแล้ว:** ที่เก็บ prose ของ v5
  ตัวเลือก: o-prose-draft-files / o-prose-json-strings / o-prose-in-packet; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก (u3); หลักฐาน: ยังไม่ได้บันทึก
- **typed-format — ตัดสินใจแล้ว:** รูปแบบ typed
  ตัวเลือก: json / yaml; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก (u3); ใช้ readJson เดิม; หลักฐาน: ยังไม่ได้บันทึก
- **new-capabilities — ตัดสินใจแล้ว:** หลักฐานที่ยังไม่มี capability
  ตัวเลือก: existing-plus-rollout-gate / new-capabilities; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก (u3) แทนคำแนะนำ; สัญญาณหลังปล่อยต้องมีวิธีรับผลเข้ามา เช่น external adapter; หลักฐาน: ยังไม่ได้บันทึก
- **nfr-home — ตัดสินใจแล้ว:** ที่อยู่ของ nfr และ observability
  ตัวเลือก: v5-typed-derive-grounding / keep-grounding-v2; ข้อเสนอแนะและเหตุผล: ผู้ใช้เลือก (u3); หลักฐาน: ยังไม่ได้บันทึก

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/protocol.json](<../../.claude/harness/protocol.json>)
- [.claude/harness/runtime/core/user-decisions.mjs](<../../.claude/harness/runtime/core/user-decisions.mjs>)
- [.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>)
- [.claude/harness/runtime/evidence/test-discrimination.mjs](<../../.claude/harness/runtime/evidence/test-discrimination.mjs>)
- [.claude/harness/runtime/workflow/agent-planning.mjs](<../../.claude/harness/runtime/workflow/agent-planning.mjs>)
- [.claude/harness/runtime/workflow/apply-runtime.mjs](<../../.claude/harness/runtime/workflow/apply-runtime.mjs>)
- [.claude/harness/runtime/workflow/budget.mjs](<../../.claude/harness/runtime/workflow/budget.mjs>)
- [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>)
- [.claude/harness/runtime/workflow/change-policy.mjs](<../../.claude/harness/runtime/workflow/change-policy.mjs>)
- [.claude/harness/runtime/workflow/change-validation.mjs](<../../.claude/harness/runtime/workflow/change-validation.mjs>)
- [.claude/harness/runtime/workflow/investigation-report.mjs](<../../.claude/harness/runtime/workflow/investigation-report.mjs>)
- [.claude/harness/runtime/workflow/packet-runtime.mjs](<../../.claude/harness/runtime/workflow/packet-runtime.mjs>)
- [.claude/harness/runtime/workflow/semantic-amendment.mjs](<../../.claude/harness/runtime/workflow/semantic-amendment.mjs>)
- [.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>)
- [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>)
- [.claude/harness/runtime/workflow/validation/design-blueprints.mjs](<../../.claude/harness/runtime/workflow/validation/design-blueprints.mjs>)
- [.claude/harness/runtime/workflow/validation/dev-document.mjs](<../../.claude/harness/runtime/workflow/validation/dev-document.mjs>)
- [.claude/harness/runtime/workflow/validation/packet-overview.mjs](<../../.claude/harness/runtime/workflow/validation/packet-overview.mjs>)
- [.claude/harness/runtime/workflow/validation/reader-guide.mjs](<../../.claude/harness/runtime/workflow/validation/reader-guide.mjs>)
- [README.th.md](<../../README.th.md>)
- [cli.sh](<../../cli.sh>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/design.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/design.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/archive/2026-10-15-go-test-json-amendment-task-requirement-spec-land-issue-41-43-44/design.md](<../changes/archive/2026-10-15-go-test-json-amendment-task-requirement-spec-land-issue-41-43-44/design.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md>)
- [openspec/changes/complete-change-packets/design.md](<../changes/complete-change-packets/design.md>)
- [openspec/changes/complete-change-packets/evidence.yaml](<../changes/complete-change-packets/evidence.yaml>)
- [openspec/changes/complete-change-packets/proposal.md](<../changes/complete-change-packets/proposal.md>)
- [openspec/changes/complete-change-packets/tasks.md](<../changes/complete-change-packets/tasks.md>)
- [openspec/investigations/change-doc-outline.md](<change-doc-outline.md>)
- [openspec/investigations/roadmap-after-pstack.json](<roadmap-after-pstack.json>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [openspec/changes/complete-change-packets/proposal.md](<../changes/complete-change-packets/proposal.md>)
- [openspec/changes/complete-change-packets/design.md](<../changes/complete-change-packets/design.md>)
- [README.th.md](<../../README.th.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [openspec/changes/complete-change-packets/tasks.md](<../changes/complete-change-packets/tasks.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/design.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/design.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [openspec/changes/archive/2026-10-15-go-test-json-amendment-task-requirement-spec-land-issue-41-43-44/design.md](<../changes/archive/2026-10-15-go-test-json-amendment-task-requirement-spec-land-issue-41-43-44/design.md>)
- [openspec/changes/archive/2026-10-14-investigation-requirement-continuity/design.md](<../changes/archive/2026-10-14-investigation-requirement-continuity/design.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/complete-change-packets/evidence.yaml](<../changes/complete-change-packets/evidence.yaml>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/specs/skill-guidance/spec.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/hybrid-packets-impact.json
```

