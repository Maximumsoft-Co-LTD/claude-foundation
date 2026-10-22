# build-skill-routing

## ADDED Requirements

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
