# sandbox

## ADDED Requirements

### Requirement: carry-landed-work

ระบบ SHALL นำเนื้อหาของไฟล์ที่ change อื่น Land แล้วแต่ยังไม่ commit ใน target เข้า sandbox ของ change ใหม่ตอนสร้างและตอน sync และ SHALL รายงาน path ที่นำเข้า

#### Scenario: change ที่ต่อกัน

- **GIVEN** change A Land ไฟล์ src/a.js แล้วยังไม่ commit
- **WHEN** agent เริ่ม Build ของ change B
- **THEN** sandbox ของ B มี src/a.js ตามที่ A Land และ output ระบุว่านำ src/a.js เข้ามา

#### Scenario: ไฟล์ที่ผู้ใช้แก้เองไม่ถูกนำเข้า

- **GIVEN** target มีไฟล์ที่ผู้ใช้แก้เองโดยไม่ได้มาจาก change ใด
- **WHEN** agent เริ่ม Build ของ change ใหม่
- **THEN** ไฟล์นั้นไม่ถูกนำเข้า sandbox เหมือนเดิม

#### Scenario: Land ของ B ไม่ทับงาน A

- **GIVEN** B ไม่ได้แก้ src/a.js
- **WHEN** B Land
- **THEN** src/a.js ใน target เหมือนที่ A Land
