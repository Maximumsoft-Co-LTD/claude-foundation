<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: pstack-skills

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-15T08:45:38.777Z · 1eaadef4414a7cbc012e72ebea22c16eb7d71bcb63b9062fef8c37f93464f9f5

## ปัญหา

pstack เก่งเพราะเนื้อหา skill แต่ Change Loop ยังไม่ได้นำ skill ของ pstack มาพัฒนา: skill ใดของ pstack (54 ตัว, cursor/plugins@e5136d8, MIT) ดีกว่าหรือไม่มีใน Change Loop และควรนำอะไรมาปรับภายใน context budget และหลักเดิม

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** นำจุดแข็งด้าน skill ของ pstack มาปรับ skill suite ของ Change Loop

**ผลลัพธ์ที่ต้องการ:** ตารางเทียบ skill/หลักการรายตัว พร้อม skill ที่ควรสร้างหรือแก้ เพื่อส่งเข้า Change และวัดผลก่อน/หลังด้วย paid e2e งบ 100$ แล้ว release v3.6.4


### ผู้เกี่ยวข้อง

- maintainer
- consumer agent

### ขอบเขต

- pstack principle skills
- pstack workflow skills
- Change Loop .claude/skills
- context budgets
- license

### ข้อกำหนดล่าสุด

- **skill-gap@1** [behavior / stated] เทียบ skill ของ pstack กับ skill suite ของ Change Loop แล้วระบุสิ่งที่ควรนำมาพัฒนา; ที่มา: user (u1, u2)
- **release-patch@1** [constraint / stated] release ครั้งเดียวเป็น version +0.0.1 (v3.6.4) หลังงาน skill เสร็จและทดสอบแล้ว; ที่มา: user (u3)
- **paid-e2e-100@1** [success-criterion / stated] ทดสอบผลของ skill ที่ปรับด้วย paid e2e ภายในงบ 100$; ที่มา: user (u4)
- **scope-four-groups@1** [behavior / stated] นำเข้าทั้ง 4 กลุ่มลง reference ของ owner skill: (1) การพิสูจน์ผล = Hillclimb + perf mantra/explain-the-number, test-behavior, fix-root-causes + attack-the-premise; (2) ความปลอดภัยของ change = blast-radius proof ladder, make-operations-idempotent; (3) เรียนรู้จากความผิดพลาด = correct enforcement ladder ต่อยอด lessons, build-the-lever + model-the-domain; (4) การเขียนเอกสาร = unslop + technical-writing; ที่มา: user (u5)
- **no-contradiction@1** [constraint / stated] คำแนะนำที่เพิ่มต้องไม่ขัดกันเองและไม่ขัดกับ skill, rule, command หรือ harness contract เดิม (เช่น no bundled cleanup, spec approval, guards need proof before removal, expand-migrate-contract, harness-owned lifecycle); ต้องตรวจความขัดแย้งก่อนเขียนและพิสูจน์ด้วย test/audit หลังเขียน; ที่มา: user (u6)

### คำถามและคำตอบ

- **q-skill-scope** [answered]: เลือก skill จาก pstack ที่จะนำเข้า Change → ทั้ง 4 กลุ่ม (u5)

### งานอิสระที่ทำต่อได้

- compare-principles: เทียบหลักการ 24 ข้อของ pstack กับ fundamentals และ skill ของเรา
- compare-workflows: เทียบ workflow skill 30 ตัวของ pstack กับ skill และคำสั่งของเรา
- change-handoff: handoff เข้า Change ตาม skill ที่เลือก

### สาระจากบทสนทนา

- **u1** [user]: แต่ pstack เก่งเพราะ skill นะเราไม่ได้เอา skill มาพัฒนาเลยหรอ (session message)
- **u2** [user]: ลุยเลย investigate skill ของ pstack (session message)
- **u3** [user]: เดี๋ยวฉันรองานนี้เสร็จและทดสอบ และ ถึงจะ release ทีเดียวใน version +0.0.1 (session message)
- **u4** [user]: ต้องทดสอบ paid e2e ด้วย budget 100$ (session message)
- **u5** [user]: เลือกทั้ง 4 กลุ่ม: การพิสูจน์ผล, ความปลอดภัยของ change, เรียนรู้จากความผิดพลาด, การเขียนเอกสาร (AskUserQuestion answer (skill scope))
- **u6** [user]: ระวังเรื่องตอนเพิ่มต้องไม่ขัดกันเองนะ เดี๋ยว skill พัง (session message)

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- เนื้อหา pstack มาจาก clone ภายนอก cursor/plugins@e5136d82418d2db3165ea1050d17577cd618cc05 ซึ่งไม่ได้อยู่ใน repo จึงอ้างเป็น source ที่ hash ไม่ได้; สรุปภายนอกบันทึกใน openspec/investigations/pstack-skills.md

## ข้อสรุปปัจจุบัน

repo เคยนำหลักการ pstack มาแล้วบางส่วน แต่หลายข้อขาดขั้นตอนที่ตรวจได้ และยังขาด technical-writing, unslop, hillclimb, build-the-lever; ด้วย budget ที่ตึง ควรเพิ่มใน reference ของ owner skill ผู้ใช้เลือกนำทั้ง 4 กลุ่มเข้า Change

## ข้อเสนอแนะและเหตุผล

นำขั้นตอนที่ตรวจได้จาก pstack (cursor/plugins@e5136d8, MIT) เข้า reference ของ owner skill โดยไม่เพิ่ม SKILL.md เกิน budget และไม่ขัดหลักเดิม (ไม่มี commit/PR, ไม่เรียก model เอง, ไม่ข้าม spec approval): (1) performance-investigation: hillclimb (stop predicate, harness sensitivity+freeze, attempt log, plateau pivot), perf mantra order, explain-the-number; (2) testing-fundamentals: สองการแก้ในใจและ hollow assertion; debug-fundamentals: attack-the-premise stop rule และ fix-root-causes checks; (3) change-impact-analysis: proof ladder และ load-bearing safety fact; concurrency-fundamentals: idempotency สามคำถาม; (4) lessons: enforcement ladder และ check ต้อง fail บนกรณีในอดีต; coding-discipline/programming-fundamentals: build-the-lever, model-the-domain skip signals; (5) reference การเขียนเอกสาร: unslop catalog + Diátaxis; อัปเดต pstack-adoption.md ให้ชี้ commit ใหม่ วัดผลด้วย skill-evaluation และ paid e2e งบ 100$ ก่อน release v3.6.4

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **prior-adoption:** repo เคยนำหลักการ pstack มาแล้วผ่าน pstack-adoption.md ที่ map 58 skill จาก port ของ Michael Denyer (5062f28) ไปยัง owner skill แต่หลายข้อไม่มีข้อความตรงใน skill ปลายทาง ([.claude/skills/skill-suite-auditor/references/pstack-adoption.md](<../../.claude/skills/skill-suite-auditor/references/pstack-adoption.md>), [openspec/investigations/pstack-skills.md](<pstack-skills.md>))
- **budget-tight:** SKILL.md ทั้งหมดรวม 9463/9500 คำ, fundamentals.md 665/700, AGENT.md 300/300; การเกินต้องให้ผู้ใช้ตัดสิน จึงควรเพิ่มใน reference ที่โหลดเมื่อจำเป็น ([.claude/tests/harness/run-context-budget-tests.sh](<../../.claude/tests/harness/run-context-budget-tests.sh>), [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>))
- **principle-gaps:** หลักการ 24 ข้อ: ครอบ 10, บางส่วน 9, ขาด build-the-lever, ขัดหลักเดิม never-block-on-the-human / outcome-oriented-execution / subtract-before-you-add; Change Loop ไม่มีกฎระบุชื่อหลักการที่ใช้ ([openspec/investigations/pstack-skills.md](<pstack-skills.md>), [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>))
- **workflow-gaps:** ขาด technical-writing และ unslop; บางส่วน: Hillclimb (benchmark provider ตรวจแค่ regression), perf mantra, blast-radius proof ladder, correct enforcement ladder, verification-driver maintenance; ส่วน architect/arena/swarm/interrogate/setup/commit-PR ขัดหลักเดิม ([openspec/investigations/pstack-skills.md](<pstack-skills.md>), [.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>), [.claude/harness/runtime/observability/lessons-runtime.mjs](<../../.claude/harness/runtime/observability/lessons-runtime.mjs>), [.claude/skills/performance-investigation/SKILL.md](<../../.claude/skills/performance-investigation/SKILL.md>), [.claude/skills/change-impact-analysis/SKILL.md](<../../.claude/skills/change-impact-analysis/SKILL.md>))
- **agent-contract:** poteto-agent ต้องอ่าน poteto-mode ทั้งไฟล์ (~3.1k คำ) ก่อนทำงาน ส่วน task packet ของเราเล็กกว่าและมี lease/fencing จึงไม่ควรนำมา ([openspec/investigations/pstack-skills.md](<pstack-skills.md>))

## สมมติฐานและหลักฐาน

- **h-reference-adoption — มีหลักฐานสนับสนุน:** นำขั้นตอนที่ตรวจได้ของ pstack เข้า reference ของ owner skill (ไม่เพิ่ม SKILL.md) จะเพิ่มคุณภาพโดยไม่เกิน context budget และไม่ขัดหลักเดิม; หลักฐาน: budget-tight, principle-gaps, workflow-gaps

## ทางเลือกและข้อแลกเปลี่ยน

### o-hillclimb

Hillclimb + perf mantra/forensics + explain-the-number → performance-investigation/references (และ benchmark improvement threshold ถ้าจำเป็น)

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-root-cause

fix-root-causes + attack-the-premise → debug-fundamentals/references

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-tests

test-behavior (สองการแก้ในใจ, hollow assertion) → testing-fundamentals/references

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-idempotent

make-operations-idempotent (สามคำถาม, temp+rename) → concurrency-fundamentals/references

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-lessons-ladder

correct enforcement ladder + check ต้อง fail บนกรณีจริงในอดีต → lessons และ change reference

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-blast-radius

proof ladder + load-bearing safety fact → change-impact-analysis/references

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-writing

unslop + technical-writing → reference ร่วมสำหรับเอกสาร

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### o-lever

build-the-lever + model-the-domain/reader-load → coding-discipline / programming-fundamentals references

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **skill-scope — ตัดสินใจแล้ว:** จะนำ skill ใดเข้า Change
  ตัวเลือก: o-hillclimb / o-root-cause / o-tests / o-idempotent / o-lessons-ladder / o-blast-radius / o-writing / o-lever; ข้อเสนอแนะและเหตุผล: o-hillclimb; หลักฐาน: workflow-gaps

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/EVIDENCE.md](<../../.claude/harness/EVIDENCE.md>)
- [.claude/harness/runtime/observability/lessons-runtime.mjs](<../../.claude/harness/runtime/observability/lessons-runtime.mjs>)
- [.claude/rules/fundamentals.md](<../../.claude/rules/fundamentals.md>)
- [.claude/skills/change-impact-analysis/SKILL.md](<../../.claude/skills/change-impact-analysis/SKILL.md>)
- [.claude/skills/debug-fundamentals/SKILL.md](<../../.claude/skills/debug-fundamentals/SKILL.md>)
- [.claude/skills/performance-investigation/SKILL.md](<../../.claude/skills/performance-investigation/SKILL.md>)
- [.claude/skills/performance-investigation/references/measurement.md](<../../.claude/skills/performance-investigation/references/measurement.md>)
- [.claude/skills/skill-suite-auditor/references/pstack-adoption.md](<../../.claude/skills/skill-suite-auditor/references/pstack-adoption.md>)
- [.claude/skills/testing-fundamentals/SKILL.md](<../../.claude/skills/testing-fundamentals/SKILL.md>)
- [.claude/tests/harness/run-context-budget-tests.sh](<../../.claude/tests/harness/run-context-budget-tests.sh>)
- [README.th.md](<../../README.th.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/related-projects-research-2026-09-05.md](<../../docs/reports/related-projects-research-2026-09-05.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/workflow-optimization-summary-2026-07-30.md](<../../docs/workflow-optimization-summary-2026-07-30.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/investigations/pstack-skills.md](<pstack-skills.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [README.th.md](<../../README.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [docs/reports/related-projects-research-2026-09-05.md](<../../docs/reports/related-projects-research-2026-09-05.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)
- [docs/workflow-optimization-summary-2026-07-30.md](<../../docs/workflow-optimization-summary-2026-07-30.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/pstack-skills.json
```

