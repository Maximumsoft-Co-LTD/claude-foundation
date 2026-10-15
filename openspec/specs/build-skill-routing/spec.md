# build-skill-routing Specification

## Purpose
Build action ระบุ skill จากข้อมูล typed และ bench วัดการโหลดจริง
## Requirements
### Requirement: Build actions name the skills the work needs

ระบบ SHALL เพิ่ม field skills และคำสั่งโหลด skill ตามชื่อใน EDIT action ของ Build เมื่อข้อมูล typed ของ change ตรงกับ mapping

- mapping: workType bugfix → debug-fundamentals; refactor → refactoring-fundamentals; api → api-design-fundamentals; async → queue-fundamentals; data → database-fundamentals; ui → ux-ui-principles
- riskSignals: performance-slo → performance-investigation; persisted-data-change → database-fundamentals; access-control หรือ securityTriggers ใด ๆ → security-fundamentals; input-domain → testing-fundamentals; external-integration → api-design-fundamentals; financial → queue-fundamentals; user-interface → ux-ui-principles; high-operational-risk → observability-fundamentals
- งาน behavior (workType ที่ไม่ใช่ docs, chore, config) เพิ่ม testing-fundamentals
- เรียงตามลำดับคงที่ของ mapping, ตัดซ้ำ, cap 4, กรองเฉพาะ skill ที่มี .claude/skills/<name>/SKILL.md
- คำสั่งเป็นบรรทัดแรกของ instructions: First, load these skills by name: <names>. Read a skill reference only when its decision is active.

#### Scenario: bugfix ได้ debug และ testing

- **GIVEN** change มี workType bugfix และไม่มี riskSignals
- **WHEN** advance คืน EDIT
- **THEN** skills เท่ากับ debug-fundamentals และ testing-fundamentals
- **AND** บรรทัดแรกของ instructions คือ First, load these skills by name

#### Scenario: performance-slo ได้ performance-investigation

- **GIVEN** change มี riskSignals performance-slo และ workType feature
- **WHEN** advance คืน EDIT
- **THEN** skills มี performance-investigation และ testing-fundamentals

#### Scenario: access-control ได้ security

- **GIVEN** change มี riskSignals access-control
- **WHEN** advance คืน EDIT
- **THEN** skills มี security-fundamentals

#### Scenario: งานเอกสารไม่มี skill

- **GIVEN** change มีเฉพาะ workType docs และไม่มี riskSignals
- **WHEN** advance คืน EDIT
- **THEN** action ไม่มี field skills และ instructions เหมือนเดิม

#### Scenario: cap 4

- **GIVEN** change มี workType bugfix, api, data และ riskSignals access-control, performance-slo
- **WHEN** advance คืน EDIT
- **THEN** skills มีไม่เกิน 4 ตัวตามลำดับคงที่

#### Scenario: prose ไม่มีผล

- **GIVEN** intent มีคำว่า payment และ slow แต่ไม่มี riskSignals
- **WHEN** advance คืน EDIT
- **THEN** skills ไม่มี queue-fundamentals หรือ performance-investigation

#### Scenario: skill ที่ไม่มีในโปรเจกต์ถูกกรอง

- **GIVEN** โปรเจกต์ไม่มี .claude/skills/debug-fundamentals/SKILL.md
- **WHEN** advance คืน EDIT ของ bugfix
- **THEN** skills ไม่มี debug-fundamentals และ action ยังทำงานต่อได้

#### Scenario: input-domain ได้ testing ไม่ใช่ security

- **GIVEN** change มี riskSignals input-domain และไม่มี access-control หรือ securityTriggers
- **WHEN** advance คืน EDIT
- **THEN** skills มี testing-fundamentals และไม่มี security-fundamentals

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
