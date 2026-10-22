# approval-package

## ADDED Requirements

### Requirement: cards-new-types

หน้า package SHALL แสดง data-fix ในการ์ดแบบ E, security ในแบบ G และ cicd ในแบบ F พร้อมข้อมูลเฉพาะชนิด และเลิกแสดงส่วนที่ถูกบังคับแล้วเป็น แนะนำ

#### Scenario: การ์ดข้อมูล

- **GIVEN** workType เป็น data-fix และมี dataFix
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ E ที่มี scope snapshot dryRun rerunSafe rollback และ undo ดึงจาก dataFix.rollback

#### Scenario: การ์ด pipeline

- **GIVEN** workType เป็น cicd และมี pipelinePlan
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ F ที่มี changes permissions blastRadius rollback

#### Scenario: ไม่มีป้ายแนะนำแล้ว

- **GIVEN** workType เป็น ml และ draft ไม่มี evaluation
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** evaluation แสดงเป็นส่วนบังคับที่ขาด ไม่ใช่ป้ายแนะนำ
