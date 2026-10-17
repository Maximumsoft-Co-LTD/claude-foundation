<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: skill-routing-ignored

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-17T13:19:18.780Z · faf40ea6552d67451b55f61f6a6b057e1906028c6a6709d2abb1ec55aba254b0

## ปัญหา

Build EDIT สั่งให้โหลด skill แต่ agent ไม่เรียก skill ที่สั่งเลยใน 3 รอบ paid checkpoint

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** ให้ skill ที่ harness เลือกถูกโหลดจริงระหว่าง Build

**ผลลัพธ์ที่ต้องการ:** รู้สาเหตุที่ agent ไม่เรียก skill และวิธีแก้ที่วัดผลได้


### ผู้เกี่ยวข้อง

- user
- agent
- harness

### ขอบเขต

- advance EDIT skills
- .claude/commands/dev.md
- .claude/commands/build.md

### ข้อกำหนดล่าสุด

- **find-cause@1** [behavior / stated] สืบว่าทำไม agent ไม่เรียก skill ที่ Build สั่ง และแก้ไข; ที่มา: user (u-skill)
- **better-descriptions@1** [behavior / stated] เขียน description ของ skill ให้ดีเพื่อให้ agent เรียกเอง; ที่มา: user (u-desc)
- **no-hook@1** [constraint / stated] ไม่ใช้ hook บังคับโหลด skill; ที่มา: user (u-nohook)
- **spec-aligned@1** [behavior / stated] ออกแบบ skill ให้สอดคล้องกับ spec เพื่อให้ agent รู้เองว่าต้องเรียก skill อะไร; ที่มา: user (u-nohook, u-go)

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- **poc-doc-contract** [complete]: ถ้า dev.md และ build.md บอกให้โหลด skills ของ EDIT ก่อน agent จะเรียก skill ไหม และผลงานเป็นอย่างไร; เกณฑ์ตัดสิน: 4 lane ที่ Build สั่ง skill หลายแบบ / claude-sonnet-5-5 ทีละ lane / เทียบกับรอบบน main 3eb57e95d; ผลที่พบ: เรียก skill ที่สั่ง 3 จาก 12 (เดิม 0 จาก 43): notes-api โหลดครบ 3 skill อีก 3 lane ไม่โหลดเลย / ทั้ง 4 lane อ่าน dev.md ฉบับแก้แล้ว แต่ 3 lane ยังเริ่มเขียนโค้ดทันทีหลัง EDIT / notes-api ที่โหลด skill: 146 → 173 วินาที, $0.58 → $0.68 (+18%) oracle 13/13 เท่าเดิม / ทุก lane archived และ oracle เต็ม; ข้อจำกัด: รันครั้งเดียวต่อ lane / ไม่ได้วัดคุณภาพที่ oracle ไม่ครอบ เช่นการออกแบบหรือความครบของ test; refs: find-cause@1
- **eval-descriptions** [complete]: description ที่ขึ้นต้นด้วยจังหวะที่ควรเรียก ทำให้ agent เรียก skill เองบ่อยขึ้นไหม; เกณฑ์ตัดสิน: 5 skill, 8 โจทย์ (6 ควรเรียก รวมภาษาไทย 1, 2 ไม่ควรเรียก) / 2 รอบต่อโจทย์ต่อชุด / claude-sonnet-5-5 ใน fixture ชั่วคราว ไม่แก้ skill จริง; ผลที่พบ: เรียก skill ที่ถูก: เดิม 1/12, ใหม่ 4/12 / api-design: เดิม 1/2 ใหม่ 2/2; security: เดิม 0/2 ใหม่ 2/2 / testing, database, debug และโจทย์ภาษาไทย: 0/2 ทั้งสองชุด / เรียกผิดโจทย์ 0 ครั้งทั้งสองชุด / ค่าใช้จ่ายรวม $4.34 ($2.19 เดิม, $2.15 ใหม่); ข้อจำกัด: 2 รอบต่อโจทย์ ความแปรปรวนยังสูง / fixture มี skill ระดับผู้ใช้ปนอยู่ (53 skill ใน session) / วัดเฉพาะการเรียก skill ไม่ได้วัดคุณภาพงาน; refs: find-cause@1
- **eval-spec-aligned** [complete]: description ที่ใช้คำของ spec และ task ที่ระบุ skill ทำให้ agent เรียก skill เองถูกไหม; เกณฑ์ตัดสิน: change packet จริงขนาดเล็กต่อโจทย์ (proposal, spec, tasks) / 3 แบบ: old, spec, spec-task; 2 รอบต่อโจทย์ / 8 โจทย์: 5 เรื่อง, 2 ไม่ควรเรียก, 1 ภาษาไทย; ผลที่พบ: old: เรียกถูก 0/12 / spec (description ใช้คำของ spec): 2/12 / spec-task (description ใหม่ + task ระบุ skill): 12/12 และโหลดก่อนแก้โค้ด 12/12 / เรียกผิดโจทย์ 0 ทั้ง 3 แบบ; โจทย์ไม่ควรเรียกไม่เรียกเลย / ค่าใช้จ่าย $2.38, $2.37, $2.44 (+2.5% สำหรับ spec-task); เวลาเฉลี่ย 21, 19, 19 วินาที; ข้อจำกัด: 2 รอบต่อโจทย์ / fixture มี skill ระดับผู้ใช้ปนอยู่ / จำกัด 6 turn ต่อรอบ ไม่ใช่ lifecycle เต็ม / ยังไม่ได้วัดคุณภาพงาน; refs: spec-aligned@1
- **lanes-skills-in-task** [complete]: ใน lifecycle เต็ม การระบุ skill ใน task ของ EDIT และ description ใหม่ ทำให้ agent เรียก skill ไหม; เกณฑ์ตัดสิน: change task-build-skill-... ใน sandbox / 4 paid lane เดิม 2 รอบ: ชื่อ skill ท้ายบรรทัด และหลังชื่อ task; ผลที่พบ: รอบที่ 1 (ชื่อ skill ท้ายบรรทัด task ยาว ~1,200 ตัวอักษร): เรียก 0/10 / รอบที่ 2 (ชื่อ skill หลังชื่อ task ก่อนแท็ก): เรียก 0/9 / agent อ่าน dev.md, change.md, เอกสาร requirement ของโปรเจกต์ และ source เท่านั้น ไม่อ่าน tasks.md หรือ spec ของ change ระหว่าง Build / ทุก lane archived และ oracle เต็ม ค่าใช้จ่ายใกล้เคียงรอบบน main; ข้อจำกัด: รอบละครั้งต่อ lane / eval ก่อนหน้าให้ agent อ่าน packet ที่คนอื่นเขียน ส่วนใน lifecycle agent เขียน packet เองแล้วลงมือจากความจำ; refs: spec-aligned@1
- **poc-author-plans** [complete]: ถ้า agent เลือก skill ของแต่ละ task เองตอนเขียน change จะเรียก skill ตอน Build ไหม; เกณฑ์ตัดสิน: change.md ให้ปิดท้าย outcome ของ task ด้วย skills ที่ต้องใช้และโหลดก่อนลงมือ / description ใหม่ 5 skill / 4 paid lane เดิม; ผลที่พบ: agent ใส่ skill ใน task เองครบ 4/4 lane และเลือกตรงงาน (เช่น database+testing สำหรับ migration, security+testing สำหรับ webhook) / เรียก skill จริงตอน Build 1/9 (notes-api เรียก testing-fundamentals) / ทุก lane archived และ oracle เต็ม: 146, 153, 152, 99 วินาที; $0.50, $0.59, $0.53, $0.44; ข้อจำกัด: รอบละครั้งต่อ lane / oracle ไม่วัดคุณภาพที่ skill ตั้งใจช่วย; refs: spec-aligned@1

### สาระจากบทสนทนา

- **u-skill** [user]: investigate agent ไม่เรียก skill ที่ว่า เกิดอะไรขึ้น แก้ไขยัง (session message)
- **u-desc** [user]: เขียน description ให้ดีเพื่อให้ agent เรียก skill เองดีไหม (session message)
- **u-nohook** [user]: ไม่อยากให้ใช้ hook เพราะบังคับเกินไป อยากออกแบบ skill ให้สอดคล้องกับ spec agent ควรรู้เองว่าต้องเรียก skill อะไร (session message)
- **u-go** [user]: ตามนี้เลยและทดสอบด้วยว่าดีไหม (session message)
- **u-choose** [user]: 1 ลองดู 2 ok 3 ok (session message)

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- ตัวเลขมาจาก raw bench ที่ git ไม่เก็บ (.claude/tests/bench/results/openspec-native-lab) วิเคราะห์ด้วยสคริปต์นอก repo

## ข้อสรุปปัจจุบัน

ใน lifecycle จริง agent แทบไม่เรียก skill ไม่ว่าจะสั่งทางไหน รวมถึงเมื่อเลือก skill เองใน draft (1/9) ขณะที่ผลงานตาม oracle ผ่านครบโดยไม่ต้องใช้ skill ข้อสรุปคือเก็บ description ใหม่ไว้ให้ agent เลือกเอง และเอาระบบสั่ง skill ใน EDIT ออก

## ข้อเสนอแนะและเหตุผล

เก็บ description ใหม่ของ 5 skill; เอา skill routing ออกจาก Build EDIT (field skills, คำสั่งโหลด และชื่อ skill ใน task); คงการวัด skillUsage ใน scorecard

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **never-loaded:** 3 รอบ paid checkpoint (8262dfe97, 54fad9c99, รอบหลังแก้ draft v5) Build EDIT สั่ง skill 34, 45 และ 42 ครั้ง agent เรียก skill ที่สั่ง 0 ครั้งทุกรอบ แม้ Skill tool อยู่ใน toolset และ skill ติดตั้งในโปรเจกต์ ([.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>))
- **next-action:** รอบบน main (3eb57e95d) ทั้ง 23 lane ได้ EDIT ที่ขึ้นต้น instructions ด้วย 'First, load these skills by name' และสิ่งที่ agent ทำต่อทันทีทุก lane คือ Write/Edit/Read/Bash ไม่มี Skill เลย ([.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>))
- **guides-read:** ทุก lane อ่าน .claude/commands/dev.md และ change.md (23/23) ไม่มี lane ไหนอ่าน build.md ([.claude/commands/dev.md](<../../.claude/commands/dev.md>))
- **dev-plain-edit:** dev.md สั่งว่า build.md อ่านเฉพาะเมื่อล้มหรือ action ที่ไม่ใช่ plain EDIT และสำหรับ plain EDIT ให้ 'run its tasks in workspace, then resume' โดยไม่พูดถึง skill ([.claude/commands/dev.md](<../../.claude/commands/dev.md>))
- **build-no-skill:** build.md บรรทัด EDIT สั่งให้ implement tasks ใน workspace แล้ว resume ไม่พูดถึง skill; AGENT.md อ้าง fundamentals.md สำหรับ skill routing ซึ่งเป็นตาราง trigger ไม่ใช่ field skills ของ EDIT ([.claude/commands/build.md](<../../.claude/commands/build.md>), [.claude/harness/AGENT.md](<../../.claude/harness/AGENT.md>))
- **history:** skill routing เพิ่มใน cff0201ce และ fb117c837 ย้ายคำสั่งโหลด skill ขึ้นบรรทัดแรกของ instructions ทั้งสอง commit ไม่ได้แก้ dev.md หรือ build.md ([.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>))
- **poc-result:** POC แก้เอกสาร: agent เรียก skill ที่สั่ง 3/12 (เดิม 0/43); lane ที่โหลด skill ใช้เวลาและเงินเพิ่ม ~18% ผลงานเท่าเดิม ([.claude/commands/dev.md](<../../.claude/commands/dev.md>), [.claude/commands/build.md](<../../.claude/commands/build.md>))
- **desc-eval:** description ใหม่: เรียกถูก 4/12 เทียบกับ 1/12 ช่วย api-design และ security แต่ testing, database, debug ไม่ถูกเรียกเลย ไม่มีการเรียกผิด ([.claude/skills/testing-fundamentals/SKILL.md](<../../.claude/skills/testing-fundamentals/SKILL.md>), [.claude/skills/api-design-fundamentals/SKILL.md](<../../.claude/skills/api-design-fundamentals/SKILL.md>))
- **spec-task-result:** task ที่ระบุ skill ร่วมกับ description ที่ใช้คำของ spec: เรียกถูก 12/12 ก่อนแก้โค้ด 12/12 ไม่มีเรียกผิด ค่าใช้จ่าย +2.5%; description อย่างเดียวได้ 2/12 ([.claude/skills/testing-fundamentals/SKILL.md](<../../.claude/skills/testing-fundamentals/SKILL.md>), [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>))
- **lifecycle-ignores-task-skills:** ใน lifecycle เต็ม skill ที่ระบุใน task ของ EDIT ถูกข้ามทั้งสองตำแหน่ง (0/10, 0/9) เพราะ agent ผู้เขียน change เองไม่ได้อ่าน task หรือ spec ซ้ำตอน Build ([.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>), [.claude/commands/dev.md](<../../.claude/commands/dev.md>))
- **author-plan-result:** agent เลือก skill เองใน draft 4/4 แต่เรียกจริงตอน Build 1/9; ใน lifecycle ทุกวิธีที่ลอง (คำสั่งใน JSON, เอกสาร, ชื่อใน task, agent เลือกเอง) ได้ 0–3 จาก 9–43 ([.claude/commands/change.md](<../../.claude/commands/change.md>))

## สมมติฐานและหลักฐาน

- **h-doc-contract — มีหลักฐานสนับสนุน:** agent ทำตาม dev.md ที่บอกให้ทำแค่ tasks แล้ว resume สำหรับ plain EDIT คำสั่งโหลด skill ที่อยู่ใน JSON จึงถูกข้าม; หลักฐาน: next-action, guides-read, dev-plain-edit, build-no-skill, history
- **h-doc-not-enough — มีหลักฐานสนับสนุน:** แก้เอกสารอย่างเดียวไม่พอ เพราะ agent อ่าน dev.md ตอนเริ่ม แต่ EDIT มาหลังจากนั้นหลายนาที; หลักฐาน: poc-result, guides-read
- **h-desc-partial — มีหลักฐานสนับสนุน:** description ช่วยกับ skill ที่โดเมนเฉพาะ (API, security) แต่ skill ทั่วไป (testing, debug, database) agent ไม่เรียกเพราะคิดว่าทำเองได้; หลักฐาน: desc-eval
- **h-task-names — มีหลักฐานสนับสนุน:** agent เรียก skill เมื่อชื่อ skill อยู่ใน task ที่กำลังอ่านตอนลงมือ; หลักฐาน: spec-task-result
- **h-author-plans-skills — มีหลักฐานหักล้าง:** agent ที่เขียน change เองจะเรียก skill ถ้าเลือก skill ตอนเขียน task ใน Change เพราะเป็นแผนของมันเอง; หลักฐาน: author-plan-result

## ทางเลือกและข้อแลกเปลี่ยน

### o-doc

เพิ่มในสัญญา plain EDIT ของ dev.md และ build.md: โหลด skills ที่ EDIT ระบุด้วย Skill tool ก่อนแก้โค้ด

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-remove

เอา skill routing ออกถ้า POC แสดงว่าโหลดแล้วไม่ช่วยผลงาน

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **d-scope — ตัดสินใจแล้ว:** ทำอะไรต่อกับ skill
  ตัวเลือก: ลองข้อ 1 (agent เลือก skill เอง), เก็บ description ใหม่ (ข้อ 2), เอาระบบสั่ง skill ออก (ข้อ 3); ข้อเสนอแนะและเหตุผล: ผู้ใช้ตอบ 1 ลองดู 2 ok 3 ok; หลักฐาน: ยังไม่ได้บันทึก

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/commands/build.md](<../../.claude/commands/build.md>)
- [.claude/commands/change.md](<../../.claude/commands/change.md>)
- [.claude/commands/dev.md](<../../.claude/commands/dev.md>)
- [.claude/harness/AGENT.md](<../../.claude/harness/AGENT.md>)
- [.claude/harness/runtime/workflow/skill-routing.mjs](<../../.claude/harness/runtime/workflow/skill-routing.mjs>)
- [.claude/skills/api-design-fundamentals/SKILL.md](<../../.claude/skills/api-design-fundamentals/SKILL.md>)
- [.claude/skills/testing-fundamentals/SKILL.md](<../../.claude/skills/testing-fundamentals/SKILL.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/design.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/design.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/proposal.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/proposal.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/specs/build-skill-routing/spec.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/specs/build-skill-routing/spec.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/design.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/design.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/proposal.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/specs/build-skill-routing/spec.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/specs/build-skill-routing/spec.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md](<../changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md>)
- [openspec/changes/task-build-skill-task-description-skill-spec-agent-skill/proposal.md](<../changes/task-build-skill-task-description-skill-spec-agent-skill/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [openspec/changes/task-build-skill-task-description-skill-spec-agent-skill/proposal.md](<../changes/task-build-skill-task-description-skill-spec-agent-skill/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/proposal.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/design.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/design.md>)
- [openspec/changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md](<../changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/specs/build-skill-routing/spec.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/specs/build-skill-routing/spec.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/proposal.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/proposal.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [openspec/changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/design.md](<../changes/archive/2026-10-15-action-edit-build-skill-typed-change-bench-skill/design.md>)
- [openspec/changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/specs/build-skill-routing/spec.md](<../changes/archive/2026-10-15-skill-build-action-input-domain-testing-fundamentals/specs/build-skill-routing/spec.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/skill-routing-ignored.json
```

