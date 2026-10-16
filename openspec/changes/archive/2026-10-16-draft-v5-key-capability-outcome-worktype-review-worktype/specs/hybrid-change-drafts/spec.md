# hybrid-change-drafts

## ADDED Requirements

### Requirement: v5-keyed-defaults

ระบบ SHALL เติม capability และ outcome ให้ requirement ของ draft version 5 ที่ไม่ได้ระบุเอง เหมือน draft ที่ไม่มี version แม้ requirement หรือ task จะมี key

#### Scenario: draft v5 ที่มี key

- **GIVEN** draft version 5 ที่ requirement และ task มี key แต่ไม่มี capability และ outcome
- **WHEN** agent รัน change start
- **THEN** harness เติม capability และ outcome และไม่คืน error ว่า capability หรือ outcome is required

#### Scenario: draft v5 แบบเต็มคงเดิม

- **GIVEN** draft version 5 ที่มี claims หรือ specs
- **WHEN** agent รัน change start
- **THEN** harness ตรวจเป็น draft แบบเต็มเหมือนเดิมและไม่เติมค่าแทน
