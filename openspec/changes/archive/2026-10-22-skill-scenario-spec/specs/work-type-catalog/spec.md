# work-type-catalog

## REMOVED Requirements

### Requirement: Each work type routes to its skills

ระบบ SHALL ไม่ route ประเภทงานไปยัง skill ใน action ของ Build

**Migration:** คำสั่งให้ action แนะนำ skill ถูกแทนด้วย requirement no-skill-routing ของ build-skill-routing ซึ่งให้ agent เลือก skill เองจาก description (commit 85a2d1f3e)

#### Scenario: EDIT ไม่ระบุ skill

- **GIVEN** change ประเภท infra
- **WHEN** advance ถึง Build
- **THEN** action ไม่มี field skills และไม่มีชื่อ skill ใน instruction
