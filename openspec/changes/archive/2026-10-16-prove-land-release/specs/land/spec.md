# land

## ADDED Requirements

### Requirement: land-dead-end-route

ระบบ SHALL ให้ข้อความเมื่อ read-only dependency ไม่ได้แยก sandbox ระบุ route ที่มีอยู่จริงและตรงกับ WORKFLOW.md แทนการบอกให้สร้าง sandbox ใหม่

#### Scenario: dependency ไม่แยก

- **GIVEN** read-only dependency ที่ไม่ใช่ worktree
- **WHEN** agent รัน Land
- **THEN** ข้อความระบุ route ที่มีใน commands.json และไม่มีคำว่า recreate the sandbox
