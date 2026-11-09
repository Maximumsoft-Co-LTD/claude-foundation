# work-type-catalog

## ADDED Requirements

### Requirement: hotfix-regression-required

change start SHALL ปฏิเสธ hotfix draft ที่ไม่มี scenario regressionOf ตรงกับ bugfix.incident.link ใน requirement ที่มี capability รันได้

#### Scenario: hotfix ไม่มี regression

- **GIVEN** draft เป็น bugfix variant hotfix มี incident.link INC-212 และไม่มี scenario regressionOf
- **WHEN** รัน change start
- **THEN** ได้ EDIT ของ agent ที่ระบุว่าต้องมี scenario regressionOf: INC-212

#### Scenario: regressionOf ไม่ตรง incident

- **GIVEN** hotfix มี incident.link INC-212 แต่ scenario มี regressionOf INC-999
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุว่า regressionOf ต้องตรงกับ INC-212

#### Scenario: regression ไม่มี capability ที่รันได้

- **GIVEN** scenario regressionOf: INC-212 อยู่ใน requirement ที่มี capability review อย่างเดียว
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุว่า requirement ของ regression ต้องมี capability ที่รันได้

#### Scenario: hotfix ครบ

- **GIVEN** hotfix มี scenario regressionOf: INC-212 ใน requirement ที่มี capability test
- **WHEN** รัน change start
- **THEN** change ถูกสร้าง state มี regressionRequired: true และ spec ของ scenario แสดง Regression of INC-212

#### Scenario: bugfix ที่ไม่ใช่ hotfix

- **GIVEN** draft เป็น bugfix ไม่มี variant หรือ variant security และไม่มี regressionOf
- **WHEN** รัน change start
- **THEN** ไม่มี issue เรื่อง regression

#### Scenario: revise hotfix ที่สร้างก่อนอัปเกรด

- **GIVEN** hotfix ที่สร้างก่อนอัปเกรดไม่มี regressionRequired ใน state
- **WHEN** รัน change revise ด้วย draft ที่ไม่มี regressionOf
- **THEN** revise ผ่านโดยไม่มี issue เรื่อง regression

#### Scenario: revise hotfix ที่สร้างหลังอัปเกรด

- **GIVEN** hotfix มี regressionRequired: true
- **WHEN** รัน change revise ด้วย draft ที่ลบ scenario regressionOf ออก
- **THEN** ได้ EDIT ที่ระบุว่าต้องมี scenario regressionOf

### Requirement: incident-and-lessons-seeded

installer SHALL ใส่ openspec/incidents/README.md, openspec/incidents/_template.md และ openspec/lessons.md ตั้งต้นเฉพาะไฟล์ที่ยังไม่มี ทั้งตอนติดตั้งใหม่และอัปเกรด

#### Scenario: ติดตั้งใหม่

- **GIVEN** โปรเจกต์ไม่มีไฟล์ทั้งสาม
- **WHEN** รัน install.sh
- **THEN** ไฟล์ทั้งสามถูกสร้างจาก .claude/harness/templates และถูก stage เมื่อ target เป็น git repository

#### Scenario: มีบางไฟล์อยู่แล้ว

- **GIVEN** โปรเจกต์มี openspec/lessons.md ของตัวเอง
- **WHEN** รัน install.sh
- **THEN** lessons.md เหมือนเดิมทุก byte และไฟล์ที่ขาดถูกสร้าง

#### Scenario: ติดตั้งล้มกลางทาง

- **GIVEN** ไฟล์ทั้งสามยังไม่มีและการติดตั้งล้มหลังสร้างไฟล์
- **WHEN** installer rollback
- **THEN** ไฟล์ที่เพิ่งสร้างถูกลบ

### Requirement: lessons-read-as-grounding

ระบบ SHALL ใส่ openspec/lessons.md เป็นแหล่งข้อมูลอ้างอิงของ investigation และ change intake เมื่อไฟล์มีอยู่

#### Scenario: มี lessons.md

- **GIVEN** โปรเจกต์มี openspec/lessons.md
- **WHEN** เริ่ม investigation หรือ change intake
- **THEN** openspec/lessons.md อยู่ในรายการ source ที่ grounding อ่าน

#### Scenario: ไม่มี lessons.md

- **GIVEN** โปรเจกต์ไม่มี openspec/lessons.md
- **WHEN** เริ่ม investigation หรือ change intake
- **THEN** รายการ source เหมือนก่อนมีฟีเจอร์นี้

#### Scenario: แก้ lessons.md หลัง intake

- **GIVEN** change intake อ่าน lessons.md ไปแล้ว
- **WHEN** lessons.md ถูกแก้แล้วรัน change start อีกครั้ง
- **THEN** ได้ EDIT refresh-source-coverage ตามกลไก freshness เดิม
