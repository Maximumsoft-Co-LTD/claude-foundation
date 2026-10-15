# prove

## ADDED Requirements

### Requirement: A gate pass another process recorded is not no progress

ระบบ SHALL ไม่ประกาศ no-progress เมื่อ proof cursor ถูกเขียนโดย gate pass อื่นหลังจากที่ advance ตัดสินใจรัน proof

#### Scenario: cursor เปลี่ยนหลังตัดสินใจ

- **GIVEN** advance B อ่าน cursor token ก่อนที่ advance A จะรัน gate ที่ fail จบ
- **WHEN** B รัน gate บนหลักฐานเดิม
- **THEN** ผลเป็น ACTION_REQUIRED ไม่ใช่ NO_PROGRESS_DECISION

#### Scenario: ไม่มี pass อื่นแทรก

- **GIVEN** token ตรงกับ cursor ปัจจุบัน
- **WHEN** gate fail ด้วย findings และ fingerprint เดิม
- **THEN** ยังได้ NO_PROGRESS_DECISION ตามเดิม

#### Scenario: advance ส่ง token

- **WHEN** advance เรียก proof ด้วย RUN_PROOF
- **THEN** proof ได้ cursor token ที่อ่านตอนตัดสินใจ

### Requirement: A transient proof-lock owner is still working

ระบบ SHALL รายงาน WORKING เมื่อ proof lock ถูกถือแต่ owner ยังอ่านไม่ได้หรือกำลัง initialize ภายในช่วง grace

#### Scenario: owner เป็น null

- **GIVEN** proof advance คืน IN_PROGRESS และ owner null
- **WHEN** advance แปลงผล
- **THEN** ได้ WORKING

#### Scenario: owner กำลัง initialize

- **GIVEN** owner state initializing และ recoverableAfter ยังไม่ถึง
- **WHEN** advance แปลงผล
- **THEN** ได้ WORKING

#### Scenario: owner ตายแล้ว

- **GIVEN** owner มี pid ของ process ที่ไม่มีชีวิต
- **WHEN** advance แปลงผล
- **THEN** ยังได้ REPAIR_PROOF_LOCK
