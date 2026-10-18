# approval-package Specification

## Purpose
จัดประเภท change ด้วย intent, technical domain และระดับความเสี่ยงจาก signal เดิม แล้วสร้างหน้า HTML อ่านอย่างเดียวที่แบ่งตามบทบาทให้ผู้อนุมัติดูก่อน Build
## Requirements
### Requirement: route-change

ระบบ SHALL จัด change เป็น intent, domain และระดับความเสี่ยงจาก signal ที่มีอยู่

- Critical เมื่อ impact high และมี financial หรือ access-control; High เมื่อ impact high หรือมี signal น้ำหนัก 3; Medium เมื่อมี signal ใดหรือ impact medium; Low เมื่อไม่มี
- ทุก change ได้ change impact และ test map เสมอ
- artifact ที่ต้องรันได้แสดงเฉพาะระดับ High ขึ้นไป

#### Scenario: ตัวอย่างถอนเงิน

- **GIVEN** workType feature ui api data async กับ riskSignals financial access-control persisted-data-change external-integration และ impact high
- **WHEN** เรียก routeChange()
- **THEN** ระดับเป็น Critical
- **AND** domain รวม 6, 10, 11, 14, 15
- **AND** artifact retry ปรากฏครั้งเดียวแม้มาจาก domain 8 และ 9

#### Scenario: งาน docs อย่างเดียว

- **GIVEN** workType docs ไม่มี riskSignals impact low
- **WHEN** เรียก routeChange()
- **THEN** ระดับเป็น Low และมีแค่ change impact กับ test map

#### Scenario: workType ที่ไม่รู้จัก

- **GIVEN** workType มีค่า unknown-kind
- **WHEN** เรียก routeChange()
- **THEN** ไม่ throw และคืนคำเตือนที่ระบุ unknown-kind

### Requirement: package-render

ระบบ SHALL สร้าง approval package HTML แบบอ่านอย่างเดียวจาก change ที่ compile แล้ว

- อ่าน state.draftSource เมื่อ contractRevision ตรงกับ state เท่านั้น
- HTML self-contained ไม่โหลดอะไรจากภายนอก diagram ฝังเป็น pre.mermaid ที่ viewer ซึ่งรองรับ mermaid render ได้ และแสดง source ที่อ่านได้เมื่อไม่รองรับ
- ไม่เขียน .foundation/runtime, receipts หรือ openspec

#### Scenario: สร้าง package

- **GIVEN** change ที่ compile แล้วและมี diagrams
- **WHEN** รัน package <change>
- **THEN** ไฟล์ .foundation/packages/<id>.html ถูกเขียน
- **AND** มีส่วนของทุกบทบาทที่ routeChange() เลือก
- **AND** มี pre.mermaid หนึ่งบล็อกต่อ diagram

#### Scenario: ไม่แก้ state

- **GIVEN** digest ของ .foundation/runtime/<id>.json ก่อนรัน
- **WHEN** รัน package <change>
- **THEN** digest หลังรันเท่าเดิม

#### Scenario: draft v3 ไม่มี draftSource

- **GIVEN** change เก่าที่ไม่มี draftSource
- **WHEN** รัน package <change>
- **THEN** package ถูกสร้างจาก packet พร้อมข้อความว่าข้อมูลมีจำกัด

#### Scenario: ไม่พบ change

- **WHEN** รัน package กับ id ที่ไม่มี
- **THEN** exit ไม่เป็นศูนย์ ข้อความระบุ id และไม่เขียนไฟล์

### Requirement: package-labels

ระบบ SHALL ติดป้ายทุก artifact ใน package ว่าเป็น preview, proof หรือยังไม่มีหลักฐาน

#### Scenario: มี receipt ใช้ได้

- **GIVEN** provider test มี receipt ที่ valid
- **WHEN** รัน package
- **THEN** artifact test map ติดป้าย proof

#### Scenario: มีแต่ preview

- **GIVEN** มีเพียง preview receipt
- **WHEN** รัน package
- **THEN** artifact ติดป้าย preview ไม่ใช่ proof

### Requirement: preview-suggestions

ระบบ SHALL แนะนำ preview ที่เหมาะกับงานระดับ High และ Critical ใน package โดยไม่บังคับ

- คำแนะนำมาจาก artifact ที่ต้องรันได้ซึ่ง routeChange() เลือก เช่น concurrency, data-migration, plan-check, browser, resilience
- ถ้ายังไม่มี provider ที่ตรง capability ให้แสดงว่ายังไม่มี provider พร้อมชื่อ capability ที่ต้องประกาศ
- provider ที่ประกาศ external ติดป้ายว่าต้องมี decision-ref
- คำแนะนำไม่บล็อกการอนุมัติหรือ Build

#### Scenario: Critical มี provider

- **GIVEN** change ระดับ Critical ที่เลือก artifact concurrency และ evidence.yaml มี provider ที่มี capability concurrency
- **WHEN** รัน package
- **THEN** ส่วน preview ที่แนะนำแสดง provider นั้นพร้อมคำสั่ง preview ที่ใช้รัน

#### Scenario: ยังไม่มี provider

- **GIVEN** change ระดับ High ที่เลือก artifact data-migration แต่ไม่มี provider ที่มี capability นี้
- **WHEN** รัน package
- **THEN** คำแนะนำแสดงว่ายังไม่มี provider และระบุ capability data-migration

#### Scenario: ระดับ Medium

- **GIVEN** change ระดับ Medium
- **WHEN** รัน package
- **THEN** ไม่มีส่วน preview ที่แนะนำ

#### Scenario: ไม่บล็อก

- **GIVEN** change ระดับ Critical ที่มีคำแนะนำแต่ไม่ได้รัน preview และอนุมัติแล้ว
- **WHEN** advance --through build
- **THEN** Build เริ่มได้

### Requirement: approval-links-package

ระบบ SHALL แสดง path ของ package เมื่อ change รอการอนุมัติ spec

#### Scenario: แนบ package

- **GIVEN** change ที่ยังไม่อนุมัติ
- **WHEN** change start ทำงานสำเร็จ
- **THEN** ผลลัพธ์มี path ของ .foundation/packages/<id>.html

#### Scenario: render ล้มเหลว

- **GIVEN** renderer throw
- **WHEN** change start ทำงานสำเร็จ
- **THEN** ผลลัพธ์มีคำเตือนและยังรออนุมัติด้วย packet เดิม
