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
- **THEN** ข้อความถูก escape
- **AND** script element เดียวใน HTML คือไฟล์ Mermaid ของ harness

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

### Requirement: decision-first-page

หน้า approval package SHALL แสดงสรุป ความเสี่ยง และผลของการอนุมัติก่อนรายละเอียดเทคนิค

#### Scenario: สรุปมาก่อน

- **GIVEN** draft มี scratch ครบ 4 บรรทัด
- **WHEN** เรนเดอร์หน้า package
- **THEN** ลำดับในหน้าคือ หัว ความเสี่ยง สรุป 4 บรรทัด แถบขอบเขต ตัวอย่าง รายละเอียดผู้ตรวจ แถบตัดสินใจ

#### Scenario: ไม่มี scratch

- **GIVEN** draft ไม่มี scratch
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงกรอบเตือนว่ายังไม่มีสรุปและแสดง intent แทน

#### Scenario: ไม่ทราบตัวเลขขอบเขต

- **GIVEN** draft ไม่มี tasks paths หรือ openQuestions ที่นับได้
- **WHEN** เรนเดอร์แถบขอบเขต
- **THEN** ตัวเลขนั้นแสดงว่า ไม่ทราบ ไม่ใช่ 0

### Requirement: reviewer-details-collapsed

หน้า package SHALL พับตาราง role โดเมน test map API diagram และ preview ไว้ในส่วนเดียวที่ปิดตั้งต้น

#### Scenario: พับรายละเอียด

- **WHEN** เรนเดอร์หน้า package ของ change ที่มี role tables และ diagram
- **THEN** ทั้งหมดอยู่ใน details เดียวที่ไม่มี attribute open และ summary บอกจำนวนที่ซ่อน

#### Scenario: ไม่มีไฟล์ mermaid

- **GIVEN** ไฟล์ mermaid.min.js หาย
- **WHEN** เรนเดอร์หน้าที่มี diagram
- **THEN** diagram แสดงเป็นข้อความ Mermaid และหน้ายังเรนเดอร์ได้

### Requirement: copyable-decision-bar

หน้า package SHALL มีแถบตัดสินใจที่แสดงประโยคตอบอ่านอย่างเดียวและผลของการอนุมัติโดยไม่เพิ่ม script

#### Scenario: ยังไม่อนุมัติ

- **GIVEN** spec ยังไม่ได้อนุมัติ
- **WHEN** เรนเดอร์แถบตัดสินใจ
- **THEN** แสดงประโยคตอบสำหรับ อนุมัติ ขอแก้ ปฏิเสธ ใน textarea readonly และข้อความว่าอนุมัติคือเริ่ม Build ในพื้นที่แยก

#### Scenario: อนุมัติแล้ว

- **GIVEN** spec อนุมัติแล้วและ revision ไม่เปลี่ยน
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงว่าอนุมัติแล้วและไม่แสดงประโยคตอบให้คัดลอก

#### Scenario: lane ยังไม่ครบ

- **GIVEN** ตั้ง approval.roles และบาง role ยังไม่อนุมัติ
- **WHEN** เรนเดอร์แถบตัดสินใจ
- **THEN** แสดงรายชื่อ role ที่ขาดเหนือแถบ และไม่บอกว่าอนุมัติแล้ว

#### Scenario: ไม่มี script เพิ่ม

- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่มี script นอกจาก mermaid ของ harness และไม่มี event handler

### Requirement: scratch-required-medium

change start SHALL คืน EDIT ที่ระบุ path scratch เมื่อ draft ระดับ medium หรือ high ไม่มี scratch ครบ 4 บรรทัด

#### Scenario: medium ไม่มี scratch

- **GIVEN** draft impact medium ไม่มี scratch
- **WHEN** รัน change start
- **THEN** คืน EDIT ที่ระบุ scratch.get scratch.asIs scratch.toBe scratch.ifFail ที่ขาด และไม่เริ่ม change

#### Scenario: low ไม่มี scratch

- **GIVEN** draft impact low ไม่มี scratch
- **WHEN** รัน change start
- **THEN** เริ่ม change ได้ตามเดิม

#### Scenario: change เดิมที่อนุมัติแล้ว

- **GIVEN** change ที่เริ่มหรืออนุมัติแล้วไม่มี scratch
- **WHEN** รัน advance หรือ change amend ที่ไม่ได้ revise draft
- **THEN** ไม่ถูกบล็อกด้วยกฎ scratch

### Requirement: chat-approval-card

คำสั่ง change และ skill change SHALL ให้ agent ถามอนุมัติ spec ผ่านการ์ดสั้นพร้อมตัวเลือก อนุมัติ อนุมัติพร้อมแก้ ขอดูละเอียด ปฏิเสธ โดยคงคำสั่ง advance เดิม

#### Scenario: ถามด้วยการ์ด

- **WHEN** agent ถึงขั้นขออนุมัติ spec
- **THEN** คำสั่งระบุให้ถามด้วยสรุป 4 บรรทัดและตัวเลือกทั้งสี่ และบันทึกด้วย advance --approve-spec --decision-ref เดิม

#### Scenario: ใช้ถ้อยคำเดิม

- **WHEN** ผู้ใช้ตอบ ลุยเลย หรือ approve
- **THEN** ยังนับเป็นการอนุมัติตาม WORKFLOW.md โดยไม่ถามซ้ำ

### Requirement: risk-meter

หน้า package SHALL แสดงระดับความเสี่ยงเป็นแถบ 4 ระดับพร้อมคำกำกับ และเหตุผลของระดับนั้นเป็นรายการสั้น

#### Scenario: ระดับสูงสุด

- **GIVEN** route ได้ระดับ Critical พร้อมเหตุผล
- **WHEN** เรนเดอร์หน้า package
- **THEN** แถบเต็ม 4 ช่อง คำว่าวิกฤตถูกเน้น และเหตุผลแต่ละข้อเป็นรายการแยก

#### Scenario: ระดับต่ำ

- **GIVEN** route ได้ระดับ Low
- **WHEN** เรนเดอร์หน้า package
- **THEN** แถบเต็ม 1 ช่อง และบอกระดับเป็นคำและสัญลักษณ์ ไม่ใช้สีอย่างเดียว

#### Scenario: ไม่มีเหตุผล

- **GIVEN** route ไม่มีเหตุผลของระดับ
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงแถบและคำกำกับโดยไม่แสดงรายการเหตุผลว่าง

### Requirement: before-after-and-questions

หน้า package SHALL แสดงก่อน-หลังเป็นการ์ดคู่ และแสดงตัวข้อความของคำถามที่ค้างอยู่ในกล่องเด่นเหนือแถบตัดสินใจ

#### Scenario: มีคำถามค้าง

- **GIVEN** draft มี openQuestions 1 ข้อ
- **WHEN** เรนเดอร์หน้า package
- **THEN** กล่องคำถามแสดงข้อความของคำถามนั้นและจำนวนในหัวกล่อง

#### Scenario: ไม่มีคำถามค้าง

- **GIVEN** draft ระบุ openQuestions เป็นรายการว่าง
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงกล่องคำถาม

#### Scenario: คำถามเป็นข้อความอันตราย

- **GIVEN** ข้อความคำถามมีเครื่องหมาย HTML
- **WHEN** เรนเดอร์หน้า package
- **THEN** ข้อความถูก escape และแสดงเป็นตัวอักษร

#### Scenario: ไม่มีสรุปก่อน-หลัง

- **GIVEN** scratch ไม่มี asIs และ toBe
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงการ์ดก่อน-หลังที่ว่าง และคำเตือนเรื่องสรุปที่ขาดยังแสดง

### Requirement: failure-cards

หน้า package SHALL แสดงกรณีพลาดจาก scenario ชนิด failure เป็นการ์ดที่มีสาเหตุ ผลที่เห็น และวิธีกู้คืน

#### Scenario: มี failure scenario

- **GIVEN** requirements มี failure scenario 2 ข้อที่มี when then recovery
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ด 2 ใบ ใบละหนึ่ง scenario โดยมีสาเหตุ ผลที่เห็น และวิธีกู้คืน

#### Scenario: ไม่มี recovery

- **GIVEN** failure scenario ไม่มี recovery
- **WHEN** เรนเดอร์การ์ด
- **THEN** ไม่แสดงช่องวิธีกู้คืนที่ว่าง

#### Scenario: ไม่มี failure scenario

- **GIVEN** requirements ไม่มี failure scenario
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงส่วนกรณีพลาด และแถบขอบเขตแสดงจำนวนตามจริง

### Requirement: mobile-decision-bar

หน้า package SHALL แสดงแถบตัดสินใจเป็นแถบปกติท้ายหน้าที่ความกว้าง 640px หรือน้อยกว่า และคงแถบติดขอบล่างที่กว้างกว่านั้น

#### Scenario: มือถือ

- **WHEN** เรนเดอร์หน้า package
- **THEN** CSS มี media query ที่ 640px ซึ่งตั้งแถบตัดสินใจเป็น position static

#### Scenario: ไม่มี script

- **WHEN** เรนเดอร์หน้า package ที่ไม่มี diagram
- **THEN** ไม่มี script form button หรือ event handler ในหน้า

### Requirement: type-cards

หน้า package SHALL จับ work type ที่ draft ประกาศหรืออนุมานเป็นแบบ A ถึง G และแสดงการ์ดของแต่ละแบบที่ตรงกันพร้อมข้อมูลเฉพาะชนิดจาก draft

#### Scenario: แบบข้อมูล

- **GIVEN** workType เป็น migration และ draft มี migrationPlan กับ rollout
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ E ที่มี จาก ถึง cutover rollbackWindow และ rollback ของ rollout

#### Scenario: หลายชนิด

- **GIVEN** workType เป็น feature และ api และ data
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ E ก่อน แบบ D และแบบ A ตามลำดับคงที่ ไม่แสดงซ้ำ

#### Scenario: ชนิดงานเบา

- **GIVEN** workType เป็น docs
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ C ที่มีแต่สรุป และไม่แสดงรายการตรวจของส่วนที่ไม่บังคับ

#### Scenario: ข้อมูลเฉพาะชนิดหาย

- **GIVEN** workType เป็น privacy แต่ draft ไม่มี privacyAssessment
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ดแบบ G แสดง ไม่ทราบ ที่ช่องที่ขาดและไม่ใส่ค่าที่เดาเอง

### Requirement: required-checklist

หน้า package SHALL แสดงรายการตรวจของส่วนที่บังคับตาม requiredDevSections เป็น ✓ หรือ ✕ ต่อส่วน และแยกส่วนแนะนำที่ยังไม่บังคับด้วยป้ายต่างหาก

#### Scenario: ส่วนบังคับครบ

- **GIVEN** bugfix มี reproduction rootCause regression
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** ทุกส่วนบังคับเป็น ✓

#### Scenario: ส่วนบังคับขาด

- **GIVEN** bugfix ไม่มี regression
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** ส่วน bugfix เป็น ✕ และระบุว่าขาดอะไร

#### Scenario: ส่วนแนะนำ

- **GIVEN** ml draft ไม่มี evaluation
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** evaluation แสดงด้วยป้าย แนะนำ ไม่ใช่ ✕ และไม่เปลี่ยนผลการ validate ของ draft

#### Scenario: ไม่มีส่วนบังคับ

- **GIVEN** draft ไม่ประกาศ workType และอนุมานไม่ได้
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงรายการตรวจ

### Requirement: scratch-undo-who

draft SHALL รับ scratch.undo และ scratch.who เป็นฟิลด์เสริมหนึ่งบรรทัด และการ์ดแสดงสองบรรทัดนี้โดยไม่ทำให้ draft เดิมตก

#### Scenario: ระบุครบ

- **GIVEN** scratch มี undo และ who
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ดแสดงทั้งสองบรรทัดจากค่าที่ผู้เขียนระบุ

#### Scenario: ไม่ระบุ

- **GIVEN** draft เดิมไม่มี undo และ who
- **WHEN** start หรือ revise draft ระดับ medium ที่มี scratch 4 บรรทัดเดิม
- **THEN** ผ่านการตรวจเหมือนเดิม และการ์ดดึงค่าจาก rollout.rollback dataModel.rollback rollbackPin หรือ userStories.asA ถ้ามี ไม่เช่นนั้นแสดง ไม่ทราบ

#### Scenario: รูปแบบผิด

- **GIVEN** scratch.undo เป็นหลายบรรทัดหรือยาวเกิน 240 ตัวอักษร
- **WHEN** รัน change start
- **THEN** คืน EDIT ระบุ scratch.undo ตามกฎเดียวกับฟิลด์ scratch เดิม

### Requirement: thai-readable

หน้า package SHALL ใช้ฟอนต์ sans ที่มีอักษรไทยในเครื่องเรียงตามลำดับ Sukhumvit Set, Leelawadee UI, Noto Sans Thai, Thonburi, Tahoma ขนาดฐานอย่างน้อย 17px และไม่ใช้ฟอนต์ serif กับข้อความไทย

#### Scenario: stack ฟอนต์

- **WHEN** เรนเดอร์หน้า package
- **THEN** CSS ระบุ font-family ตามลำดับที่กำหนดและไม่มี @import url หรือ link ไปฟอนต์ภายนอก

#### Scenario: ไม่มีฟอนต์ไทยในเครื่อง

- **GIVEN** เครื่องไม่มีฟอนต์ไทยใดใน stack
- **WHEN** เปิดหน้า package
- **THEN** เบราว์เซอร์ใช้ฟอนต์ไทยสำรองของระบบและหน้ายังอ่านได้
