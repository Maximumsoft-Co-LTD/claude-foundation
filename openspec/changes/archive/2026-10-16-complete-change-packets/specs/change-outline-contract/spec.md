# Outline ของเอกสาร change

## Purpose

หัวข้อ ลำดับ เงื่อนไข และบ้านของข้อมูลทุกชิ้นใน packet

## ADDED Requirements

### Requirement: One outline contract defines every packet section

ระบบ SHALL มี outline contract เดียวที่กำหนดหัวข้อ ลำดับ เงื่อนไข และ field ต้นทางของทุกหัวข้อใน proposal, design, spec และ tasks

- ลำดับตาม openspec/investigations/change-doc-outline.md
- หัวข้อแต่ละอันมี key, heading ตามภาษา, เงื่อนไข และ field ต้นทาง
- ข้อมูลที่เปลี่ยนหลังอนุมัติ (สถานะ ผู้อนุมัติ ความสดของหลักฐาน) ไม่อยู่ใน packet ก่อน Land

#### Scenario: หัวข้อเรียงตาม outline

- **GIVEN** draft ที่มีทุก field
- **WHEN** compile
- **THEN** หัวข้อ ## ของ proposal และ design เรียงตาม outline

#### Scenario: หัวข้อที่เงื่อนไขไม่จริงไม่แสดง

- **GIVEN** draft ไม่มี tenancy และไม่มี investigation
- **WHEN** compile
- **THEN** ไม่มีหัวข้อ tenancy หรือ appendix investigation

#### Scenario: ไม่มีข้อมูลที่เปลี่ยนหลังอนุมัติ

- **WHEN** compile
- **THEN** packet ไม่มีสถานะ ผู้อนุมัติ หรือความสดของหลักฐาน

### Requirement: Each work type requires its outline sections

ระบบ SHALL ตรวจว่า draft มี field ของหัวข้อที่ประเภทงานบังคับ และตอบ EDIT ที่ระบุชื่อ field และรูปแบบที่ต้องใส่เมื่อขาด

- หัวข้อบังคับต่อประเภทงานตาม Work type catalog ใน change-doc-outline.md
- งานที่ไม่เปลี่ยนพฤติกรรม (refactor, config, docs, test, chore) ไม่ต้องมี failure matrix
- งาน docs, test, chore ไม่ต้องมี design

#### Scenario: หัวข้อครบ

- **GIVEN** draft ประเภท api ที่มี apiContracts และ boundaries
- **WHEN** change start
- **THEN** ผ่านการตรวจหัวข้อ

#### Scenario: งาน docs ไม่ต้องมี design

- **GIVEN** draft ประเภท docs
- **WHEN** change start
- **THEN** ไม่มี design.md และไม่มีคำขอหัวข้อ design

#### Scenario: ขาดหัวข้อบังคับ

- **GIVEN** draft ประเภท infra ที่ไม่มี infraPlan
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ infraPlan และรูปแบบ

### Requirement: Each fact has one home in the packet

ระบบ SHALL แสดงข้อมูลแต่ละชิ้นในหัวข้อเดียวตาม outline และหัวข้ออื่นอ้างถึงแทนการคัดลอก

#### Scenario: ไม่ซ้ำ

- **GIVEN** draft ที่ task outcome, scenario และ decision ถูกอ้างหลายที่
- **WHEN** compile
- **THEN** ข้อความของแต่ละชิ้นปรากฏในหัวข้อบ้านเพียงหัวข้อเดียว
