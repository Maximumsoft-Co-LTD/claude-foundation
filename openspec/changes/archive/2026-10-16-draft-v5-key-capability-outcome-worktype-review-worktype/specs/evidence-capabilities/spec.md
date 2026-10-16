# evidence-capabilities

## ADDED Requirements

### Requirement: worktype-evidence-four

ระบบ SHALL บังคับหลักฐาน performance สำหรับ workType performance, concurrency สำหรับ async, integration สำหรับ integration และ compatibility สำหรับ deprecation

#### Scenario: ประกาศ async

- **GIVEN** change ประกาศ workType async
- **WHEN** harness คำนวณหลักฐานที่ต้องมี
- **THEN** concurrency อยู่ในหลักฐานที่ต้องมีพร้อม trigger work-type:async และ catalog รู้จัก concurrency

#### Scenario: ประกาศ deprecation

- **GIVEN** change ประกาศ workType deprecation
- **WHEN** harness คำนวณหลักฐานที่ต้องมี
- **THEN** compatibility อยู่ในหลักฐานที่ต้องมีพร้อม trigger work-type:deprecation
