# Preview stage

## Purpose

ขั้นที่เลือกใช้ได้ก่อน Build สำหรับรัน scratch ใน workspace แยก ผลเป็น preview receipt ที่ไม่มีวันนับเป็นหลักฐานของ Prove

## ADDED Requirements

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
