# Approval package

หน้า HTML อ่านอย่างเดียวที่ผู้อนุมัติใช้ตัดสิน change ก่อน Build และเทียบผลจริงหลัง Build

## ADDED Requirements

### Requirement: scratch-summary

ระบบ SHALL แสดงสรุป จะได้อะไร ของเดิม ของใหม่ และถ้าพลาด จาก draft.scratch บนสุดของ package

- scratch มี get, asIs, toBe, ifFail เป็นข้อความบรรทัดเดียวไม่เกิน 240 ตัวอักษร
- ทุกช่องไม่บังคับ

#### Scenario: มี scratch ครบ

- **GIVEN** draft.scratch มี get, asIs, toBe และ ifFail
- **WHEN** รัน package <change>
- **THEN** ส่วนบนสุดแสดงทั้ง 4 ข้อความตามลำดับ

#### Scenario: ไม่มี scratch

- **GIVEN** draft ไม่มี scratch
- **WHEN** รัน package <change>
- **THEN** ส่วนบนสุดแสดง intent และข้อความว่ายังไม่ได้เขียนสรุป

#### Scenario: ข้อความยาวเกิน

- **GIVEN** scratch.get ยาว 241 ตัวอักษร
- **WHEN** รัน change start
- **THEN** intake คืน EDIT ที่ระบุ scratch.get และขีดจำกัด 240

#### Scenario: scratch ไม่ใช่ object

- **GIVEN** scratch เป็นข้อความ
- **WHEN** รัน change start
- **THEN** intake คืน EDIT ที่ระบุ scratch ต้องเป็น object

### Requirement: scratch-examples

ระบบ SHALL render draft.examples เป็นบล็อกตามชนิดที่รองรับทั้ง 29 ชนิด

- ชนิด: prototype examples api timeline dataDiff lineage mermaid failures permission plan snapshot repro perf golden adr rollout apiDiff strings alert privacy coverage consumers messages terminal doc pipeline search report diffSummary
- ทุกค่าถูก escape ยกเว้นไม่มีช่องใดรับ HTML ดิบ
- prototype อ้างไฟล์ใน .foundation/previews ของ change เท่านั้น

#### Scenario: ตัวอย่าง API สองกรณี

- **GIVEN** examples มี api ที่มี case 201 และ 409
- **WHEN** รัน package
- **THEN** บล็อกแสดง request และ response ของทั้งสอง case และเลือก case ได้โดยไม่ใช้ script

#### Scenario: ชนิดไม่รู้จัก

- **GIVEN** examples[0].type เป็น video
- **WHEN** รัน change start
- **THEN** intake คืน EDIT ที่ระบุ examples[0].type และรายชื่อชนิดที่รองรับ

#### Scenario: ขาดช่องบังคับ

- **GIVEN** examples[1] ชนิด api ไม่มี endpoints
- **WHEN** รัน change start
- **THEN** intake คืน EDIT ที่ระบุ examples[1].endpoints

#### Scenario: ค่าที่มี HTML

- **GIVEN** ตัวอย่างมีข้อความ <img src=x onerror=alert(1)>
- **WHEN** รัน package
- **THEN** ข้อความแสดงเป็นตัวอักษรและไม่มี element img จากข้อความนั้น

#### Scenario: prototype ชี้นอก previews

- **GIVEN** prototype.path เป็น ../../secret.html
- **WHEN** รัน change start
- **THEN** intake คืน EDIT ว่า path ต้องอยู่ใน .foundation/previews/<change>/

#### Scenario: ครบ 29 ชนิด

- **GIVEN** draft มีตัวอย่างหนึ่งบล็อกต่อชนิดครบ 29 ชนิด
- **WHEN** รัน package
- **THEN** มี 29 บล็อกและไม่มีบล็อกที่ว่าง

### Requirement: example-actual

ระบบ SHALL แสดงผลจริงหลัง Build ของแต่ละตัวอย่างจาก receipt หรือ preview ที่ capability ตรงกัน

- example.capability ไม่บังคับ
- proof เฉพาะ receipt ที่ valid และ pass
- ไม่มีผลแสดงว่ายังไม่มีผลพร้อมสิ่งที่จะเทียบจาก postBuild

#### Scenario: มี receipt ผ่าน

- **GIVEN** ตัวอย่าง capability browser และ receipt ของ provider browser valid และ pass พร้อม artifact screenshot.png
- **WHEN** รัน package หลัง Prove
- **THEN** แท็บผลจริงติดป้าย proof และลิงก์ artifact

#### Scenario: มีแค่ preview

- **GIVEN** มี preview receipt capability browser ของ revision ปัจจุบัน
- **WHEN** รัน package
- **THEN** แท็บผลจริงติดป้าย preview แสดง outputTail และลิงก์ artifact

#### Scenario: preview เก่า

- **GIVEN** preview receipt มาจาก revision ก่อนหน้า
- **WHEN** รัน package
- **THEN** แท็บผลจริงติดป้าย preview เก่า

#### Scenario: ยังไม่มีผล

- **GIVEN** ไม่มี receipt หรือ preview ของ capability นั้น
- **WHEN** รัน package
- **THEN** แท็บผลจริงแสดง ยังไม่มีผล และข้อความ postBuild

#### Scenario: receipt ล้ม

- **GIVEN** receipt ของ capability นั้น status fail
- **WHEN** รัน package
- **THEN** แท็บผลจริงติดป้าย ไม่ผ่าน และไม่ติดป้าย proof

### Requirement: package-language

ระบบ SHALL แสดงหัวข้อและป้ายของ package เป็นภาษาไทยเมื่อ draft.language เป็น th และภาษาอังกฤษในกรณีอื่น

#### Scenario: ภาษาไทย

- **GIVEN** draft.language เป็น th
- **WHEN** รัน package
- **THEN** หัวข้อ จะได้อะไร และป้าย ยังไม่มีผล เป็นภาษาไทย และ html lang เป็น th

#### Scenario: ภาษาอื่น

- **GIVEN** draft.language เป็น ja
- **WHEN** รัน package
- **THEN** หัวข้อเป็นภาษาอังกฤษ

### Requirement: package-offline-diagrams

ระบบ SHALL render diagram ด้วย Mermaid ในเครื่องโดยไม่โหลดอะไรจากภายนอก

- script element เดียวใน package โหลด .claude/harness/vendor/mermaid.min.js แบบ relative
- ไม่มี inline script และไม่มี URL http หรือ https
- เมื่อไม่มีไฟล์ vendor diagram ยังแสดงเป็นข้อความ Mermaid

#### Scenario: มีไฟล์ vendor

- **GIVEN** change มี diagram 2 อัน และไฟล์ vendor อยู่ครบ
- **WHEN** เปิด package ในเบราว์เซอร์จากไฟล์ในเครื่อง
- **THEN** diagram ทั้ง 2 อันแสดงเป็น svg

#### Scenario: ไม่มีไฟล์ vendor

- **GIVEN** ไฟล์ vendor ถูกลบ
- **WHEN** เปิด package
- **THEN** diagram แสดงเป็นข้อความ Mermaid ที่อ่านได้และหน้าไม่ error

#### Scenario: ไม่มี script อื่น

- **GIVEN** draft มีข้อความ <script>alert(1)</script> ในทุกช่องข้อความ
- **WHEN** รัน package
- **THEN** HTML มี script element เดียวที่ src ชี้ไฟล์ vendor และไม่มี http:// หรือ https://

### Requirement: scratch-nudges

ระบบ SHALL เตือนแบบไม่บล็อกตอน change start เมื่อ draft ขาดตัวอย่าง เป้า หรือตัวเลขผลกระทบ

- ขึ้นต้นด้วย NOTE: scratch และไม่เปลี่ยนบรรทัด NOTE: coverage
- ตรวจเฉพาะ impact medium หรือ high

#### Scenario: ไม่มีตัวอย่าง

- **GIVEN** draft impact medium ไม่มี examples
- **WHEN** รัน change start
- **THEN** พิมพ์ NOTE: scratch ที่บอกว่าไม่มีตัวอย่างจริง และ change ถูกสร้าง

#### Scenario: performance ไม่มีเป้า

- **GIVEN** workType performance ไม่มีตัวอย่าง perf ที่มี target และ successMeasure ไม่มีตัวเลข
- **WHEN** รัน change start
- **THEN** NOTE: scratch บอกว่าไม่มีตัวเลขเป้า

#### Scenario: bugfix ไม่มีตัวเลขผลกระทบ

- **GIVEN** workType bugfix และ scratch.asIs ไม่มีตัวเลข
- **WHEN** รัน change start
- **THEN** NOTE: scratch บอกว่าไม่มีจำนวนที่ได้รับผลกระทบ

#### Scenario: impact low

- **GIVEN** draft impact low ไม่มี examples
- **WHEN** รัน change start
- **THEN** ไม่มี NOTE: scratch

#### Scenario: ครบแล้ว

- **GIVEN** draft impact high มี examples และ scratch.asIs มีตัวเลข
- **WHEN** รัน change start
- **THEN** ไม่มี NOTE: scratch

### Requirement: router-domain-precision

ระบบ SHALL เลือก domain ตามที่เก็บข้อมูล ชนิดตัวอย่าง และสิทธิ์อย่างแม่นยำ

- dataModel ทุกแถวมี store browser ไม่ทำให้ได้ domain Data Migration และไม่นับ persisted-data-change เป็น signal หนัก
- domain Reporting ต้องมีตัวอย่าง report หรือ search หรือ data กับ ui ที่ไม่มี api feature และ persisted-data-change
- access-control ทำให้ได้ domain Security พร้อม threat model

#### Scenario: kanban ใน localStorage

- **GIVEN** workType feature ui data riskSignals user-interface persisted-data-change impact medium และ dataModel ทุกแถว store browser
- **WHEN** เรียก routeChange()
- **THEN** ระดับเป็น Medium และไม่มี domain 15 และไม่มีบทบาท devops

#### Scenario: migration ฝั่ง server

- **GIVEN** workType data migration riskSignals persisted-data-change และ dataModel ไม่ระบุ store
- **WHEN** เรียก routeChange()
- **THEN** มี domain 15 และระดับเป็น High

#### Scenario: app CRUD ไม่ใช่รายงาน

- **GIVEN** workType feature ui data riskSignals persisted-data-change
- **WHEN** เรียก routeChange()
- **THEN** ไม่มี domain 17

#### Scenario: รายงานจริง

- **GIVEN** workType data ui ไม่มี api
- **WHEN** เรียก routeChange()
- **THEN** มี domain 17

#### Scenario: สิทธิ์ได้ threat model

- **GIVEN** riskSignals access-control
- **WHEN** เรียก routeChange()
- **THEN** มี domain 23 และ artifact threat

## MODIFIED Requirements

### Requirement: package-render

ระบบ SHALL สร้าง approval package HTML แบบอ่านอย่างเดียวจาก change ที่ compile แล้ว

- อ่าน state.draftSource เมื่อ contractRevision ตรงกับ state เท่านั้น
- HTML ไม่โหลดอะไรผ่านเครือข่าย ไฟล์เดียวที่โหลดคือ Mermaid ของ harness ในเครื่องแบบ relative และ diagram แสดง source ที่อ่านได้เมื่อโหลดไม่ได้
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
- **THEN** ข้อความถูก escape
- **AND** script element เดียวใน HTML คือไฟล์ Mermaid ของ harness
