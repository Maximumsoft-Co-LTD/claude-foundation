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

### Requirement: package-tolerates-evidence

ระบบ SHALL เขียน package ต่อพร้อมคำเตือนเมื่ออ่าน evidence หรือ receipt ไม่ได้

#### Scenario: provider ไม่มี adapter

- **GIVEN** evidence.yaml มี provider ที่ไม่มี adapter
- **WHEN** รัน package ผ่าน CLI
- **THEN** exit 0 ไฟล์ package ถูกเขียน และมีคำเตือนที่ระบุ evidence

#### Scenario: evidence.yaml เป็น JSON ที่เสีย

- **GIVEN** evidence.yaml อ่านเป็น JSON ไม่ได้
- **WHEN** รัน package ผ่าน CLI
- **THEN** exit 0 ไฟล์ package ถูกเขียน และมีคำเตือน

#### Scenario: change ที่ไม่มีอยู่

- **WHEN** รัน package กับ id ที่ไม่มี
- **THEN** exit ไม่เป็นศูนย์และไม่เขียนไฟล์

### Requirement: package-content

ระบบ SHALL แสดงเนื้อหาจริงของ agreement ใต้ artifact แต่ละรายการใน package

- เนื้อหามาจาก typed draft ของ revision ปัจจุบันเท่านั้น
- ทุกค่าถูก escape ก่อนใส่ HTML
- artifact ที่ agreement ไม่ได้ประกาศแสดงว่าไม่ได้ประกาศ

#### Scenario: API contract

- **GIVEN** draft มี apiContracts POST /wallets/{account}/withdrawals ที่มี error 409
- **WHEN** รัน package
- **THEN** ส่วน Tech Lead แสดง method, path และ error 409

#### Scenario: test matrix

- **GIVEN** draft มี requirement 2 ข้อ รวม 3 scenario
- **WHEN** รัน package
- **THEN** ส่วน QA แสดง 3 แถวพร้อม given, when, then

#### Scenario: permission matrix

- **GIVEN** draft มี scenario access allow และ deny
- **WHEN** รัน package
- **THEN** ส่วน Security แสดงทั้ง allow และ deny

#### Scenario: ไม่ได้ประกาศ

- **GIVEN** change ระดับ High ที่ไม่มี dataModel
- **WHEN** รัน package
- **THEN** artifact ERD แสดงว่าไม่ได้ประกาศใน agreement

#### Scenario: ค่าที่มี HTML

- **GIVEN** scenario มีข้อความ <script>alert(1)</script>
- **WHEN** รัน package
- **THEN** ข้อความถูก escape และไม่มี script tag ใน HTML

### Requirement: package-preview-output

ระบบ SHALL แสดงสถานะและ output ท้ายของ preview receipt ใต้ artifact ที่ตรง capability

#### Scenario: preview ล้มเหลว

- **GIVEN** preview concurrency ที่มี status fail และ output RACE pays out twice
- **WHEN** รัน package
- **THEN** artifact concurrency แสดงสถานะ fail และข้อความ RACE pays out twice

#### Scenario: preview เก่า

- **GIVEN** preview ของ revision ก่อนหน้า
- **WHEN** รัน package
- **THEN** output แสดงพร้อมระบุว่า stale

#### Scenario: output มี HTML

- **GIVEN** output ของ preview มี <img src=x onerror=alert(1)>
- **WHEN** รัน package
- **THEN** output ถูก escape และไม่มี img tag

### Requirement: archived-proof-labels

ระบบ SHALL ติดป้าย proof จาก receipt ที่ผ่านของ change ที่ archive หรือ apply แล้ว โดยไม่ตรวจ sandbox ที่ถูกลบ

#### Scenario: archive แล้วผ่าน

- **GIVEN** change ที่ archived โดย land.assurance ผ่านและ receipt test มี status pass
- **WHEN** รัน package
- **THEN** artifact test map ติดป้าย proof และไม่มีคำเตือน

#### Scenario: archive แต่ receipt ไม่ผ่าน

- **GIVEN** change ที่ archived แต่ receipt test มี status fail
- **WHEN** รัน package
- **THEN** artifact test map ไม่ติดป้าย proof

### Requirement: failure-table-filter

ระบบ SHALL แสดงใต้ artifact concurrency และ retry เฉพาะ failure scenario ที่เกี่ยวกับการทำงานพร้อมกันหรือการลองใหม่

#### Scenario: กรองตรง

- **GIVEN** failure scenario 3 ข้อ ซึ่งมีข้อเดียวพูดถึงการส่งพร้อมกัน
- **WHEN** รัน package
- **THEN** artifact concurrency แสดงแถวเดียว

#### Scenario: ไม่มีที่ตรง

- **GIVEN** ไม่มี failure scenario ที่พูดถึงการทำงานพร้อมกัน
- **WHEN** รัน package
- **THEN** artifact concurrency บอกว่าไม่มี scenario ที่ตรง

### Requirement: router-path-signals

ระบบ SHALL ยกระดับความเสี่ยงและ lane อนุมัติจาก path ที่ task แตะ เมื่อ path บอก signal ที่ draft ไม่ได้ประกาศ

- ใช้กับระดับความเสี่ยง domain artifact และ lane อนุมัติเท่านั้น ไม่เปลี่ยน discovery หรือ review
- migrations/ schema prisma และ .sql ให้ persisted-data-change; auth permission rbac ให้ access-control; payment billing refund checkout wallet ให้ financial; tsx jsx vue css และ components pages ให้ user-interface; .tf terraform k8s helm Dockerfile และ .github/workflows ให้ high-operational-risk; webhook ให้ external-integration

#### Scenario: migration ที่ไม่ประกาศ

- **GIVEN** workType bugfix impact medium ไม่มี riskSignals และ task แตะ migrations/003_add_status.sql
- **WHEN** เรียก routeChange
- **THEN** ระดับเป็น High และ reasons มี path:migrations/003_add_status.sql→persisted-data-change

#### Scenario: path ปกติ

- **GIVEN** task แตะ src/util/format.js
- **WHEN** เรียก routeChange
- **THEN** ไม่มี signal จาก path

#### Scenario: lane จาก path

- **GIVEN** approval.roles มี security และ task แตะ src/auth/session.js ที่ draft ไม่ประกาศ access-control
- **WHEN** advance --through build โดยอนุมัติแค่ tech-lead
- **THEN** advance ถามหา lane security
