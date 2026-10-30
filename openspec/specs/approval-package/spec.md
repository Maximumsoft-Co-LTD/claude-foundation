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

### Requirement: approval-data

คำสั่ง package SHALL พิมพ์ข้อมูลของ change เป็น JSON ได้แก่ ระดับความเสี่ยงพร้อมเหตุผล domain artifact ตาม role พร้อมป้ายหลักฐาน คำแนะนำ preview บรรทัด scratch รวม undo และ who รายการตรวจ section ที่บังคับ บรรทัดสถานะการอนุมัติ รายการที่หน้าต้องแสดง สถานะ covers สถานะ drift และ factsDigest โดย SHALL NOT เขียนไฟล์ HTML

#### Scenario: พิมพ์ข้อมูลครบ

- **GIVEN** change ระดับ Medium ที่มี draft และ receipt บางส่วน
- **WHEN** รัน claude-foundation package <change>
- **THEN** ได้ JSON ที่มีทุกหัวข้อข้างต้น และไม่มีไฟล์ HTML ถูกเขียนหรือเขียนทับใน .foundation/packages

#### Scenario: ค่าที่ไม่ทราบ

- **GIVEN** draft ไม่มี tasks paths และไม่มี openQuestions ที่นับได้
- **WHEN** รัน package
- **THEN** ตัวเลขนั้นเป็น unknown ไม่ใช่ 0 และไม่มีค่าที่เดา

#### Scenario: อ่าน evidence บางส่วนไม่ได้

- **GIVEN** receipt หนึ่งรายการอ่านไม่ได้
- **WHEN** รัน package
- **THEN** ได้ JSON ที่มี warnings ระบุรายการนั้นและข้อมูลส่วนอื่นยังอยู่

#### Scenario: change ที่ไม่มี draft แบบ typed

- **GIVEN** change เก่าที่ไม่มี typed draft
- **WHEN** รัน package
- **THEN** ได้ JSON ที่ระบุว่าข้อมูลจำกัดและช่องที่ไม่มีเป็น unknown

### Requirement: approval-page-authored-by-skill

harness SHALL NOT สร้างหรือเขียนทับหน้าอนุมัติ HTML ในทุกคำสั่ง และคำถามอนุมัติ SHALL ระบุ path ของหน้าที่ skill prototype เขียนไว้เมื่อไฟล์นั้นมีอยู่ มิฉะนั้น SHALL แสดงสรุปเป็นข้อความและบอกให้ใช้ skill prototype โดยไม่กั้น

#### Scenario: มีหน้าแล้ว

- **GIVEN** มีไฟล์ .foundation/previews/<change>/prototype.html และ draft ชี้ไฟล์นั้นเป็น example ชนิด prototype
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความเรียก หน้าอนุมัติ พร้อม path ของไฟล์นั้น

#### Scenario: ยังไม่มีหน้า

- **GIVEN** ไม่มีไฟล์หน้าอนุมัติของ change นี้
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความแสดงสรุป 4 บรรทัดเป็นข้อความและบอกว่ายังไม่มีหน้าอนุมัติให้ใช้ skill prototype และไม่หยุดการถาม

#### Scenario: ไม่เขียนไฟล์หน้า

- **GIVEN** รัน change start advance หรือ package
- **WHEN** คำสั่งทำงานจนเสร็จ
- **THEN** ไม่มีไฟล์ HTML ถูกสร้างหรือเขียนทับใน .foundation/packages และไฟล์เก่าที่มีอยู่ไม่ถูกแก้

#### Scenario: ตัวอย่างใน draft ยังถูกตรวจ

- **GIVEN** draft มี example ชนิดที่ไม่รู้จัก
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุ path ของ example นั้นตามเดิม และ harness ไม่เรนเดอร์ example ใด

### Requirement: prototype-checklist

ข้อมูลของ package และผลของ change start SHALL บอกรายการสิ่งที่หน้าอนุมัติของ change นี้ต้องแสดง โดยอนุมานจาก work type และฟิลด์ใน draft เท่านั้น ครอบคลุมทุก work type ที่ catalog ประกาศ และ SHALL NOT กั้น change start Build Prove หรือ Land

#### Scenario: งาน API

- **GIVEN** workType เป็น api และ draft มี apiContracts ที่มี error 400 เมื่อ title ว่าง
- **WHEN** รัน package
- **THEN** รายการมี แผง API ที่แสดง request response และกรณี error 400 พร้อม เส้นทางผู้ใช้ กรณีพลาดพร้อม recovery และ ก่อน-หลัง

#### Scenario: งานข้อมูล

- **GIVEN** workType เป็น migration และ draft มี migrationPlan กับ rollout
- **WHEN** รัน package
- **THEN** รายการมี schema ก่อน-หลัง ลำดับปล่อย และ rollback

#### Scenario: งานหน้าจอ

- **GIVEN** workType เป็น ui และ uiStates มี loading empty error success
- **WHEN** รัน package
- **THEN** รายการระบุว่าต้องแสดงครบทุกสถานะของทุกหน้าจอที่ draft ระบุ

#### Scenario: ครบทุก work type

- **GIVEN** catalog ประกาศ work type ทั้ง 26 ชนิด
- **WHEN** สร้างรายการของแต่ละชนิดแยกกัน
- **THEN** ทุกชนิดมีรายการอย่างน้อย 1 ข้อ และทุกข้อระบุฟิลด์ใน draft ที่เป็นที่มา หรือเป็นข้อร่วมคือ ก่อน-หลัง

#### Scenario: หลายชนิดรวมกัน

- **GIVEN** workType เป็น feature, api และ data
- **WHEN** รัน package
- **THEN** รายการเป็นผลรวมเรียงลำดับคงที่ ไม่มีข้อซ้ำ และแต่ละข้อบอกที่มา

#### Scenario: ฟิลด์ไม่ระบุ

- **GIVEN** workType เป็น api แต่ draft ไม่มี apiContracts
- **WHEN** รัน package
- **THEN** รายการมีแผง API ที่ต้องมี และระบุว่า draft ยังไม่ระบุ ไม่ประดิษฐ์ endpoint

#### Scenario: งานที่ไม่ต้องมีภาพมาก

- **GIVEN** workType เป็น docs เท่านั้น
- **WHEN** รัน package
- **THEN** รายการมีเฉพาะ ก่อน-หลัง และไม่เตือนว่าขาดอย่างอื่น

#### Scenario: ชนิดใหม่ที่ยังไม่มีรายการ

- **GIVEN** มีคนเพิ่ม work type ใหม่ใน catalog โดยไม่เพิ่มรายการ
- **WHEN** รันชุดทดสอบของ harness
- **THEN** ชุดทดสอบล้มและระบุชื่อชนิดที่ไม่มีรายการ

#### Scenario: ไม่กั้นการเริ่ม

- **GIVEN** draft ประเภท ui ยังไม่มีหน้าอนุมัติ
- **WHEN** รัน change start
- **THEN** พิมพ์ NOTE ที่ระบุรายการที่หน้าต้องแสดง โดยไม่ EDIT ไม่ถามผู้ใช้ และไม่หยุด

### Requirement: prototype-coverage-declared

ตัวอย่างชนิด prototype SHALL ประกาศ covers เป็นรายการ key ของข้อที่ต้องแสดง และข้อมูลของ package SHALL รายงานข้อที่ประกาศครอบคลุม ข้อที่ยังขาด และข้อที่ไม่ทราบ โดยไม่ถือการประกาศเป็น proof

#### Scenario: ครอบคลุมครบ

- **GIVEN** prototype ประกาศ covers ครบทุกข้อในรายการที่ต้องแสดง
- **WHEN** รัน package
- **THEN** ทุกข้อมีสถานะประกาศครอบคลุม และสรุปว่าประกาศครบ

#### Scenario: ยังขาด

- **GIVEN** prototype ไม่ประกาศ covers ของแผง API
- **WHEN** รัน package
- **THEN** ข้อแผง API มีสถานะ ยังขาด พร้อมชื่อข้อ

#### Scenario: ไม่ประกาศ covers

- **GIVEN** prototype ไม่มีฟิลด์ covers
- **WHEN** รัน package
- **THEN** ทุกข้อเป็น unknown และไม่นับว่าครบ

#### Scenario: key ที่ไม่รู้จัก

- **GIVEN** covers มี key ที่ไม่อยู่ในรายการของ change นี้
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุ path ของ key นั้น

#### Scenario: ประกาศไม่ใช่ proof

- **GIVEN** prototype ประกาศ covers ครบแต่ไม่มี receipt ใด
- **WHEN** รัน package หรือ prove หรือ land
- **THEN** ข้อมูลระบุว่าเป็นคำประกาศของ agent ไม่ใช่ proof และ Prove กับ Land ไม่ใช้คำประกาศนั้น

### Requirement: facts-from-harness-only

ระดับความเสี่ยง จำนวน proof และสถานะ role lane SHALL มาจากการคำนวณของ harness เท่านั้น และ harness SHALL NOT อ่านค่าเหล่านี้จากไฟล์หน้าอนุมัติหรือ prototype

#### Scenario: หน้าอ้าง proof เอง

- **GIVEN** ไฟล์หน้าอนุมัติมีข้อความว่าผ่านทุกการทดสอบ แต่ไม่มี receipt ที่ผ่านจริง
- **WHEN** รัน package
- **THEN** จำนวน proof ในข้อมูลไม่เพิ่ม และป้ายหลักฐานของ artifact นั้นเป็น none

#### Scenario: preview ไม่ใช่ proof

- **GIVEN** มี receipt ชนิด preview ของ change นี้
- **WHEN** รัน package
- **THEN** ป้ายเป็น preview ไม่ใช่ proof และ Prove กับ Land ไม่ใช้ receipt นั้น

#### Scenario: ค่าความเสี่ยงมาจาก draft

- **GIVEN** draft ประกาศ impact high และ riskSignals financial
- **WHEN** รัน package
- **THEN** ระดับและเหตุผลคำนวณจาก draft และ path ของ task เท่านั้น

### Requirement: prototype-sync

harness SHALL บันทึก digest ของไฟล์หน้าอนุมัติและ factsDigest ของข้อมูลที่คำนวณทุกครั้งที่ change start revise หรือ amend และข้อมูลของ package กับคำถามอนุมัติ SHALL เตือนเมื่อไฟล์ถูกแก้หลังฉบับล่าสุด หรือเมื่อหน้าไม่มี factsDigest ล่าสุด โดย SHALL NOT กั้น change start Build Prove หรือ Land

#### Scenario: แก้ไฟล์แล้วเตือน

- **GIVEN** บันทึก digest ของ prototype.html ที่ฉบับ 2 แล้วไฟล์ถูกแก้
- **WHEN** รัน package
- **THEN** ข้อมูลมี drift true ระบุว่าถูกแก้หลังฉบับ 2 ให้ตรวจให้ตรงกับ change แล้ว change revise

#### Scenario: revise แล้วหายเตือน

- **GIVEN** ข้อมูลมี drift true
- **WHEN** agent แก้ draft ให้ตรงแล้วรัน change revise
- **THEN** digest ใหม่ถูกบันทึกและ drift เป็น false

#### Scenario: ข้อมูลของ harness ในหน้าล้าสมัย

- **GIVEN** หน้าอ้าง factsDigest เก่าเพราะมี receipt ใหม่หลังจากนั้น
- **WHEN** รัน package
- **THEN** ข้อมูลมี factsStale true และคำถามอนุมัติเตือนให้ skill อัปเดตแถบข้อเท็จจริงในหน้า

#### Scenario: แก้ไฟล์แต่ไม่แก้ change

- **GIVEN** หน้าถูกแก้แต่ change ไม่ถูก revise
- **WHEN** รัน advance หรือ prove
- **THEN** คำเตือนยังอยู่ แต่ไม่ถูกนับเป็น EDIT และไม่หยุดการทำงาน

#### Scenario: ไม่มีไฟล์

- **GIVEN** example ชนิด prototype ชี้ไฟล์ที่ไม่มี
- **WHEN** รัน package
- **THEN** ข้อมูลระบุว่ายังไม่มีไฟล์ และไม่มีคำเตือนเรื่อง drift หรือ facts

#### Scenario: คำเตือนไม่ใช่หลักฐาน

- **GIVEN** มีหรือไม่มีคำเตือนเรื่อง drift หรือ facts
- **WHEN** รัน prove หรือ land
- **THEN** ผลของ Prove และ Land ไม่เปลี่ยนเพราะสถานะนั้น

### Requirement: plain-approval-wording

คำถามอนุมัติ SHALL เรียกหน้านี้ว่า หน้าอนุมัติ ด้วยภาษาธรรมดา และคำสั่ง package SHALL ยังใช้ได้ในฐานะคำสั่งพิมพ์ข้อมูล

#### Scenario: คำถามอนุมัติ

- **GIVEN** draft ภาษา th ที่รอการอนุมัติและมีไฟล์หน้า
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความเรียก หน้าอนุมัติ พร้อม path ไฟล์ และไม่ใช้คำว่า package เป็นชื่อที่ผู้ใช้ต้องรู้

#### Scenario: ใช้คำสั่งเดิม

- **GIVEN** ผู้ใช้หรือ script เรียก package ของ change หนึ่ง
- **WHEN** รัน claude-foundation package <change>
- **THEN** คำสั่งไม่ error และพิมพ์ข้อมูลตาม approval-data
