# change-outline-contract

## ADDED Requirements

### Requirement: outline-heading-rules

ระบบ SHALL ยอมรับ heading ภาษาไทยของหัวข้อที่ render เป็นภาษาอังกฤษเสมอ เป็นชื่อเดียวกันของหัวข้อนั้น และ SHALL คืน EDIT ที่บอกว่า harness สร้างหัวข้อนั้นเองเมื่อ amendment พยายามเขียนหัวข้อที่ harness เป็นเจ้าของ

#### Scenario: heading ไทยของ Decisions

- **GIVEN** design.md ของ draft v5 ภาษาไทยเขียนหัวข้อ การตัดสินใจ
- **WHEN** agent รัน change start
- **THEN** prose อยู่ในหัวข้อ Decisions ครั้งเดียวและไม่มี EDIT เรื่อง heading

#### Scenario: amend หัวข้อที่ harness สร้าง

- **GIVEN** amendment มี prose ใต้หัวข้อ File map
- **WHEN** agent รัน change amend
- **THEN** harness คืน EDIT ที่บอกว่า File map ถูกสร้างโดย harness
