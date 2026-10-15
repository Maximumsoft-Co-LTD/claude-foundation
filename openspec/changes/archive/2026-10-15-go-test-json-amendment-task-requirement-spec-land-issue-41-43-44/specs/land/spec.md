# land

## ADDED Requirements

### Requirement: Landed specs end with one newline

ระบบ SHALL ทำให้ spec ใน openspec/specs ที่ change ถูก archive เขียนใหม่ลงท้ายด้วย newline เดียวก่อนบันทึก delivery integrity

#### Scenario: openspec archive ทิ้งบรรทัดว่าง

- **GIVEN** spec ที่ merge ลงท้ายด้วย \n\n
- **WHEN** Land archive สำเร็จ
- **THEN** spec ลงท้ายด้วย \n เดียวและ spec sync verification ผ่าน

#### Scenario: spec ที่ไม่ได้อยู่ใน change

- **GIVEN** spec อื่นใน openspec/specs ลงท้ายด้วย \n\n
- **WHEN** Land
- **THEN** spec นั้นไม่ถูกแก้

#### Scenario: recovery หลัง archive ค้าง

- **GIVEN** Land หยุดหลัง openspec archive ก่อนบันทึก integrity
- **WHEN** resume Land
- **THEN** spec ของ change ลงท้ายด้วย \n เดียวก่อนบันทึก integrity
