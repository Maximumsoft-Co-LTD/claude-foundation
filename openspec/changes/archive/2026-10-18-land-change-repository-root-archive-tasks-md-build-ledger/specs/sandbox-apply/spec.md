# sandbox-apply

## ADDED Requirements

### Requirement: child-only-ledger

เมื่อ Land change แบบหลาย repository ที่ไม่มี root เป็น repository ที่เขียนได้ ระบบ SHALL นำ task ที่ติ๊กใน tasks.md ของ sandbox กลับเข้า tasks.md ของ packet ใน root ก่อน archive โดยไม่เปลี่ยนบรรทัดอื่นของ packet

#### Scenario: ทุก task เสร็จ

- **GIVEN** change เลือกเฉพาะ repository ลูก และ Build ติ๊ก T001–T003 ใน tasks.md ของ sandbox
- **WHEN** Land apply ก่อน archive
- **THEN** tasks.md ใน root แสดง T001–T003 เป็น [x]

#### Scenario: บรรทัดอื่นไม่เปลี่ยน

- **GIVEN** tasks.md ใน root มีข้อความหรือ task ที่ sandbox ไม่ได้ติ๊ก
- **WHEN** Land apply ก่อน archive
- **THEN** บรรทัดเหล่านั้นคงเดิมทุก byte และมีแค่ task ที่ sandbox ติ๊กที่เปลี่ยนเป็น [x]

#### Scenario: มี root

- **GIVEN** change เลือก root เป็น repository ที่เขียนได้
- **WHEN** Land apply
- **THEN** ระบบใช้ projection ของ root ตามเดิมและไม่ merge tasks.md ซ้ำ
