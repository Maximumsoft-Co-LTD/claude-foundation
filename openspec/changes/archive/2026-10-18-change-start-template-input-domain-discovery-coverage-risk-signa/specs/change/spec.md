# change

## ADDED Requirements

### Requirement: narrow-input-domain

ผลของ change start --template SHALL แนะนำ riskSignals 'input-domain' เฉพาะเมื่อค่าจากภายนอกโปรแกรม (HTTP request, ไฟล์ upload, CLI argument หรือ message payload) ต้องถูกตรวจหรือปฏิเสธ และ SHALL บอกว่าไม่ใช้กับ argument ของฟังก์ชันทั่วไป

#### Scenario: คำแนะนำแคบลง

- **GIVEN** agent เรียก change start --template
- **WHEN** อ่าน minimalDraftRiskSignals
- **THEN** ข้อความของ input-domain ระบุ HTTP request, ไฟล์ upload, CLI argument หรือ message payload และบอกว่าไม่ใช้กับ argument ของฟังก์ชันทั่วไป

#### Scenario: signal อื่นคงเดิม

- **GIVEN** agent เรียก change start --template
- **WHEN** อ่าน minimalDraftRiskSignals
- **THEN** คำแนะนำของ access-control, financial, performance-slo, persisted-data-change และ external-integration ยังอยู่ครบ

### Requirement: risk-coverage-template

ผลของ change start --template SHALL มี minimalDraftRiskCoverage ที่บอกรูปแบบ discovery.coverage row (dimension, status covered พร้อม covers หรือ not-applicable พร้อม rationale) และ dimension ที่แต่ละ risk signal บังคับ โดยสร้างจากตารางเดียวกับที่ semantic intake ใช้ตรวจ

#### Scenario: ทุก signal มี dimension

- **GIVEN** agent เรียก change start --template
- **WHEN** อ่าน minimalDraftRiskCoverage
- **THEN** ทุก risk signal ที่ semantic intake รู้จักปรากฏพร้อม dimension ที่ intake บังคับครบทุกตัว

#### Scenario: รูปแบบ row

- **GIVEN** agent เรียก change start --template
- **WHEN** อ่าน minimalDraftRiskCoverage
- **THEN** ข้อความระบุ covered คู่กับ covers และ not-applicable คู่กับ rationale

#### Scenario: draft ตามตัวอย่างผ่าน intake

- **GIVEN** draft ประกาศ input-domain และมี coverage row ของ input-boundary แบบ covered พร้อม covers ตามรูปแบบใน template
- **WHEN** semantic intake ตรวจ draft
- **THEN** ไม่มี issue เรื่อง discovery coverage
