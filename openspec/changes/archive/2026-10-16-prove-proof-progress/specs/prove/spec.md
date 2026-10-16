# prove

## ADDED Requirements

### Requirement: proof-progress

ระบบ SHALL ให้ advance ที่ถูกเรียกขณะ proof ของ change เดียวกันกำลังรัน คืน WORKING พร้อม progress ที่ระบุ provider ใน wave ปัจจุบัน provider ที่จบแล้วพร้อม status และเวลา และเวลาที่ proof รันมาแล้ว

#### Scenario: progress ระหว่างรัน

- **GIVEN** proof ของ change กำลังรัน provider test โดย discovery จบแล้ว
- **WHEN** agent รัน advance อีกครั้ง
- **THEN** ผลลัพธ์ WORKING มี progress ที่ระบุ test เป็น provider ที่กำลังรัน และเวลาที่ผ่านไปเป็นมิลลิวินาที

#### Scenario: provider ที่จบแล้ว

- **GIVEN** provider lint จบด้วย pass ใน wave แรก
- **WHEN** agent รัน advance ระหว่าง wave ที่สอง
- **THEN** progress ระบุ lint เป็น pass พร้อม durationMs

#### Scenario: สถานะเดิมไม่เปลี่ยน

- **GIVEN** proof ที่มี progress บันทึกไว้
- **WHEN** harness ตรวจ proof ที่ค้างหลัง process ตาย
- **THEN** status, stage และ workspaceHash ของ record เหมือนเดิมและการกู้คืนทำงานเหมือนเดิม

### Requirement: narrow-discrimination

ระบบ SHALL ให้การตรวจว่า test ล้มบนโค้ดเดิมรัน segment ของ provider ตั้งแต่ segment แรกจนถึง segment สุดท้ายที่ระบุ test file ที่เปลี่ยน เมื่อ provider บันทึก segment ไว้และทุก test file ที่เปลี่ยนมี segment ในช่วงนั้นระบุชื่อ และ SHALL รันทั้งคำสั่งเหมือนเดิมเมื่อจับคู่ไม่ได้ชัดเจน

#### Scenario: รันถึง segment สุดท้ายที่ test เปลี่ยน

- **GIVEN** provider test มี segment ของสาม task และมีเพียง test ของ task ที่สองที่เปลี่ยน
- **WHEN** harness ตรวจ test บนโค้ดเดิม
- **THEN** รัน segment ของ task ที่หนึ่งและสอง และไม่รัน segment ของ task ที่สาม

#### Scenario: ขั้นเตรียมก่อนหน้ายังรัน

- **GIVEN** segment แรกเป็นคำสั่ง build และ segment ที่สองรัน test ที่เปลี่ยน
- **WHEN** harness ตรวจ test บนโค้ดเดิม
- **THEN** รัน build ก่อน test

#### Scenario: จับคู่ไม่ได้รันทั้งหมด

- **GIVEN** มี test file ที่เปลี่ยนที่ไม่ปรากฏใน segment ใดเลย
- **WHEN** harness ตรวจ test บนโค้ดเดิม
- **THEN** รันทั้งคำสั่งของ provider เหมือนเดิม

#### Scenario: ไม่มี segment ใช้แบบเดิม

- **GIVEN** provider ที่ไม่มีข้อมูล segment เช่นของ change เก่า
- **WHEN** harness ตรวจ test บนโค้ดเดิม
- **THEN** ใช้วิธีเดิมโดยไม่มีข้อผิดพลาด
