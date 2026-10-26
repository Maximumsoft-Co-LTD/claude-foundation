# change-amend Specification

## Purpose
ทำให้ทางตัน CONTRACT_DECISION_REQUIRED หลัง amendment บอกทางต่อที่มีอยู่จริง และเตือนตั้งแต่ตอน amend.
## Requirements
### Requirement: amend-decision-notice

ระบบ SHALL ให้ change amend แสดงว่าต้องมี Decision Sheet revision พร้อมคำสั่งเดียวกับที่ advance ระบุ เมื่อ amendment เปลี่ยน contract หลัง delta รอบสุดท้ายที่ล้ม

#### Scenario: amend หลัง delta ที่ล้ม

- **GIVEN** delta รอบสุดท้ายล้มและ amendment เปลี่ยน contract fingerprint
- **WHEN** agent รัน change amend
- **THEN** output ระบุว่าต้องมี Decision Sheet revision และมีคำสั่งตามชนิดของ change

#### Scenario: amend ที่ไม่มี review ล้ม

- **GIVEN** ไม่มี delta ที่ล้ม
- **WHEN** agent รัน change amend
- **THEN** output ไม่มีข้อความเตือนนี้และผลของ amend เหมือนเดิม

#### Scenario: amend ที่ไม่เปลี่ยน contract

- **GIVEN** delta ล้มอยู่แต่ amendment เป็น task-only และ fingerprint คงเดิม
- **WHEN** agent รัน change amend
- **THEN** output ไม่มีข้อความเตือนนี้
