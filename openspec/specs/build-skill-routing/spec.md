# build-skill-routing Specification

## Purpose
Build action ระบุ skill จากข้อมูล typed และ bench วัดการโหลดจริง
## Requirements
### Requirement: Benchmark scorecards record skill loading

ระบบ SHALL ให้ scorecard ของ bench มี skillUsage ที่นับการเรียก Skill tool, ชื่อ skill ที่โหลด และไฟล์ skill ที่ถูกอ่านจาก host stream

- skillToolCalls นับ tool_use ชื่อ Skill ที่ไม่ซ้ำ id; skillsLoaded เป็นรายชื่อ input.skill ที่ไม่ซ้ำเรียงแล้ว
- skillFilesRead เป็น path ของ Read ที่มี .claude/skills/ หรือ .agents/skills/ ตัดส่วนก่อน skills/
- ไม่มี stream: skillUsage มี measurement unavailable และค่าเป็น null ไม่ใช่ 0
- schema เพิ่ม skillUsage แบบ optional

#### Scenario: นับจาก stream

- **GIVEN** stream มี Skill tool_use สองครั้ง (debug-fundamentals ซ้ำหนึ่ง) และ Read ของ .claude/skills/debug-fundamentals/references/root-cause.md
- **WHEN** runner สร้าง scorecard
- **THEN** skillToolCalls เท่ากับ 2, skillsLoaded เท่ากับ [debug-fundamentals] และ skillFilesRead มี debug-fundamentals/references/root-cause.md

#### Scenario: ไม่มี stream

- **GIVEN** host output ไม่ใช่ stream-json
- **WHEN** runner สร้าง scorecard
- **THEN** skillUsage.measurement เป็น unavailable และค่าเป็น null

#### Scenario: scorecard เก่ายัง valid

- **GIVEN** scorecard ไม่มี skillUsage
- **WHEN** validate กับ schema
- **THEN** ผ่าน

### Requirement: spec-vocabulary-descriptions

ระบบ SHALL ให้ description ของ testing-fundamentals, database-fundamentals, api-design-fundamentals, security-fundamentals และ debug-fundamentals ระบุสัญญาณใน spec ที่ควรเรียก skill นั้น ได้แก่ workType, riskSignals, requirement หรือ scenario

#### Scenario: description อ้าง spec

- **GIVEN** SKILL.md ของ 5 skill
- **WHEN** ตรวจ frontmatter
- **THEN** description ของแต่ละ skill มีคำว่า workType, riskSignals, requirement หรือ scenario อย่างน้อยหนึ่งคำ และมีกรณี Skip

### Requirement: no-skill-routing

ระบบ SHALL ไม่ใส่ field skills คำสั่งโหลด skill หรือชื่อ skill ลงใน task ของ Build EDIT และปล่อยให้ agent เลือก skill เองจาก description

#### Scenario: EDIT ไม่ระบุ skill

- **GIVEN** change ที่ workType เป็น bugfix และโปรเจกต์มี debug-fundamentals และ testing-fundamentals
- **WHEN** harness คืน Build EDIT
- **THEN** action ไม่มี field skills และไม่มีชื่อ skill ใน instruction ของ task หรือใน instructions

### Requirement: aggregate-skill-usage

ระบบ SHALL รวม skillUsage ของ scorecard เป็นยอดต่อ scenario และ arm ใน aggregate โดยไม่นับ run ที่ไม่มี host stream เป็นศูนย์

- skillToolCalls เป็นผลรวมของ run ที่วัดได้, skillRuns เป็นจำนวน run ที่เรียก Skill อย่างน้อยหนึ่งครั้ง, skillsLoaded เป็นจำนวน run ต่อชื่อ skill
- measurements.skillUsage แยกจำนวน run ที่วัดได้กับวัดไม่ได้

#### Scenario: ผสมวัดได้และวัดไม่ได้

- **GIVEN** สาม run ใน scenario เดียว: วัดได้ 0 ครั้ง, วัดได้ 2 ครั้ง (testing-fundamentals, security-fundamentals) และไม่มี host stream
- **WHEN** รัน aggregate
- **THEN** skillToolCalls เท่ากับ 2, skillRuns เท่ากับ 1, skillsLoaded นับ skill ละ 1 และ measurements.skillUsage เท่ากับ measured 2 unavailable 1

#### Scenario: วัดได้แต่ไม่มีใครโหลด

- **GIVEN** ทุก run วัดได้และ skillToolCalls เป็น 0
- **WHEN** รัน aggregate
- **THEN** skillRuns เท่ากับ 0 ไม่ใช่ null

#### Scenario: ไม่มี host stream เลย

- **GIVEN** ทุก run ไม่มี skillUsage ที่วัดได้
- **WHEN** รัน aggregate
- **THEN** skillRuns และ skillsLoaded เป็น null ไม่ใช่ 0
