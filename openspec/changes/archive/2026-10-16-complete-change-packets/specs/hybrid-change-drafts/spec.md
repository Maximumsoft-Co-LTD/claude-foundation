# Draft แบบ hybrid

## Purpose

draft v5 ที่ส่วน typed เป็น JSON และ prose เป็น markdown ที่คนเขียน

## ADDED Requirements

### Requirement: Draft v5 is a folder with typed JSON and authored markdown

ระบบ SHALL รับ draft v5 เป็นโฟลเดอร์ที่มี change.json และ proposal.md กับ design.md ที่คนเขียนตามหัวข้อ outline

- change.json มี version 5 และ field typed ทั้งหมด
- proposal.md และ design.md ใช้หัวข้อ ## ตาม outline ในภาษาของ draft
- หัวข้อที่ harness สร้างเอง (traceability, file map, test map, appendix ที่ derive) เขียนเองไม่ได้

#### Scenario: คอมไพล์โฟลเดอร์

- **GIVEN** โฟลเดอร์ draft ที่ถูกต้อง
- **WHEN** change start .foundation/drafts/refund-api/
- **THEN** packet ถูกสร้างและผ่าน validate

#### Scenario: หัวข้อไม่รู้จัก

- **GIVEN** design.md มีหัวข้อที่ outline ไม่มี
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุหัวข้อและรายการหัวข้อที่รับ

#### Scenario: เขียนหัวข้อที่ harness สร้าง

- **GIVEN** proposal.md มีหัวข้อเกณฑ์ผ่าน
- **WHEN** change start
- **THEN** ได้ EDIT ว่าหัวข้อนี้ harness สร้างเอง

#### Scenario: ไม่มี change.json

- **GIVEN** โฟลเดอร์ไม่มี change.json
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุไฟล์ที่ขาด

### Requirement: Authored prose merges with derived sections in outline order

ระบบ SHALL รวม prose ที่คนเขียนกับหัวข้อที่ derive ตามลำดับ outline โดยไม่แก้ข้อความที่คนเขียน

#### Scenario: prose คงเดิม

- **GIVEN** design.md มีหัวข้อภาพรวมที่คนเขียน
- **WHEN** compile
- **THEN** ข้อความในหัวข้อนั้นตรงกับต้นฉบับทุกตัวอักษร

#### Scenario: หัวข้อผิดลำดับ

- **GIVEN** design.md มี Risks ก่อนภาพรวม
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุลำดับที่ถูก

#### Scenario: prose ที่มี TODO

- **GIVEN** หัวข้อใดมี TODO หรือ TBD
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุหัวข้อ

### Requirement: Draft v5 passes the same intake gate as v4

ระบบ SHALL ใช้ semantic intake gate และ discovery coverage กับ draft v5 เหมือน v4

#### Scenario: impact high ไม่มี coverage

- **GIVEN** change.json v5 impact high ที่ไม่มีแถว operability
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ dimension ที่ขาด

#### Scenario: new --draft ใช้ v5

- **GIVEN** draft v5
- **WHEN** new --draft
- **THEN** ถูกตรวจ intake เหมือน v4

### Requirement: Revise and amend keep authored prose

ระบบ SHALL ให้ revise และ amend ของ change v5 ใช้ prose จากโฟลเดอร์ draft และแทนที่หัวข้อที่ amend ในที่เดิม รวมถึงหัวข้อใน design

#### Scenario: revise คง prose

- **GIVEN** change v5 ก่อน Build
- **WHEN** revise ด้วยโฟลเดอร์ draft ที่แก้ requirement
- **THEN** prose ที่ไม่ได้แก้คงเดิม

#### Scenario: amend แก้หัวข้อ design

- **GIVEN** change v5 ระหว่าง Build
- **WHEN** amend ที่แทนหัวข้อ rollout
- **THEN** design มีหัวข้อ rollout ใหม่ชุดเดียว

#### Scenario: amend ด้วยหัวข้อไม่รู้จัก

- **WHEN** amend ที่อ้างหัวข้อที่ outline ไม่มี
- **THEN** amend ถูกปฏิเสธและ packet ไม่เปลี่ยน

### Requirement: Draft v3, v4, and v5 coexist under agreed pins

ระบบ SHALL คอมไพล์ draft v3, v4 และ v5 และประกาศ semanticDraftSchema 5 โดยคง runtime API เดิม

- check version ที่ฝังในโค้ดทุกจุดรองรับ 5
- proof receipt บันทึก semanticDraftSchema ของ change
- change start --template แสดงทั้งแบบ v4 และโครงโฟลเดอร์ v5

#### Scenario: v4 เดิมผ่าน

- **GIVEN** draft v4 จาก fixture เดิม
- **WHEN** change start
- **THEN** คอมไพล์และ validate ผ่าน

#### Scenario: v3 ยังอ่านได้

- **GIVEN** draft v3
- **WHEN** change start
- **THEN** คอมไพล์ผ่าน

#### Scenario: CLI เดิมใช้ต่อได้

- **GIVEN** cli.sh และ runtime pin เป็น API 41 เท่ากัน
- **WHEN** เรียก claude-foundation changes หลังเปลี่ยน
- **THEN** คำสั่งทำงานโดยไม่มีข้อความเรื่อง version ไม่ตรง

#### Scenario: draft version ไม่รู้จัก

- **GIVEN** draft version 6
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ version ที่รับคือ 3, 4 และ 5

### Requirement: Drafts warn about unknown task fields

ระบบ SHALL เตือนเมื่อ task ใน draft มี field ที่ไม่รู้จักพร้อมชื่อ field ที่น่าจะหมายถึง โดยไม่ block

#### Scenario: depends แทน dependsOn

- **GIVEN** task มี field depends
- **WHEN** change start
- **THEN** มีคำเตือนว่า tasks[0].depends ไม่รู้จัก หมายถึง dependsOn หรือไม่

#### Scenario: field ถูกต้องไม่มีคำเตือน

- **GIVEN** task ใช้เฉพาะ field ที่รู้จัก
- **WHEN** change start
- **THEN** ไม่มีคำเตือนเรื่อง field

### Requirement: Documentation describes the outline, v5, and the work type catalog

ระบบ SHALL มีเอกสารภาษาอังกฤษและไทยที่อธิบาย outline, draft v5, ประเภทงาน, field ใหม่ และ capability ใหม่ ตรงกับ runtime

#### Scenario: docs consistency ผ่าน

- **WHEN** รัน docs consistency
- **THEN** ผ่านและพบ draft v5 กับ pin table ใหม่

#### Scenario: ภาษาไม่ตรงกัน

- **GIVEN** หน้า website อังกฤษมีหัวข้อที่ไทยไม่มี
- **WHEN** รัน docs consistency
- **THEN** fail พร้อมชื่อหน้า
