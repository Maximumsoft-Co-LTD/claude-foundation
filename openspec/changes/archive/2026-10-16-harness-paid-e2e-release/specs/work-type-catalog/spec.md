# work-type-catalog

## ADDED Requirements

### Requirement: work-type-signals

ระบบ SHALL คืน EDIT ที่ระบุ workType ที่ขาด เมื่อ draft ประกาศ workType แต่ไม่มี type ที่สัญญาณ typed บังคับ ได้แก่ integrations หรือ riskSignals external-integration บังคับ integration และ performance-slo บังคับ performance

#### Scenario: integration ที่ประกาศเป็น feature

- **GIVEN** draft ประกาศ workType feature และ riskSignals external-integration
- **WHEN** agent รัน change start
- **THEN** harness คืน EDIT ให้เพิ่ม workType integration โดยไม่เริ่ม change

#### Scenario: ประกาศถูกแล้วผ่าน

- **GIVEN** draft ประกาศ workType integration พร้อม block integrations
- **WHEN** agent รัน change start
- **THEN** ไม่มี EDIT เรื่อง workType

#### Scenario: ไม่ประกาศ workType ใช้การเดาเดิม

- **GIVEN** draft ไม่มี workType
- **WHEN** agent รัน change start
- **THEN** harness เดา workType จาก path เหมือนเดิมและไม่คืน EDIT เรื่องนี้
