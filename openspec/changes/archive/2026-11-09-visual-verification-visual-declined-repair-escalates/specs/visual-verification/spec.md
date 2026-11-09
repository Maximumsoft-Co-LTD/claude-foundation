# visual-verification

## ADDED Requirements

### Requirement: visual-declined-repair-escalates

ระบบ SHALL บันทึก visual drift แทนการส่ง repair ซ้ำเมื่อ resume หลัง repair ของ visual โดย workspace ไม่เปลี่ยน

- repair ของ visual บอก agent ว่าถ้าความต่างขัดกับ agreement ให้ resume โดยไม่แก้เพื่อส่งให้ผู้ใช้ตัดสิน

#### Scenario: agent ไม่แก้

- **GIVEN** visual fail และระบบส่ง repair รอบที่ 1 แล้ว
- **WHEN** resume โดย workspace hash เท่ากับตอนส่ง repair
- **THEN** ไม่มี repair ของ visual ซ้ำ และ drift ถูกบันทึกพร้อม finding เดิม
- **AND** gate อื่นยังรันต่อ

#### Scenario: agent แก้แล้วยังต่าง

- **GIVEN** visual fail หลัง repair รอบที่ 1 และ workspace เปลี่ยน
- **WHEN** Prove รอบถัดไป
- **THEN** ระบบส่ง repair รอบที่ 2 ตามเดิม

#### Scenario: ไม่มี repair ของ visual ก่อนหน้า

- **GIVEN** visual fail ครั้งแรกและยังไม่เคยส่ง repair ของ visual
- **WHEN** Prove รัน
- **THEN** ระบบส่ง repair รอบที่ 1 ไม่บันทึก drift

#### Scenario: ครบ 2 รอบ

- **GIVEN** ซ่อมครบ 2 รอบที่ workspace เปลี่ยนทุกรอบและยังต่าง
- **WHEN** Prove รอบถัดไป
- **THEN** drift ถูกบันทึกเหมือนเดิม
