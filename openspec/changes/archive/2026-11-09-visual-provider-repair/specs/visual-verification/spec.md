# visual-verification

## ADDED Requirements

### Requirement: visual-multi-provider-one-round

ระบบ SHALL นับ visual provider ทุกตัวที่ไม่ผ่านใน Prove ครั้งเดียวกันเป็นรอบซ่อมเดียวและ batch เดียว

#### Scenario: สอง provider fail พร้อมกัน

- **GIVEN** visual provider desktop และ mobile fail ใน Prove ครั้งแรก
- **WHEN** Prove รัน
- **THEN** ได้ repair batch เดียวรอบที่ 1 ที่มี finding ของทั้งสอง provider
- **AND** ไม่มี drift ถูกบันทึก

#### Scenario: agent ไม่แก้ทั้งรอบ

- **GIVEN** ส่ง repair รอบที่ 1 ของสอง provider แล้ว
- **WHEN** resume โดย workspace ไม่เปลี่ยน
- **THEN** drift ถูกบันทึกพร้อม finding ของทั้งสอง provider และถามในคำถามเดียว

#### Scenario: ครบงบ

- **GIVEN** ซ่อมครบ 2 รอบแล้วและ provider ใด ๆ ยังต่าง
- **WHEN** Prove รอบถัดไป
- **THEN** drift ของทุก provider ที่ยังต่างถูกบันทึกในคำถามเดียว

#### Scenario: provider เดียว

- **GIVEN** มี visual provider เดียว
- **WHEN** Prove รัน
- **THEN** พฤติกรรมเหมือนเดิมทุกประการ

#### Scenario: state แบบเดิม

- **GIVEN** change ที่บันทึก visualRepair.drift แบบเดิมไว้แล้ว
- **WHEN** advance อ่านสถานะ
- **THEN** คำถามและ waiver ยังทำงานจาก drift เดิมได้
