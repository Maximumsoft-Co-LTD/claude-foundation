# sandbox-apply

## ADDED Requirements

### Requirement: post-land-install

ระบบ SHALL รันคำสั่งติดตั้ง dependency ของโปรเจกต์ในโฟลเดอร์ของผู้ใช้หลัง Land เมื่อ Land เปลี่ยน package.json หรือ lockfile ที่ root โดยใช้ sandbox.setupCommand ถ้าตั้งไว้ มิฉะนั้นใช้คำสั่งของ lockfile และ SHALL บันทึกผลไว้ใน Land

#### Scenario: lockfile เปลี่ยน

- **GIVEN** Land เปลี่ยน package.json และ package-lock.json ที่ root
- **WHEN** Land apply เสร็จ
- **THEN** ระบบรัน npm ci ในโฟลเดอร์ของผู้ใช้และบันทึกสถานะ ok

#### Scenario: dependency ไม่เปลี่ยน

- **GIVEN** Land ไม่เปลี่ยน package.json หรือ lockfile
- **WHEN** Land apply เสร็จ
- **THEN** ระบบไม่รันคำสั่งติดตั้ง

#### Scenario: ปิดการติดตั้ง

- **GIVEN** foundation.json ตั้ง sandbox.installDependencies เป็น false และไม่มี setupCommand
- **WHEN** Land เปลี่ยน lockfile
- **THEN** ระบบไม่รันคำสั่งติดตั้ง

#### Scenario: ติดตั้งล้ม

- **GIVEN** คำสั่งติดตั้งจบด้วย exit code ไม่เป็นศูนย์
- **WHEN** Land apply เสร็จ
- **THEN** Land ไม่ถูกย้อนกลับ ระบบบันทึกสถานะ failed และแสดงคำสั่งที่ต้องรันเอง
