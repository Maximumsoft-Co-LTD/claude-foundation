# build-skill-routing

## ADDED Requirements

### Requirement: spec-vocabulary-descriptions

ระบบ SHALL ให้ description ของ testing-fundamentals, database-fundamentals, api-design-fundamentals, security-fundamentals และ debug-fundamentals ระบุสัญญาณใน spec ที่ควรเรียก skill นั้น ได้แก่ workType, riskSignals, requirement หรือ scenario

#### Scenario: description อ้าง spec

- **GIVEN** SKILL.md ของ 5 skill
- **WHEN** ตรวจ frontmatter
- **THEN** description ของแต่ละ skill มีคำว่า workType, riskSignals, requirement หรือ scenario อย่างน้อยหนึ่งคำ และมีกรณี Skip

### Requirement: no-skill-routing

ระบบ SHALL ไม่ใส่ field skills คำสั่งโหลด skill หรือชื่อ skill ลงใน task ของ Build EDIT และปล่อยให้ agent เลือก skill เองจาก description

#### Scenario: EDIT ไม่ระบุ skill

- **GIVEN** change ที่ workType เป็น bugfix และโปรเจกต์มี debug-fundamentals และ testing-fundamentals
- **WHEN** harness คืน Build EDIT
- **THEN** action ไม่มี field skills และไม่มีชื่อ skill ใน instruction ของ task หรือใน instructions

## REMOVED Requirements

### Requirement: Build actions name the skills the work needs



**Migration:** แทนด้วย no-skill-routing: Build EDIT ไม่ระบุ skill อีก agent เลือกเองจาก description
