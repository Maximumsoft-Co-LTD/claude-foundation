# นโยบาย review

financial เลือก review สูง และ finding มี code ที่จัดกลุ่มได้

## ADDED Requirements

### Requirement: Financial risk signal selects high review

ระบบ SHALL เลือก review tier high เมื่อ change ประกาศ riskSignals financial

#### Scenario: financial ได้ high

- **GIVEN** change มี riskSignals financial และ intent ไม่มีคำเกี่ยวกับเงิน
- **WHEN** harness คำนวณ review tier
- **THEN** tier เป็น high และ triggers มี financial

#### Scenario: ไม่มี signal คงพฤติกรรมเดิม

- **GIVEN** change ไม่มี riskSignals
- **WHEN** harness คำนวณ review tier
- **THEN** tier เท่ากับผลก่อน change นี้

### Requirement: Review findings may carry a stable code

ระบบ SHALL เก็บ field code ของ review finding เมื่อเป็น kebab-case ไม่เกิน 64 ตัวอักษร

#### Scenario: code ถูกเก็บ

- **GIVEN** review result มี finding code missing-authz
- **WHEN** harness บันทึก review attempt
- **THEN** finding ที่ normalize แล้วมี code missing-authz

#### Scenario: code ผิดรูปแบบไม่ block

- **GIVEN** finding code เป็น Missing Authz!
- **WHEN** harness บันทึก review attempt
- **THEN** attempt ถูกบันทึกและ finding ไม่มี code

#### Scenario: ไม่มี code

- **GIVEN** finding ไม่มี code
- **WHEN** harness บันทึก review attempt
- **THEN** digest และ chain ของ attempt เหมือนพฤติกรรมเดิม
