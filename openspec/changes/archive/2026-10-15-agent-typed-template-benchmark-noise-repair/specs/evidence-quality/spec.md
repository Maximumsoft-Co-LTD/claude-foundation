# คุณภาพหลักฐาน

benchmark ยืนยัน regression ก่อน repair

## ADDED Requirements

### Requirement: Benchmark regression is confirmed before repair

ระบบ SHALL วัด benchmark ยืนยันหนึ่งครั้งด้วยจำนวน runs สองเท่าก่อนตัดสินว่า regression

#### Scenario: regression จริงได้ REPAIR

- **GIVEN** head ช้ากว่า base 25% ทั้งการวัดแรกและการวัดยืนยัน
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression
- **AND** receipt มี confirmation ที่ใช้ runs สองเท่า

#### Scenario: noise ครั้งเดียวผ่าน

- **GIVEN** การวัดแรก regressed แต่การวัดยืนยันไม่ regressed
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed และเก็บผลการวัดแรกไว้

#### Scenario: ไม่ regressed ไม่วัดซ้ำ

- **GIVEN** การวัดแรกไม่ regressed
- **WHEN** Prove รัน provider
- **THEN** ไม่มี confirmation และจำนวน run เท่า runs
