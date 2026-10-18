# preview-stage

## ADDED Requirements

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
