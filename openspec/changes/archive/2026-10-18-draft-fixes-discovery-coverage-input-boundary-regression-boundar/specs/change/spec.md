# change

## ADDED Requirements

### Requirement: fixes-input-boundary

semantic intake SHALL นับ input-boundary เป็น discovery dimension ที่บังคับเมื่อ draft ประกาศ fixes อย่างน้อยหนึ่งรายการ โดยไม่เปลี่ยน review tier

#### Scenario: fixes บังคับ input-boundary

- **GIVEN** draft ประกาศ fixes ["add-loyalty-discount"] และไม่มี riskSignals
- **WHEN** semantic intake ตรวจ draft ที่ไม่มี coverage row ของ input-boundary
- **THEN** intake รายงานว่าขาด required dimension 'input-boundary'

#### Scenario: ไม่มี fixes

- **GIVEN** draft ไม่ประกาศ fixes และไม่มี riskSignals
- **WHEN** semantic intake ตรวจ draft
- **THEN** input-boundary ไม่อยู่ใน required dimension

#### Scenario: review tier คงเดิม

- **GIVEN** change ประกาศ fixes แต่ไม่มี riskSignals
- **WHEN** harness คำนวณ review tier
- **THEN** fixes ไม่เพิ่ม trigger ของ review

### Requirement: fixes-template

ผลของ change start --template SHALL บอกใน minimalDraftFixes และ minimalDraftRiskCoverage ว่า fixes ต้องมี coverage row ของ input-boundary

#### Scenario: template บอก fixes

- **GIVEN** agent เรียก change start --template
- **WHEN** อ่าน minimalDraftRiskCoverage
- **THEN** ข้อความมี fixes → input-boundary
