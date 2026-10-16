# hybrid-change-drafts

## ADDED Requirements

### Requirement: v5-merge-revision

ระบบ SHALL ให้ change revise --merge ของ change ที่เริ่มจาก minimal v5 derive key ของแถวที่เพิ่มโดยไม่มี key และ SHALL ปฏิเสธ patch ที่เปลี่ยน version ของ draft

#### Scenario: merge เพิ่ม requirement ใน minimal v5

- **GIVEN** change ที่เริ่มจาก minimal v5 ของ template
- **WHEN** agent รัน change revise --merge ด้วย patch ที่เพิ่ม requirement โดยไม่มี key
- **THEN** requirement ใหม่ได้ key ที่ derive และ draft ยังเป็น version 5

#### Scenario: merge เปลี่ยน version

- **GIVEN** change ที่เริ่มจาก draft v4
- **WHEN** agent รัน change revise --merge ด้วย patch ที่ตั้ง version 5
- **THEN** harness ปฏิเสธและบอกให้ revise ทั้ง draft
