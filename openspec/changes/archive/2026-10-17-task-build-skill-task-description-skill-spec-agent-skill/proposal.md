# Change: task ของ Build ระบุ skill ที่เกี่ยวในตัว task และ description ของ skill ใช้คำเดียวกับ spec เพื่อให้ agent เรียก skill เอง

- **Change:** `task-build-skill-task-description-skill-spec-agent-skill` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-17

## เหตุผล

ใน paid checkpoint 3 รอบ Build สั่งให้โหลด skill 34–45 ครั้งต่อรอบแต่ agent ไม่เรียกเลย เพราะคำสั่งอยู่ในช่องแยกของ JSON ที่ agent ข้าม การทดสอบแสดงว่าเมื่อชื่อ skill อยู่ใน task ที่ agent อ่านตอนลงมือ และ description ใช้คำเดียวกับ spec agent เรียก skill ถูก 12/12 ก่อนแก้โค้ด โดยไม่ต้องบังคับด้วย hook

## ขอบเขต

- **In scope (`build-skill-routing`):** agent เห็นชื่อ skill ใน task ที่กำลังลงมือ และ EDIT ยังมี field skills เหมือนเดิม; description ของ 5 skill ชี้ไปที่ส่วนของ spec ที่ agent อ่าน และยังบอกกรณีที่ไม่ควรเรียก
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/runtime/workflow/skill-routing.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/skill-routing.test.mjs`, `.claude/skills/testing-fundamentals/SKILL.md`, `.claude/skills/database-fundamentals/SKILL.md`, … +3 more; the authored Non-goals below

## Non-goals

- ไม่ใช้ hook หรือการบังคับใดเพื่อโหลด skill
- ไม่เปลี่ยน mapping ว่า change แบบไหนได้ skill อะไร

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| skills-in-task | task ระบุ skill | unclassified | T001 | test: `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/skill-routing.test.mjs` | — |
|  | ไม่มี skill | unclassified | T001 |  |  |
| spec-vocabulary-descriptions | description อ้าง spec | unclassified | T002 | test: `.claude/harness/tests/skill-routing.test.mjs` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: การสืบค้น

- **ID:** skill-routing-ignored
- **ผลลัพธ์:** ready-for-change
- **สรุป:** ไม่ต้องใช้ hook: เมื่อ task ใน tasks.md ระบุ skill และ description ใช้คำของ spec agent เรียก skill ถูก 12/12 ก่อนแก้โค้ด ไม่มีเรียกผิด ค่าใช้จ่ายเพิ่ม 2.5% ขั้นต่อไปคือให้ compiler เขียน skill ที่ route แล้วลงใน task และทดสอบใน paid lane
- **เจตนาของ change:** compiler เขียน skill ที่ harness route ไว้ลงในบรรทัด task ของ tasks.md (และใน task ของ EDIT); เขียน description ของ skill ใหม่ด้วยคำของ spec (workType, riskSignals, requirement, scenario); ไม่ใช้ hook
- **State:** .foundation/investigations/skill-routing-ignored.json @ 970938b5a22ccb47bca2f8e909c2a55c1af13de347ffdd65c4cf3720d7b4bbe2
- **Sources:** sha256:f674d66bdc8faccda9a79492519399de669ccc70c9a035d92cab53118324713f

เป้าหมาย: ให้ skill ที่ harness เลือกถูกโหลดจริงระหว่าง Build

ผลลัพธ์ที่ต้องการ: รู้สาเหตุที่ agent ไม่เรียก skill และวิธีแก้ที่วัดผลได้

### ขอบเขตและผู้เกี่ยวข้อง

- advance EDIT skills
- .claude/commands/dev.md
- .claude/commands/build.md
- user
- agent
- harness

### ความครบของ requirement

| Source | Requirement | สถานะ | Targets | รายละเอียด |
|---|---|---|---|---|
| find-cause@1 | สืบว่าทำไม agent ไม่เรียก skill ที่ Build สั่ง และแก้ไข | behavior / stated / user | requirement: no-skill-routing | — |
| better-descriptions@1 | เขียน description ของ skill ให้ดีเพื่อให้ agent เรียกเอง | behavior / stated / user | requirement: spec-vocabulary-descriptions | — |
| no-hook@1 | ไม่ใช้ hook บังคับโหลด skill | constraint / stated / user | non-goal: ไม่ใช้ hook หรือการบังคับใดเพื่อโหลด skill | — |
| spec-aligned@1 | ออกแบบ skill ให้สอดคล้องกับ spec เพื่อให้ agent รู้เองว่าต้องเรียก skill อะไร | behavior / stated / user | requirement: spec-vocabulary-descriptions | — |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- poc-doc-contract [complete]: ถ้า dev.md และ build.md บอกให้โหลด skills ของ EDIT ก่อน agent จะเรียก skill ไหม และผลงานเป็นอย่างไร; criteria: 4 lane ที่ Build สั่ง skill หลายแบบ / claude-sonnet-5-5 ทีละ lane / เทียบกับรอบบน main 3eb57e95d; findings: เรียก skill ที่สั่ง 3 จาก 12 (เดิม 0 จาก 43): notes-api โหลดครบ 3 skill อีก 3 lane ไม่โหลดเลย / ทั้ง 4 lane อ่าน dev.md ฉบับแก้แล้ว แต่ 3 lane ยังเริ่มเขียนโค้ดทันทีหลัง EDIT / notes-api ที่โหลด skill: 146 → 173 วินาที, $0.58 → $0.68 (+18%) oracle 13/13 เท่าเดิม / ทุก lane archived และ oracle เต็ม; limitations: รันครั้งเดียวต่อ lane / ไม่ได้วัดคุณภาพที่ oracle ไม่ครอบ เช่นการออกแบบหรือความครบของ test; refs: find-cause@1
- eval-descriptions [complete]: description ที่ขึ้นต้นด้วยจังหวะที่ควรเรียก ทำให้ agent เรียก skill เองบ่อยขึ้นไหม; criteria: 5 skill, 8 โจทย์ (6 ควรเรียก รวมภาษาไทย 1, 2 ไม่ควรเรียก) / 2 รอบต่อโจทย์ต่อชุด / claude-sonnet-5-5 ใน fixture ชั่วคราว ไม่แก้ skill จริง; findings: เรียก skill ที่ถูก: เดิม 1/12, ใหม่ 4/12 / api-design: เดิม 1/2 ใหม่ 2/2; security: เดิม 0/2 ใหม่ 2/2 / testing, database, debug และโจทย์ภาษาไทย: 0/2 ทั้งสองชุด / เรียกผิดโจทย์ 0 ครั้งทั้งสองชุด / ค่าใช้จ่ายรวม $4.34 ($2.19 เดิม, $2.15 ใหม่); limitations: 2 รอบต่อโจทย์ ความแปรปรวนยังสูง / fixture มี skill ระดับผู้ใช้ปนอยู่ (53 skill ใน session) / วัดเฉพาะการเรียก skill ไม่ได้วัดคุณภาพงาน; refs: find-cause@1
- eval-spec-aligned [complete]: description ที่ใช้คำของ spec และ task ที่ระบุ skill ทำให้ agent เรียก skill เองถูกไหม; criteria: change packet จริงขนาดเล็กต่อโจทย์ (proposal, spec, tasks) / 3 แบบ: old, spec, spec-task; 2 รอบต่อโจทย์ / 8 โจทย์: 5 เรื่อง, 2 ไม่ควรเรียก, 1 ภาษาไทย; findings: old: เรียกถูก 0/12 / spec (description ใช้คำของ spec): 2/12 / spec-task (description ใหม่ + task ระบุ skill): 12/12 และโหลดก่อนแก้โค้ด 12/12 / เรียกผิดโจทย์ 0 ทั้ง 3 แบบ; โจทย์ไม่ควรเรียกไม่เรียกเลย / ค่าใช้จ่าย $2.38, $2.37, $2.44 (+2.5% สำหรับ spec-task); เวลาเฉลี่ย 21, 19, 19 วินาที; limitations: 2 รอบต่อโจทย์ / fixture มี skill ระดับผู้ใช้ปนอยู่ / จำกัด 6 turn ต่อรอบ ไม่ใช่ lifecycle เต็ม / ยังไม่ได้วัดคุณภาพงาน; refs: spec-aligned@1

### สาระจากบทสนทนา

- u-skill [user]: investigate agent ไม่เรียก skill ที่ว่า เกิดอะไรขึ้น แก้ไขยัง (session message)
- u-desc [user]: เขียน description ให้ดีเพื่อให้ agent เรียก skill เองดีไหม (session message)
- u-nohook [user]: ไม่อยากให้ใช้ hook เพราะบังคับเกินไป อยากออกแบบ skill ให้สอดคล้องกับ spec agent ควรรู้เองว่าต้องเรียก skill อะไร (session message)
- u-go [user]: ตามนี้เลยและทดสอบด้วยว่าดีไหม (session message)

### ช่องว่างของประวัติ

- ตัวเลขมาจาก raw bench ที่ git ไม่เก็บ (.claude/tests/bench/results/openspec-native-lab) วิเคราะห์ด้วยสคริปต์นอก repo

## Amendment removed requirements

Reason: paid lane ใน lifecycle เต็ม: ชื่อ skill ใน task ของ EDIT ถูกข้าม 0/10 และ 0/9 และเมื่อ agent เลือก skill เองใน draft เรียกจริง 1/9 ผู้ใช้เลือกเก็บ description ใหม่และเอาระบบสั่ง skill ออก

| Requirement | Migration |
|---|---|
| skills-in-task | แทนด้วย no-skill-routing: Build EDIT ไม่ระบุ skill อีก agent เลือกเองจาก description |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for skills-in-task, spec-vocabulary-descriptions.

## ภาคผนวก: ประวัติการแก้ไข

- Revision 1 (2026-10-17): paid lane ใน lifecycle เต็ม: ชื่อ skill ใน task ของ EDIT ถูกข้าม 0/10 และ 0/9 และเมื่อ agent เลือก skill เองใน draft เรียกจริง 1/9 ผู้ใช้เลือกเก็บ description ใหม่และเอาระบบสั่ง skill ออก
- Revision 2 (2026-10-17): living spec build-skill-routing ยังมี requirement ที่ให้ EDIT ระบุ skill ซึ่งขัดกับ no-skill-routing ที่ผู้ใช้อนุมัติ

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 2 | stale-skilledit-comment: The comment above the skillEdit helper still says 'A Build EDIT names skills from typed change data and the project's installed skills'. That is the reverse of the new no-skill-routing behaviour, and the comment should be updated. (root/.claude/harness/tests/advance-runtime.test.mjs:1117) | minor | ยังเปิดอยู่ | claude-opus |
| 2 | task-instruction-assertion-narrow: The scenario says no skill name may appear in any task instruction. The test only rejects the literal 'skills:' in task.instruction, and it never compares tasks against the plain run without a project root. A regression that put a bare skill name such as `debug-fundamentals` into a task would still pass. A stronger check would assert that no ALL_SKILLS name appears in any task.instruction. This is not blocking, because the routing code is gone entirely. (root/.claude/harness/tests/advance-runtime.test.mjs:1171) | minor | ยังเปิดอยู่ | claude-opus |
