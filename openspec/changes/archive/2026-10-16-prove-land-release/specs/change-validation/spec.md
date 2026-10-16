# change-validation

## ADDED Requirements

### Requirement: provider-config-approval

ระบบ SHALL ไม่นับ config ของ provider ใน execution.yaml และ evidence.yaml เป็นส่วนของการอนุมัติ spec ยกเว้นชื่อของ provider และ claim ของ evidence ซึ่งยังเป็นส่วนของการอนุมัติ

#### Scenario: แก้ timeoutMs

- **GIVEN** change ที่อนุมัติ spec แล้ว
- **WHEN** agent แก้ timeoutMs ของ provider test
- **THEN** การอนุมัติยังอยู่ และ receipt ของ provider test ต้องรันใหม่

#### Scenario: ถอด provider

- **GIVEN** change ที่อนุมัติ spec แล้ว
- **WHEN** agent ถอด provider test ออก
- **THEN** harness ขออนุมัติ spec ใหม่

#### Scenario: แก้ claim

- **GIVEN** change ที่อนุมัติ spec แล้ว
- **WHEN** agent แก้ capability ของ claim ใน evidence.yaml
- **THEN** harness ขออนุมัติ spec ใหม่
