# ข้อตกลงของ change

draft ประกาศ allow/deny, financial, constraints และ fixes แบบ typed

## ADDED Requirements

### Requirement: Access-control drafts declare allowed and denied cases

ระบบ SHALL บังคับให้ draft ที่ประกาศ riskSignals access-control มี scenario ที่ติด access allow อย่างน้อยหนึ่งและ access deny อย่างน้อยหนึ่ง

- scenario field ใหม่ access มีค่าได้เฉพาะ allow หรือ deny
- ตรวจจาก field typed เท่านั้น ไม่ดูคำใน prose
- การขาดเป็น EDIT owner agent boundary draft-validation ไม่ใช่ ASK_USER

#### Scenario: มีทั้ง allow และ deny

- **GIVEN** draft มี riskSignals access-control, scenario หนึ่ง access allow และอีกหนึ่ง access deny
- **WHEN** change start inspect
- **THEN** ไม่มี issue เรื่อง access
- **AND** coverage permission-rejection ถูก derive เป็น covered จาก scenario deny

#### Scenario: ขาด allow

- **GIVEN** draft มี riskSignals access-control และมีเฉพาะ scenario access deny
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ข้อความระบุว่าต้องมี scenario access allow อย่างน้อยหนึ่ง

#### Scenario: ขาด deny

- **GIVEN** draft มี riskSignals access-control และมีเฉพาะ scenario access allow
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ข้อความระบุว่าต้องมี scenario access deny อย่างน้อยหนึ่ง

#### Scenario: ค่า access ไม่รู้จัก

- **GIVEN** scenario มี access maybe
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ระบุว่า access ต้องเป็น allow หรือ deny

#### Scenario: ไม่มี signal ไม่บังคับ

- **GIVEN** draft ไม่มี riskSignals access-control และไม่มี access tag
- **WHEN** change start inspect
- **THEN** ไม่มี issue เรื่อง access

### Requirement: Financial work declares a typed risk signal

ระบบ SHALL รับ riskSignals financial และกำหนด discovery dimensions timeout-retry-idempotency และ recoverability

#### Scenario: financial ได้ dimensions

- **GIVEN** draft มี riskSignals financial และไม่มี coverage ของ timeout-retry-idempotency
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ระบุ dimension timeout-retry-idempotency ที่ขาด

#### Scenario: ภาษาไม่เปลี่ยนผล

- **GIVEN** draft สองฉบับมี riskSignals financial เหมือนกัน แต่ prose เป็นไทยและอังกฤษ
- **WHEN** change start inspect ทั้งสอง
- **THEN** required dimensions เท่ากัน

#### Scenario: signal ไม่รู้จักยังถูกปฏิเสธ

- **GIVEN** draft มี riskSignals money
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ที่ list known signals รวม financial

### Requirement: Semantic drafts carry explicit constraints

ระบบ SHALL รับ field constraints ที่เป็นรายการข้อความใน draft v4 และแสดงเป็นหัวข้อ Constraints ใน proposal

- investigationCoverage target ใหม่ {kind: constraint, key: <ข้อความ constraint ตรงตัว>}
- amendment คง constraints เดิมเหมือน nonGoals

#### Scenario: render constraints

- **GIVEN** draft มี constraints สองข้อ
- **WHEN** change start
- **THEN** proposal.md มีหัวข้อ Constraints ที่มีทั้งสองข้อ

#### Scenario: ไม่มี constraints

- **GIVEN** draft ไม่มี constraints
- **WHEN** change start
- **THEN** proposal.md ไม่มีหัวข้อ Constraints และส่วนอื่นเหมือนเดิม

#### Scenario: ชนิดผิด

- **GIVEN** constraints เป็น string แทน array หรือมีสมาชิกว่าง
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ระบุ field constraints

#### Scenario: coverage ไปยัง constraint

- **GIVEN** investigation requirement ชนิด constraint ถูก map ไป {kind: constraint, key: ข้อความตรงกับ constraints}
- **WHEN** change start inspect
- **THEN** ไม่มี issue uncovered สำหรับ requirement นั้น

#### Scenario: coverage อ้าง constraint ที่ไม่มี

- **GIVEN** target constraint มี key ไม่ตรงกับ constraints ใด
- **WHEN** change start inspect
- **THEN** intake คืน EDIT invalid target

### Requirement: Semantic drafts declare which archived changes they fix

ระบบ SHALL รับ field fixes ที่เป็นรายการ change id ที่ archive แล้วและบันทึกลง change state และ proposal

- id ต้องมีโฟลเดอร์ openspec/changes/archive/<date>-<id> (git-tracked จึงใช้ได้ข้ามเครื่อง)
- proposal แสดงบรรทัด Fixes

#### Scenario: อ้าง change ที่ archive แล้ว

- **GIVEN** openspec/changes/archive มีโฟลเดอร์ของ change a
- **WHEN** change start draft ที่มี fixes [a]
- **THEN** state ของ change มี fixes [a] และ proposal แสดง Fixes: a

#### Scenario: อ้าง change ที่ไม่มี

- **GIVEN** ไม่มี archive ของ change zzz
- **WHEN** change start inspect draft ที่มี fixes [zzz]
- **THEN** intake คืน EDIT ระบุ fixes zzz ไม่ใช่ change ที่ archive แล้ว

#### Scenario: ไม่มี fixes

- **GIVEN** draft ไม่มี fixes
- **WHEN** change start
- **THEN** state ไม่มี fixes และ proposal ไม่มีบรรทัด Fixes
