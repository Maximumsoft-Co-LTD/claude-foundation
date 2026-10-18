# preview-stage Specification

## Purpose
ขั้นที่เลือกใช้ได้ก่อน Build สำหรับรัน scratch ใน workspace แยก ผลเป็น preview receipt ที่ไม่มีวันนับเป็นหลักฐานของ Prove
## Requirements
### Requirement: preview-run

ระบบ SHALL รัน preview ที่ร้องขอใน workspace แยกก่อน Build

- รันได้ทั้งก่อนและหลังอนุมัติ spec แต่ก่อน Build
- agent เขียน scratch ได้เฉพาะใน preview workspace

#### Scenario: รัน provider

- **GIVEN** evidence.yaml มี provider plan-check
- **WHEN** รัน preview <change> --provider plan-check
- **THEN** มี receipt ใน .foundation/previews/<id>/receipts/plan-check.json
- **AND** working tree ของ target ไม่เปลี่ยน

#### Scenario: provider ไม่มี

- **WHEN** รัน preview กับ provider ที่ไม่ได้ประกาศ
- **THEN** exit ไม่เป็นศูนย์และระบุชื่อ provider

### Requirement: preview-never-proof

ระบบ SHALL ไม่นับ preview receipt เป็นหลักฐานของ Prove หรือ Land

#### Scenario: คัดลอก preview เข้า receipts

- **GIVEN** preview receipt ถูกคัดลอกไป .foundation/receipts/<id>/
- **WHEN** Prove ตรวจความพร้อม
- **THEN** receipt ถูกปฏิเสธเป็น preview-evidence

### Requirement: preview-optional

ระบบ SHALL ไม่บล็อกการอนุมัติหรือ Build เมื่อไม่มี preview ไม่ว่าระดับความเสี่ยงใด

#### Scenario: Critical ไม่มี preview

- **GIVEN** change ระดับ Critical ที่อนุมัติแล้วและไม่มี preview
- **WHEN** advance --through build
- **THEN** Build เริ่มได้

### Requirement: preview-external-authority

ระบบ SHALL รัน preview provider ที่ประกาศ external เฉพาะเมื่อมี decision-ref ของผู้ใช้สำหรับ run นั้น

#### Scenario: ไม่มีสิทธิ์

- **GIVEN** provider ประกาศ external: true
- **WHEN** รัน preview โดยไม่มี --decision-ref
- **THEN** ปฏิเสธด้วย PREVIEW_AUTHORITY_REQUIRED และไม่รันคำสั่งใด

#### Scenario: มีสิทธิ์

- **GIVEN** provider ประกาศ external: true
- **WHEN** รัน preview ด้วย --decision-ref user-ok
- **THEN** provider รันและ receipt บันทึก decisionRef user-ok

### Requirement: preview-stale

ระบบ SHALL ผูก preview receipt กับ contract revision และแสดงว่า stale เมื่อ revision เปลี่ยน

#### Scenario: revise หลัง preview

- **GIVEN** preview ที่ revision 1
- **WHEN** change revise ทำให้เป็น revision 2 แล้วรัน package
- **THEN** preview นั้นติดป้าย stale

### Requirement: preview-before-build

ระบบ SHALL ให้ preview รันได้เมื่อ workspace ยังเป็น target เอง และปฏิเสธเมื่อมี sandbox ของ Build

#### Scenario: workspace เป็น target

- **GIVEN** สถานะ change และ workspace mode current ที่ path เป็น root
- **WHEN** รัน preview กับ provider ที่ประกาศ
- **THEN** preview รันและบันทึก receipt

#### Scenario: ไม่มี workspace

- **GIVEN** สถานะ change และไม่มี workspace
- **WHEN** รัน preview
- **THEN** preview รันและบันทึก receipt

#### Scenario: workspace mode อื่นที่ชี้ root

- **GIVEN** สถานะ change และ workspace ไม่มี mode แต่ path เป็น root
- **WHEN** รัน preview
- **THEN** preview รันและบันทึก receipt

#### Scenario: มี sandbox แล้ว

- **GIVEN** workspace mode copy ที่ path อยู่ใน .foundation/sandboxes
- **WHEN** รัน preview
- **THEN** ปฏิเสธด้วยข้อความ only before Build และไม่รันอะไร

#### Scenario: สถานะ building

- **GIVEN** สถานะ building และ workspace mode current
- **WHEN** รัน preview
- **THEN** ปฏิเสธด้วยข้อความ only before Build

### Requirement: preview-only-provider

ระบบ SHALL ให้ประกาศ provider ที่มี previewOnly true ซึ่ง preview รันได้แต่ Prove และการตรวจ claim ไม่เห็น

#### Scenario: preview-only accessibility

- **GIVEN** provider previewOnly capability accessibility ที่ไม่มี claims
- **WHEN** รัน preview กับ provider นั้น
- **THEN** preview รันและบันทึก receipt

#### Scenario: Prove ไม่เลือก

- **GIVEN** มี provider accessibility ปกติและ provider previewOnly capability accessibility
- **WHEN** harness คำนวณ provider ที่ต้องใช้
- **THEN** เลือกเฉพาะ provider ปกติ

#### Scenario: previewOnly ไม่มี command

- **GIVEN** provider previewOnly ที่ไม่มี command
- **WHEN** รัน preview
- **THEN** ปฏิเสธพร้อมระบุว่าไม่มี command

### Requirement: preview-artifact-link

ระบบ SHALL เก็บไฟล์ที่ provider ประกาศใน previewArtifact และให้ package ลิงก์ไปที่ไฟล์นั้น

- previewArtifact เป็น path ใน workspace ของ preview ที่ห้ามออกนอก workspace

#### Scenario: มี prototype

- **GIVEN** provider มี previewArtifact scratch/prototype.html
- **WHEN** รัน preview แล้วรัน package
- **THEN** package มีลิงก์ไปที่สำเนาของ prototype ใน .foundation/previews

#### Scenario: path ออกนอก workspace

- **GIVEN** previewArtifact เป็น ../secret.txt
- **WHEN** รัน preview
- **THEN** ปฏิเสธและไม่คัดลอกไฟล์
