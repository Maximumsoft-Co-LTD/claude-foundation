# change

## ADDED Requirements

### Requirement: Derived providers run where their tasks run

ระบบ SHALL ผูก provider ที่ derive จาก task verify กับ repository ของ task เมื่อทุก task ของ change อยู่ใน repository เดียวที่ไม่ใช่ root

#### Scenario: repository เดียวได้ provider ที่ผูก repository

- **GIVEN** draft ไม่มี execution และทุก task มี repository svc
- **WHEN** compile draft
- **THEN** provider test ที่ derive มี repository svc

#### Scenario: root หรือไม่ระบุ repository คงเดิม

- **GIVEN** ทุก task ไม่มี repository หรือเป็น root
- **WHEN** compile draft
- **THEN** provider ที่ derive ไม่มี field repository

#### Scenario: หลาย repository คงพฤติกรรมเดิม

- **GIVEN** task อยู่ใน repository root และ lib
- **WHEN** compile draft
- **THEN** provider ที่ derive ไม่มี field repository

#### Scenario: execution ที่ผู้เขียนกำหนดไม่ถูกแตะ

- **GIVEN** draft มี execution.providers
- **WHEN** compile draft
- **THEN** providers เท่ากับที่ผู้เขียนกำหนดทุก field

### Requirement: Amendments reuse the provider that serves a capability

ระบบ SHALL ไม่เพิ่ม provider ใหม่ระหว่าง amend เมื่อ contract มี provider เดียวที่ให้บริการ capability นั้นอยู่แล้ว

#### Scenario: reuse provider ที่ประกาศไว้

- **GIVEN** contract มี provider test-svc capability test repository svc
- **WHEN** amend เพิ่ม requirement ที่ evidence test และ task ใน repository svc
- **THEN** providers หลัง amend มีเฉพาะ test-svc
- **AND** command ของ test-svc ไม่ถูกเปลี่ยน

#### Scenario: ไม่มี provider ของ capability จึงเพิ่มตัวที่ derive

- **GIVEN** contract ไม่มี provider capability test
- **WHEN** amend เพิ่ม claim test ใน repository svc
- **THEN** เพิ่ม provider test ที่ผูก repository svc

#### Scenario: provider ชื่อเดียวกับ capability ยังตามคำสั่ง verify

- **GIVEN** contract มี provider test ที่ derive
- **WHEN** amend เพิ่ม task
- **THEN** command ของ test เป็น chain ของ verify ทั้งหมดตามเดิม

### Requirement: Ambiguous capability providers stop an amendment

ระบบ SHALL ปฏิเสธ amend พร้อมคำแนะนำเมื่อมีหลาย provider ให้บริการ capability ที่ amendment ต้องใช้และไม่มี provider ชื่อเดียวกับ capability

#### Scenario: สอง provider ให้บริการ test

- **GIVEN** contract มี test-a และ test-b capability test
- **WHEN** amend เพิ่ม claim test
- **THEN** amend คืน issue ที่ระบุ capability test และชื่อ provider ทั้งสอง

### Requirement: Amendments report waivers they invalidate

ระบบ SHALL แสดงรายชื่อ waiver ที่ไม่มีผลหลัง amend เพราะ binding ไม่ตรงกับ contract revision ใหม่

#### Scenario: waiver ผูก revision เดิม

- **GIVEN** waiver test มี binding contractRevision 2
- **WHEN** amend ทำให้ revision เป็น 3
- **THEN** ผลลัพธ์ AMENDED มีบรรทัด waivers no longer apply ที่ระบุ test

#### Scenario: ไม่มี waiver

- **GIVEN** ไม่มี waiver
- **WHEN** amend
- **THEN** ไม่มีบรรทัด waivers
