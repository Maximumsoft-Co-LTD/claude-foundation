# review-policy

## ADDED Requirements

### Requirement: worktype-no-tier

ระบบ SHALL ไม่ใช้ capability ที่ถูกบังคับเพราะ workType อย่างเดียวในการยกระดับ review และ SHALL ยังบังคับหลักฐานของ capability นั้นครบ

#### Scenario: api ที่ไม่มี risk อื่น

- **GIVEN** change ประกาศ workType api และ path ที่แก้ไม่บังคับ compatibility
- **WHEN** harness คำนวณนโยบาย review
- **THEN** ระดับ review ไม่มี trigger critical-capability หรือ risk-capability จาก compatibility และ compatibility ยังเป็นหลักฐานที่ต้องมี

#### Scenario: path บังคับ compatibility

- **GIVEN** path ที่แก้บังคับ compatibility ด้วย
- **WHEN** harness คำนวณนโยบาย review
- **THEN** compatibility ยังยกระดับ review เหมือนเดิม
