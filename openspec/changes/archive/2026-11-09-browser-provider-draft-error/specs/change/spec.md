# change

## ADDED Requirements

### Requirement: draft-folder-execution

ระบบ SHALL อ่าน execution.yaml ใน draft folder เป็น execution ของ draft

#### Scenario: draft folder มี execution.yaml

- **GIVEN** draft folder มี execution.yaml เป็น JSON {version: 1, providers} และ change.json ไม่มี execution
- **WHEN** โหลด draft folder
- **THEN** draft.execution เท่ากับเนื้อหาของ execution.yaml

#### Scenario: ประกาศ execution สองที่

- **GIVEN** change.json มี execution และ draft folder มี execution.yaml
- **WHEN** โหลด draft folder
- **THEN** ได้ issue ที่บอกให้เก็บ execution ไว้ที่เดียว

#### Scenario: execution.yaml ไม่ใช่ JSON

- **GIVEN** execution.yaml parse เป็น JSON ไม่ได้
- **WHEN** โหลด draft folder
- **THEN** ได้ issue ที่ระบุไฟล์และบอกว่าต้องเป็น JSON

### Requirement: actionable-wiring-errors

ระบบ SHALL บอกชื่อ provider ค่าที่ใช้ได้ และที่ตั้งค่าเมื่อปฏิเสธ wiring ของ browser หรือ execution ของ draft

#### Scenario: browser provider ไม่มี inputMode

- **GIVEN** provider ชื่อ browser ใช้ capability browser และ adapter command โดยไม่มี inputMode
- **WHEN** ตรวจ evidence contract
- **THEN** error ระบุชื่อ provider ค่า browser-automation, dom-event, os-input, both และบอกให้ตั้งใน execution ของ draft หรือ execution.yaml

#### Scenario: execution ของ draft ไม่มี version

- **GIVEN** draft มี execution ที่มี providers แต่ไม่มี version
- **WHEN** change start ตรวจ draft
- **THEN** issue บอกรูปแบบ {version: 1, providers: {...}}

#### Scenario: browser provider ที่ถูกต้อง

- **GIVEN** browser provider มี inputMode browser-automation
- **WHEN** ตรวจ evidence contract
- **THEN** ไม่มี error เรื่อง inputMode
