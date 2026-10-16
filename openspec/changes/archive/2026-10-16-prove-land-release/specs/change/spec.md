# change

## ADDED Requirements

### Requirement: amended-task-tick

ระบบ SHALL ให้ EDIT ของ task ที่ verify ผ่านแต่ติ๊กไม่ได้เพราะไม่มีการเปลี่ยนใน path ของ task ระบุเหตุผลนั้นและทางต่อ คือแก้ path ของ task ให้ครอบไฟล์ที่เปลี่ยน หรือถอน task ด้วย amendment

#### Scenario: task ที่โค้ดอยู่นอก path

- **GIVEN** task ที่ verify ผ่านแต่ไฟล์ใน path ไม่ต่างจาก base
- **WHEN** agent รัน advance
- **THEN** EDIT ระบุว่าไม่มีการเปลี่ยนใน path ของ task และให้แก้ path หรือถอน task
