# sandbox

## ADDED Requirements

### Requirement: landed-carry-no-false-conflict

ระบบ SHALL ไม่ merge งานที่ Land แล้วซ้ำเข้า path ที่ sandbox คัดลอกมาจากงานนั้นตราบที่ target ยังเป็น bytes เดียวกับตอนคัดลอก

#### Scenario: แก้ต่อจากงานที่คัดลอกมา

- **GIVEN** sandbox คัดลอกไฟล์ที่ change ก่อน Land ไว้ และ change นี้แก้บรรทัดติดกับงานนั้น
- **WHEN** advance sync งานที่ Land แล้วเข้า sandbox
- **THEN** ไม่มี conflict และไฟล์ใน sandbox ไม่ถูกเขียนทับ
- **AND** Land ยอมรับ path นั้นโดยไม่ต้องแก้เพิ่ม

#### Scenario: target เปลี่ยนหลังคัดลอก

- **GIVEN** sandbox คัดลอกไฟล์ที่ Land แล้ว และ target ของไฟล์นั้นเปลี่ยนอีกหลังคัดลอก
- **WHEN** advance sync
- **THEN** ระบบ merge และรายงาน conflict ตามพฤติกรรมเดิม

#### Scenario: path ที่ไม่ได้คัดลอก

- **GIVEN** sandbox เริ่มจาก base และแก้บรรทัดเดียวกับงานที่ Land แล้ว
- **WHEN** advance sync
- **THEN** ระบบรายงาน conflict ตามพฤติกรรมเดิม
