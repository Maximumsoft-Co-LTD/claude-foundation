# change

## ADDED Requirements

### Requirement: template-scenario-coverage

ระบบ SHALL ให้ template ของ change start มีแนวทางเขียน scenario ให้ครอบคลุมทุกกฎที่คำขอหรือเอกสารอ้างอิงระบุ

- แนวทางอยู่ใน minimalDraftWriting ภายใต้ key scenarios
- ระบุให้แยก scenario ต่อกฎ ข้อจำกัด และ endpoint ที่เอกสารกำหนด พร้อมกรณี failure และ boundary ของแต่ละกฎ
- ไม่กำหนดจำนวนขั้นต่ำตายตัว และไม่มีชื่อ skill

#### Scenario: template มีแนวทาง scenario

- **GIVEN** ผู้ใช้เรียก change start --template
- **WHEN** อ่าน minimalDraftWriting
- **THEN** มี key scenarios ที่บอกให้เขียน scenario ต่อกฎและต่อกรณี failure และ boundary

#### Scenario: ไม่มีโควตาและไม่มีชื่อ skill

- **GIVEN** ข้อความแนวทางใน key scenarios
- **WHEN** ตรวจข้อความ
- **THEN** ไม่มีตัวเลขจำนวนขั้นต่ำของ scenario และไม่มีชื่อ skill ใดๆ
