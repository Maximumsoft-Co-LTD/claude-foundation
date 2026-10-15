# แนวทางใน skill

## Purpose

ขั้นตอนที่ตรวจได้จาก pstack ใน reference ของ owner skill โดยไม่ขัดกฎเดิมและไม่เกิน budget

## ADDED Requirements

### Requirement: Performance work has a bounded hillclimb procedure

ระบบ SHALL ให้ performance-investigation มี reference hillclimb ที่กำหนด stop predicate, การพิสูจน์ความไวของ harness ก่อน freeze, attempt log และการเปลี่ยนทางเมื่อถึง plateau

- stop predicate = target คู่กับจำนวน attempt ขั้นต่ำ หรือ plateau ที่ยืนยันแล้ว
- ก่อนเริ่มต้องพิสูจน์ว่า harness แยก workload ที่ต่างกันได้ แล้ว freeze ไม่แก้ harness ระหว่าง hillclimb
- ทุก hypothesis ต้องระบุกลไก และไล่ตามลำดับ mantra จากถูกไปแพง
- keep หรือ revert แต่ละ attempt ด้วยการแก้ workspace และเก็บ log เป็น raw run นอก managed skills ไม่ใช้ commit
- การอ้าง improvement สุดท้ายใช้ benchmark provider หรือ project tool ผ่าน harness และ paid workload ต้องมี authority

#### Scenario: reference มีขั้นตอนครบ

- **WHEN** อ่าน performance-investigation/references/hillclimb.md
- **THEN** มี stop predicate, harness sensitivity และ freeze, attempt log, plateau pivot และ mantra order

#### Scenario: เข้าถึงได้จาก reference เดิม

- **WHEN** reference governance ตรวจ bundle performance-investigation
- **THEN** hillclimb.md reachable จาก measurement.md โดย SKILL.md ไม่เพิ่มคำ

#### Scenario: ไม่สั่ง commit ต่อ attempt

- **GIVEN** เนื้อหามีคำสั่ง commit ต่อ attempt หรือ status ledger
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้าม fail

### Requirement: Performance claims explain the number

ระบบ SHALL ให้ measurement.md กำหนดให้เขียนประโยค claim ก่อนวัด ถามว่าทำไมไม่เป็นสองเท่า และตัดสิน inconclusive เมื่อไม่รู้ limiter

#### Scenario: มีกฎ claim

- **WHEN** อ่าน measurement.md
- **THEN** มีขั้นเขียน claim ก่อนวัด, why-not-double และ inconclusive เมื่อ limiter ไม่มีชื่อ

#### Scenario: pin เดิมคงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** /returned Build/, /Never fabricate missing measurements/ และ not a status ledger ยังผ่าน

### Requirement: Debugging stops guessing and repairs the root cause

ระบบ SHALL ให้ debug-fundamentals มี reference root-cause ที่หยุดการแก้ต่อหลังแก้ล้มซ้ำสองครั้งจนกว่าจะเขียนและทดสอบ premise และตรวจความชอบธรรมของ guard

- trigger: แก้ล้มสองครั้งบน gate เดียวกัน ต้องเขียน premise และ experiment ที่ falsify ได้ก่อนแก้ต่อ
- guard เป็นการแก้ได้ก็ต่อเมื่อ state ที่มันรับมือนั้นชอบธรรม; การลบ guard ยังต้องพิสูจน์ตาม coding-discipline
- instance อื่นของ pattern เดียวกันที่อยู่นอกขอบเขตของ change ให้รายงานเป็น follow-up ไม่รวมเป็น cleanup

#### Scenario: มี stop rule

- **WHEN** อ่าน debug-fundamentals/references/root-cause.md
- **THEN** มี trigger แก้ล้มสองครั้งและข้อกำหนดเขียน premise ก่อนแก้ต่อ

#### Scenario: ไม่ขัด no bundled cleanup

- **GIVEN** เนื้อหาสั่งให้แก้ทุก instance ทั่ว repo โดยไม่จำกัดขอบเขต
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test fail เพราะไม่มีข้อความจำกัดขอบเขตและ follow-up

#### Scenario: pin bisection คงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** bisection.md ยังตรง /never the active target or Build workspace/

### Requirement: Tests are judged against behavior and internal edits

ระบบ SHALL ให้ test-design.md มีการทดสอบ test ด้วยการแก้สองแบบในใจและรายการสาเหตุของ hollow assertion

- การแก้สองแบบ: break the behavior ต้องทำให้ test fail; change the internals ต้องไม่ทำให้ test fail
- hollow assertion: ค่าคาดหวังคำนวณจากโค้ดที่ทดสอบ, ค่าคงที่ที่ทวนซ้ำ, assertion แบบไม่มีการเรียกที่ไม่มี positive case คู่กัน
- การทำ effect ซ้ำสองครั้งเป็น mutation ที่ใช้ตรวจ idempotent behavior
- ถ้าไฟล์เกิน 300 บรรทัดต้องมี ## Contents ที่ลิงก์ได้

#### Scenario: มีสองการแก้และ hollow assertion

- **WHEN** อ่าน test-design.md
- **THEN** มี break the behavior, change the internals และรายการ hollow assertion

#### Scenario: ไม่ซ้ำกับ programming-fundamentals testing

- **WHEN** reference governance ตรวจ duplicate
- **THEN** ไม่มีย่อหน้าซ้ำหรือใกล้เคียง (Jaccard ≥ 0.92) กับ programming-fundamentals/references/testing.md

### Requirement: Impact claims state how far safety was proven

ระบบ SHALL ให้ change-impact-analysis มี reference proof ladder ห้าระดับและข้อกำหนดระบุ load-bearing safety fact

- ladder: คำบอก, อ่านโค้ด, ค้นหา consumer, รันจริงผ่าน project tool, ทำซ้ำในแอปที่รันอยู่
- รายงานต้องบอกว่าหยุดที่ระดับใด ไม่เรียก cleared จากระดับที่ต่ำกว่า
- การรันจริงเป็นหลักฐานได้ต่อเมื่อผ่าน provider ของ harness ไม่ใช่คำอ้าง
- SKILL.md ได้ลิงก์หนึ่งบรรทัดไม่เกิน 12 คำ

#### Scenario: มี ladder

- **WHEN** อ่าน change-impact-analysis/references/proof-ladder.md
- **THEN** มีห้าระดับ, say where it stopped และ load-bearing safety fact

#### Scenario: pin เดิมคงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** SKILL.md ยังตรง /OpenSpec/, /not receipts/ และ /never hand-edit/

### Requirement: Operations answer the rerun and crash questions

ระบบ SHALL ให้ Principle 5 ใน shared-state-and-async.md มีสามคำถาม idempotency และกฎเขียนไฟล์ชั่วคราวแล้ว rename

- สามคำถาม: รันซ้ำแล้วเกิดอะไร, run ก่อนหน้า crash กลางทางแล้วเกิดอะไร, สอง run พร้อมกันแล้วเกิดอะไร
- derive แต่ละขั้นจาก state ปัจจุบัน, เขียน temp แล้ว rename, ตัดสิน staleness จากหลักฐานที่ถูกต้องทุกจุด crash
- queue-fundamentals/references/idempotency.md ลิงก์มาที่ Principle 5 แทนการคัดลอก

#### Scenario: มีสามคำถาม

- **WHEN** อ่าน shared-state-and-async.md Principle 5
- **THEN** มีสามคำถามและกฎ temp แล้ว rename

#### Scenario: Contents ยังลิงก์ได้

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** ## Contents ของ shared-state-and-async.md ยัง resolve ทุก anchor

### Requirement: Recurring lessons become the strongest workable check

ระบบ SHALL ให้ coding-discipline/references/details.md มี enforcement ladder และข้อกำหนดว่า check ใหม่ต้อง fail บนกรณีจริงในอดีต

- ladder: architecture, type, lint ที่ error บอกวิธีแก้, test, เอกสารเป็นทางเลือกสุดท้าย
- check ใหม่ต้อง fail บน occurrence จริงในอดีต โดยใช้ base-tree ของ tests that fail without the change
- การนำ check เข้าทำผ่าน /change ปกติ ไม่มี commit แยก
- การเขียนคำสั่งเดิมซ้ำเป็นครั้งที่สองคือ trigger ให้พิจารณา check แทน prose

#### Scenario: มี ladder

- **WHEN** อ่าน coding-discipline/references/details.md
- **THEN** มีลำดับ architecture, type, lint, test, docs และ fail-on-past-case

#### Scenario: ไม่สั่ง commit แยก

- **GIVEN** เนื้อหามี one commit each หรือ separate commit
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้าม fail

### Requirement: Repeated work builds a lever and domain models show skip signals

ระบบ SHALL ให้ details.md มีกฎ build-the-lever และ module-design.md มี skip signal ของ domain model และการทดสอบผู้อ่าน 30 วินาที

#### Scenario: มี lever และ skip signals

- **WHEN** อ่าน details.md และ module-design.md
- **THEN** มี build-the-lever, one more branch, synchronized boolean และ 30-second reader test

#### Scenario: pin programming-fundamentals คงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** SKILL.md ยังมี Design deep, cohesive modules และ references/module-design.md

### Requirement: Prose deliverables follow one writing reference

ระบบ SHALL ให้ init-project-docs/references/writing.md เป็นแนวทางการเขียนเดียวที่มีการเลือกรูปแบบเอกสารแบบ Diátaxis และ catalog รูปแบบภาษาแบบ AI พร้อมตัวอย่างก่อนและหลัง

- ลิงก์จาก init-project-docs/references/documentation-workflow.md, git-workflow/references/commit-messages.md, git-workflow/references/pull-requests.md, harness-html-report/references/report.md และ claude-md/references/guide-workflow.md
- ห้ามแก้ข้อความที่ผู้ใช้ quote, หัวข้อหรือ marker ที่ parser ต้องการ (Requirement:, Scenario:, WHEN/THEN/SHALL) และภาษาของเอกสารที่ผู้ใช้กำหนด
- การเขียน commit message หรือ PR ไม่ให้สิทธิ์ commit หรือเปิด PR

#### Scenario: มี Diátaxis และ catalog

- **WHEN** อ่าน writing.md
- **THEN** มีการเลือก tutorial/how-to/reference/explanation, catalog รูปแบบภาษา และตัวอย่างก่อนหลัง

#### Scenario: เข้าถึงได้ทุก bundle ที่เขียน prose

- **WHEN** reference governance ตรวจ
- **THEN** writing.md reachable จาก init-project-docs และลิงก์ข้าม bundle ทั้งห้า resolve

#### Scenario: ไม่ทำลาย marker ของ parser

- **GIVEN** writing.md สั่งให้เขียนหัวข้อ Requirement หรือ Scenario ใหม่
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test fail เพราะไม่มีข้อความคุ้มครอง parser marker

### Requirement: New skill guidance is guarded against contradicting existing contracts

ระบบ SHALL มี test ที่ตรวจไฟล์ reference ทุกไฟล์ที่ change นี้เพิ่มหรือแก้ว่าไม่มีคำสั่งที่ขัดกับกฎเดิม และ pstack-adoption.md บันทึก review ของ commit e5136d8

- รายการคำต้องห้ามรวม: commit per/each attempt, one commit each, open a PR, push, merge to, spawn, fan out to models, without asking, proceed without approval, delete the old API immediately
- ข้อความปฏิเสธที่มีอยู่แล้ว (เช่น Land never commits) ไม่นับเป็นการละเมิด: test ตรวจเฉพาะเนื้อหาที่ change นี้เพิ่ม
- pstack-adoption.md เพิ่ม provenance ของ e5136d8 และ Verification boundary bullets ที่ลิงก์ reference ใหม่ โดยตาราง Disposition ยังมี 58 แถว

#### Scenario: เนื้อหาสะอาด

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้ามผ่านทุกไฟล์ใหม่และที่แก้

#### Scenario: คำต้องห้ามถูกจับ

- **GIVEN** ไฟล์ใหม่มีคำว่า open a PR
- **WHEN** รัน test
- **THEN** test fail ระบุไฟล์และคำ

#### Scenario: ตาราง adoption ไม่เปลี่ยน

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** ตาราง Disposition ยังมี 58 แถวและ provenance มีทั้ง 5062f28 และ e5136d8

### Requirement: Skill bodies stay within the context budget

ระบบ SHALL คง SKILL.md ทุกไฟล์ไม่เกิน 700 คำและรวมไม่เกิน 9500 คำ โดย change นี้เพิ่มรวมไม่เกิน 12 คำ

#### Scenario: budget ผ่าน

- **WHEN** รัน run-context-budget-tests.sh
- **THEN** ทุก assertion ผ่าน

#### Scenario: เกิน budget

- **GIVEN** SKILL.md รวมเกิน 9500 คำ
- **WHEN** รัน budget test
- **THEN** test คืน CONTEXT_BUDGET_USER_DECISION_REQUIRED
