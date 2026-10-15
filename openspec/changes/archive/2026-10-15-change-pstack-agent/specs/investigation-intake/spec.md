# บันทึก investigation

hypothesis อ้าง experiment ที่ใช้พิสูจน์

## ADDED Requirements

### Requirement: Hypotheses name the experiment that tests them

ระบบ SHALL รับ experimentKeys ที่เป็น optional บน hypothesis ของ record v2 และแสดง next check ของแต่ละ hypothesis ที่ยังเปิดในรายงาน

- label ทั้ง en และ th
- record v1 และ v2 ที่ไม่มี experimentKeys ยัง validate ได้เหมือนเดิม

#### Scenario: แสดง next check

- **GIVEN** hypothesis h1 open มี experimentKeys [e1] และ e1 planned
- **WHEN** รัน investigate
- **THEN** รายงาน Unknowns แสดง h1 พร้อม next check e1, คำถามของ e1 และสถานะ planned

#### Scenario: ไม่มี next check

- **GIVEN** hypothesis open ไม่มี experimentKeys
- **WHEN** รัน investigate
- **THEN** รายงานแสดงว่ายังไม่มี next check สำหรับ hypothesis นั้น

#### Scenario: อ้าง experiment ที่ไม่มี

- **GIVEN** experimentKeys [nope] ไม่มีใน experiments
- **WHEN** รัน investigate
- **THEN** คืน EDIT repair-record ระบุ hypothesis และ key ที่ไม่มี

#### Scenario: อ้าง experiment ที่ถูก supersede

- **GIVEN** experimentKeys [e1] และ e1 มี supersededBy e2
- **WHEN** รัน investigate
- **THEN** คืน EDIT repair-record ให้อ้าง e2
