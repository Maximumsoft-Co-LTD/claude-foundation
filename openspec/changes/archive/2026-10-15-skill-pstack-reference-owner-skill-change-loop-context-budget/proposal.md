# Change: นำขั้นตอนที่ตรวจได้จาก skill ของ pstack เข้า reference ของ owner skill ใน Change Loop โดยไม่ขัดกับกฎเดิมและไม่เกิน context budget

- **Change:** `skill-pstack-reference-owner-skill-change-loop-context-budget` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

pstack (cursor/plugins@e5136d8, MIT) เด่นเพราะเนื้อหา skill ที่บอกขั้นตอนตรวจได้ เช่น stop predicate ของ hillclimb, กฎหยุดแก้เดาเมื่อแก้ล้มซ้ำ, proof ladder และ catalog การเขียน ขณะที่ Change Loop เคยรับหลักการ pstack มาแล้วผ่าน pstack-adoption.md (port 5062f28) แต่หลายข้อเหลือแค่หลักการกว้างโดยไม่มีขั้นตอนตรวจได้ และยังขาด technical-writing, unslop, hillclimb และ build-the-lever ทั้งหมด maintainer และ consumer agent จะได้ขั้นตอนที่ใช้ตัดสินใจได้จริงใน skill ที่ถูกโหลดอยู่แล้ว โดย SKILL.md ทั้งหมดเหลือที่ว่างเพียง 37 คำ จึงต้องเพิ่มใน reference ที่โหลดเมื่อจำเป็น และผู้ใช้กำชับว่าเนื้อหาใหม่ต้องไม่ขัดกันเองจน skill พัง

## User stories

- **P1** As consumer agent, I want ขั้นตอน hillclimb และกฎ claim ของ performance ที่ตรวจได้ so that ไม่อ้างว่าเร็วขึ้นโดยไม่มีการวัดที่เชื่อได้ และรู้ว่าเมื่อไรควรหยุด. Requirements: perf-hillclimb, perf-claim-discipline.
- **P1** As consumer agent, I want กฎหยุดแก้เดาเมื่อแก้ล้มซ้ำ และวิธีจับ test ที่ไม่ได้ตรวจอะไรจริง so that แก้ที่ต้นเหตุและ test จับ regression ได้จริง. Requirements: debug-premise-root-cause, test-behavior-checks.
- **P1** As maintainer, I want เนื้อหาใหม่ไม่ขัดกับกฎเดิมและมี test กันการขัดกันในอนาคต so that skill ไม่พังและ agent ไม่ได้คำสั่งที่ขัดกัน. Requirements: no-contradiction-guard, budget-neutral.
- **P2** As consumer agent, I want proof ladder ของผลกระทบและสามคำถาม idempotency so that บอกได้ว่าพิสูจน์ความปลอดภัยถึงระดับไหนและ operation รันซ้ำได้. Requirements: change-proof-ladder, idempotency-three-questions.
- **P2** As maintainer, I want เปลี่ยนปัญหาที่เกิดซ้ำจาก lessons เป็น check ระดับสูงสุดที่ใช้ได้ และใช้เครื่องมือแทนงานมือซ้ำ so that บทเรียนกลายเป็นระบบตรวจ ไม่ใช่ prompt ที่ยาวขึ้น. Requirements: lessons-enforcement-ladder, lever-and-domain-signals.
- **P3** As maintainer, I want แนวทางการเขียนเอกสาร, PR และรายงานที่อ่านง่ายและไม่มีภาษาแบบ AI so that เอกสารที่ agent เขียนใช้งานได้จริง. Requirements: writing-guidance.

## Success criteria

- ทุก requirement มี test ใน skill-catalog.test.mjs ที่ fail บน base (ข้อความหรือไฟล์ยังไม่มี) และ pass หลัง change
- test คำต้องห้ามตรวจเนื้อหาใหม่ทุกไฟล์และ fail เมื่อมีคำสั่ง commit, push, PR, merge, spawn หรือการข้าม approval
- context budgets, reference governance และ workflow documentation contracts ผ่าน โดย SKILL.md รวมเพิ่มไม่เกิน 12 คำ
- ข้อความที่ test pin ไว้เดิมทั้งหมดยังผ่าน และ full suite ผ่าน

## Scope

- **In scope (`skill-guidance`):** agent ที่ต้องปรับ metric รู้ว่าจะหยุดเมื่อไร ใช้ harness ที่แยกความต่างได้ และเก็บทุก attempt เป็น raw run evidence; claim ของ performance มีจำนวนรอบ, spread และ limiter ที่ระบุชื่อ หรือถูกรายงานเป็น inconclusive; agent หยุดซ้อนการแก้เดา ตรวจ state ที่ค้างหลัง restart และแก้ทุก instance ของบั๊กเดียวกันภายในขอบเขตของ change; test ที่ดี fail เมื่อพฤติกรรมพังและผ่านเมื่อแก้ภายใน และ assertion ที่คำนวณค่าคาดหวังจากโค้ดที่ทดสอบถูกจับได้; รายงานผลกระทบบอกว่าการพิสูจน์หยุดที่ระดับใด และพิสูจน์ fact หลักที่ทำให้ปลอดภัยด้วยโค้ดจริง; operation และ lifecycle step ที่ออกแบบใหม่ตอบได้ว่ารันซ้ำ, crash กลางทาง และรันพร้อมกันแล้วเป็นอย่างไร; เมื่อ lessons เสนอ check ถาวร agent เลือกระดับสูงสุดที่ใช้ได้ (architecture, type, lint ที่บอกวิธีแก้, test, เอกสารเป็นลำดับสุดท้าย) และพิสูจน์ว่า check จับกรณีเดิมได้; งานซ้ำที่ไม่ trivial ใช้ script หรือ codemod โดยทำหน่วยแรกด้วยมือแล้วเทียบผล และ design ที่โต if/else ทีละ branch หรือมี boolean ที่ต้อง sync ถูกจับได้; เอกสาร, PR description, commit message และรายงานที่ agent เขียนเลือกรูปแบบถูกและตัดภาษาแบบ AI โดยไม่เปลี่ยนความหมายหรือข้อความที่ parser ต้องการ; คำสั่ง commit, push, เปิด PR, merge, spawn หรือ fan-out เอง, ข้าม approval หรือทำ external action โดยไม่ถาม ในเนื้อหาใหม่ทำให้ test fail และ provenance ระบุทั้งสอง commit; context budget ผ่านโดยไม่ต้องขอการตัดสินใจเรื่อง budget จากผู้ใช้
- **Out of scope:** edits outside `.claude/skills/performance-investigation/references/hillclimb.md`, `.claude/skills/performance-investigation/references/measurement.md`, `.claude/tests/docs/skill-catalog.test.mjs`, `.claude/skills/debug-fundamentals/references/root-cause.md`, `.claude/skills/debug-fundamentals/references/reproduction.md`, `.claude/skills/testing-fundamentals/references/test-design.md`, … +13 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| perf-hillclimb › performance-investigation-references-hillclimb-md | happy | T001 | — |
| perf-hillclimb › reference-governance-bundle-performance-investiga | happy | T001 | — |
| perf-hillclimb › skill-catalog-test-mjs | failure | T001 | — |
| perf-claim-discipline › measurement-md | happy | T001 | — |
| perf-claim-discipline › skill-catalog-test-mjs | edge | T001 | — |
| debug-premise-root-cause › debug-fundamentals-references-root-caus | happy | T002 | — |
| debug-premise-root-cause › skill-catalog-test-mjs | failure | T002 | — |
| debug-premise-root-cause › skill-catalog-test-mjs-2 | edge | T002 | — |
| test-behavior-checks › test-design-md | happy | T002 | — |
| test-behavior-checks › reference-governance-duplicate | edge | T002 | — |
| change-proof-ladder › change-impact-analysis-references-proof-ladd | happy | T003 | — |
| change-proof-ladder › skill-catalog-test-mjs | edge | T003 | — |
| idempotency-three-questions › shared-state-and-async-md-principle | happy | T003 | — |
| idempotency-three-questions › skill-catalog-test-mjs | edge | T003 | — |
| lessons-enforcement-ladder › coding-discipline-references-details | happy | T004 | — |
| lessons-enforcement-ladder › skill-catalog-test-mjs | failure | T004 | — |
| lever-and-domain-signals › details-md-module-design-md | happy | T004 | — |
| lever-and-domain-signals › skill-catalog-test-mjs | edge | T004 | — |
| writing-guidance › writing-md | happy | T005 | — |
| writing-guidance › reference-governance | happy | T005 | — |
| writing-guidance › skill-catalog-test-mjs | failure | T005 | — |
| no-contradiction-guard › skill-catalog-test-mjs | happy | T006 | — |
| no-contradiction-guard › test | failure | T006 | — |
| no-contradiction-guard › skill-catalog-test-mjs-2 | edge | T006 | — |
| budget-neutral › run-context-budget-tests-sh | happy | T006 | — |
| budget-neutral › budget-test | failure | T006 | — |

## Definition of done

- Fresh evidence for every claim (26).
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: จำนวนคำสั่งที่ขัดกับกฎเดิมในเนื้อหาใหม่ = 0 และ SKILL.md รวมเพิ่ม ≤ 12 คำ.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Constraints

- SKILL.md ทั้งหมดเพิ่มได้ไม่เกิน 12 คำรวม (จาก 37 คำที่เหลือ) และไม่มี SKILL.md ใดเกิน 700 คำ
- เนื้อหาใหม่ห้ามสั่ง commit, push, เปิด PR, merge, spawn model/worktree เอง, ข้าม spec approval หรือทำ external action โดยไม่มี authority
- แต่ละเรื่องมี owner reference เดียว ที่อื่นลิงก์แทนการคัดลอก และต้องผ่าน duplicate check ของ reference governance
- ไม่แก้ตาราง 58 แถวใน pstack-adoption.md

## Non-goals

- ไม่นำ never-block-on-the-human, outcome-oriented-execution, subtract-before-you-add, autonomy ที่ทำ external action โดยไม่ถาม และขั้น commit/PR ของ playbook มาใช้
- ไม่สร้าง skill ใหม่หรือ agent definition ใหม่ และไม่ import ข้อความ pstack ทั้งไฟล์
- ไม่เปลี่ยน lessons runtime, LESSONS_SCHEMA_VERSION หรือ benchmark provider ใน change นี้
- release v3.6.4 และ paid e2e เป็นขั้นหลัง Land ไม่ใช่ task ของ change นี้

## Investigation handoff

- **ID:** pstack-skills
- **Outcome:** ready-for-change
- **Summary:** repo เคยนำหลักการ pstack มาแล้วบางส่วน แต่หลายข้อขาดขั้นตอนที่ตรวจได้ และยังขาด technical-writing, unslop, hillclimb, build-the-lever; ด้วย budget ที่ตึง ควรเพิ่มใน reference ของ owner skill ผู้ใช้เลือกนำทั้ง 4 กลุ่มเข้า Change

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| skill-gap@1 | เทียบ skill ของ pstack กับ skill suite ของ Change Loop แล้วระบุสิ่งที่ควรนำมาพัฒนา | requirement: perf-hillclimb; requirement: writing-guidance; requirement: lessons-enforcement-ladder |
| release-patch@1 | release ครั้งเดียวเป็น version +0.0.1 (v3.6.4) หลังงาน skill เสร็จและทดสอบแล้ว | non-goal: release v3.6.4 และ paid e2e เป็นขั้นหลัง Land ไม่ใช่ task ของ change นี้; design: evaluation-plan |
| paid-e2e-100@1 | ทดสอบผลของ skill ที่ปรับด้วย paid e2e ภายในงบ 100$ | design: evaluation-plan |
| scope-four-groups@1 | นำเข้าทั้ง 4 กลุ่มลง reference ของ owner skill: (1) การพิสูจน์ผล = Hillclimb + perf mantra/explain-the-number, test-behavior, fix-root-causes + attack-the-premise; (2) ความปลอดภัยของ change = blast-radius proof ladder, make-operations-idempotent; (3) เรียนรู้จากความผิดพลาด = correct enforcement ladder ต่อยอด lessons, build-the-lever + model-the-domain; (4) การเขียนเอกสาร = unslop + technical-writing | requirement: perf-hillclimb; requirement: perf-claim-discipline; requirement: debug-premise-root-cause; requirement: test-behavior-checks; requirement: change-proof-ladder; requirement: idempotency-three-questions; requirement: lessons-enforcement-ladder; requirement: lever-and-domain-signals; requirement: writing-guidance |
| no-contradiction@1 | คำแนะนำที่เพิ่มต้องไม่ขัดกันเองและไม่ขัดกับ skill, rule, command หรือ harness contract เดิม (เช่น no bundled cleanup, spec approval, guards need proof before removal, expand-migrate-contract, harness-owned lifecycle); ต้องตรวจความขัดแย้งก่อนเขียนและพิสูจน์ด้วย test/audit หลังเขียน | requirement: no-contradiction-guard; design: conflict-matrix; constraint: เนื้อหาใหม่ห้ามสั่ง commit, push, เปิด PR, merge, spawn model/worktree เอง, ข้าม spec approval หรือทำ external action โดยไม่มี authority |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

## Appendix: discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | not-applicable |  |  | เปลี่ยนเฉพาะเนื้อหา skill reference ไม่มี runtime ที่ต้อง operate |
| recoverability | covered | no-contradiction-guard, budget-neutral |  | ทุก failure scenario คืน test fail ที่ระบุไฟล์และข้อความให้แก้แล้วรันใหม่ |

## Appendix: investigation provenance

- **Change intent:** นำขั้นตอนที่ตรวจได้จาก pstack (cursor/plugins@e5136d8, MIT) เข้า reference ของ owner skill โดยไม่เพิ่ม SKILL.md เกิน budget และไม่ขัดหลักเดิม (ไม่มี commit/PR, ไม่เรียก model เอง, ไม่ข้าม spec approval): (1) performance-investigation: hillclimb (stop predicate, harness sensitivity+freeze, attempt log, plateau pivot), perf mantra order, explain-the-number; (2) testing-fundamentals: สองการแก้ในใจและ hollow assertion; debug-fundamentals: attack-the-premise stop rule และ fix-root-causes checks; (3) change-impact-analysis: proof ladder และ load-bearing safety fact; concurrency-fundamentals: idempotency สามคำถาม; (4) lessons: enforcement ladder และ check ต้อง fail บนกรณีในอดีต; coding-discipline/programming-fundamentals: build-the-lever, model-the-domain skip signals; (5) reference การเขียนเอกสาร: unslop catalog + Diátaxis; อัปเดต pstack-adoption.md ให้ชี้ commit ใหม่ วัดผลด้วย skill-evaluation และ paid e2e งบ 100$ ก่อน release v3.6.4
- **State:** .foundation/investigations/pstack-skills.json @ 1eaadef4414a7cbc012e72ebea22c16eb7d71bcb63b9062fef8c37f93464f9f5
- **Sources:** sha256:4463c0eae1e64a5b9e21d0d06bc6613bd85af3bc38cfc00989eaec8e93b52501
## บริบทที่รับจาก Investigate

เป้าหมาย: นำจุดแข็งด้าน skill ของ pstack มาปรับ skill suite ของ Change Loop

ผลลัพธ์ที่ต้องการ: ตารางเทียบ skill/หลักการรายตัว พร้อม skill ที่ควรสร้างหรือแก้ เพื่อส่งเข้า Change และวัดผลก่อน/หลังด้วย paid e2e งบ 100$ แล้ว release v3.6.4


### ขอบเขตและผู้เกี่ยวข้อง

- pstack principle skills
- pstack workflow skills
- Change Loop .claude/skills
- context budgets
- license
- maintainer
- consumer agent

### ข้อกำหนดและประวัติการแก้ไข

- **skill-gap@1** [behavior / stated / user]: เทียบ skill ของ pstack กับ skill suite ของ Change Loop แล้วระบุสิ่งที่ควรนำมาพัฒนา
- **release-patch@1** [constraint / stated / user]: release ครั้งเดียวเป็น version +0.0.1 (v3.6.4) หลังงาน skill เสร็จและทดสอบแล้ว
- **paid-e2e-100@1** [success-criterion / stated / user]: ทดสอบผลของ skill ที่ปรับด้วย paid e2e ภายในงบ 100$
- **scope-four-groups@1** [behavior / stated / user]: นำเข้าทั้ง 4 กลุ่มลง reference ของ owner skill: (1) การพิสูจน์ผล = Hillclimb + perf mantra/explain-the-number, test-behavior, fix-root-causes + attack-the-premise; (2) ความปลอดภัยของ change = blast-radius proof ladder, make-operations-idempotent; (3) เรียนรู้จากความผิดพลาด = correct enforcement ladder ต่อยอด lessons, build-the-lever + model-the-domain; (4) การเขียนเอกสาร = unslop + technical-writing
- **no-contradiction@1** [constraint / stated / user]: คำแนะนำที่เพิ่มต้องไม่ขัดกันเองและไม่ขัดกับ skill, rule, command หรือ harness contract เดิม (เช่น no bundled cleanup, spec approval, guards need proof before removal, expand-migrate-contract, harness-owned lifecycle); ต้องตรวจความขัดแย้งก่อนเขียนและพิสูจน์ด้วย test/audit หลังเขียน

### คำถามและการตัดสินใจ

- q-skill-scope [answered]: เลือก skill จาก pstack ที่จะนำเข้า Change → ทั้ง 4 กลุ่ม

### สาระจากบทสนทนา

- u1 [user]: แต่ pstack เก่งเพราะ skill นะเราไม่ได้เอา skill มาพัฒนาเลยหรอ (session message)
- u2 [user]: ลุยเลย investigate skill ของ pstack (session message)
- u3 [user]: เดี๋ยวฉันรองานนี้เสร็จและทดสอบ และ ถึงจะ release ทีเดียวใน version +0.0.1 (session message)
- u4 [user]: ต้องทดสอบ paid e2e ด้วย budget 100$ (session message)
- u5 [user]: เลือกทั้ง 4 กลุ่ม: การพิสูจน์ผล, ความปลอดภัยของ change, เรียนรู้จากความผิดพลาด, การเขียนเอกสาร (AskUserQuestion answer (skill scope))
- u6 [user]: ระวังเรื่องตอนเพิ่มต้องไม่ขัดกันเองนะ เดี๋ยว skill พัง (session message)

### ช่องว่างของประวัติ

- เนื้อหา pstack มาจาก clone ภายนอก cursor/plugins@e5136d82418d2db3165ea1050d17577cd618cc05 ซึ่งไม่ได้อยู่ใน repo จึงอ้างเป็น source ที่ hash ไม่ได้; สรุปภายนอกบันทึกใน openspec/investigations/pstack-skills.md

