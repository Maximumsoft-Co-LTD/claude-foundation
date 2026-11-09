# ตรวจ UI เทียบกับ prototype

## Purpose

Prototype ที่ผูกกับ change กลายเป็น design reference ที่ Build ต้องอ่านและ Prove ต้องเทียบภาพจริง ตรวจเข้มเป็นค่าเริ่มต้น ข้ามได้ด้วยการตัดสินใจของ user และไม่ block งานก่อน Land

## ADDED Requirements

### Requirement: prototype-bound-reference

ระบบ SHALL คัดลอกไฟล์ prototype ที่ draft อ้างถึงเข้า packet และผูก digest ของไฟล์กับการอนุมัติ

- prototypeSelection รับ covers เป็นรายการ requirement key และ mode เป็น strict หรือ advisory โดยค่าเริ่มต้นคือ strict
- ไฟล์ต้นทางอยู่ได้ทั้งใต้ .foundation/prototypes/ หรือที่อื่นในโปรเจกต์
- ไฟล์ปลายทางอยู่ใต้ openspec/changes/<id>/prototype/

#### Scenario: ผูก prototype จาก investigate

- **GIVEN** draft มี prototypeSelection.reference ชี้ไฟล์ HTML ใต้ .foundation/prototypes/<id>/ และ covers มี requirement key ที่มีอยู่
- **WHEN** รัน change start
- **THEN** packet มีสำเนาไฟล์ใต้ openspec/changes/<id>/prototype/
- **AND** design.md หัวข้อ Selected prototype ลิงก์ไปที่สำเนาใน packet พร้อม mode และ requirement ที่ผูก

#### Scenario: อ้างไฟล์ที่ไม่มีหรืออยู่นอกโปรเจกต์

- **WHEN** prototypeSelection.reference ชี้ไฟล์ที่ไม่มีหรือ resolve ออกนอกโปรเจกต์
- **THEN** change start คืน EDIT ระบุ field prototypeSelection.reference และไม่สร้าง packet

#### Scenario: covers อ้าง requirement ที่ไม่มี

- **WHEN** prototypeSelection.covers มี key ที่ไม่ใช่ requirement ใน draft
- **THEN** change start คืน EDIT ระบุ key ที่ไม่รู้จัก

#### Scenario: prototype ใน packet ถูกแก้หลังอนุมัติ

- **GIVEN** change ได้รับอนุมัติแล้ว
- **WHEN** ไฟล์ใน openspec/changes/<id>/prototype/ ถูกแก้
- **THEN** การอนุมัติเดิมไม่ครอบคลุม packet ที่เปลี่ยน และต้องอนุมัติใหม่เหมือนการแก้ไฟล์ packet อื่น

### Requirement: prototype-build-context

ระบบ SHALL ใส่ไฟล์ prototype ใน contextFiles ของ Build task ที่ cover requirement ที่ prototype ผูกไว้

- prototype เป็นไฟล์อ่านอย่างเดียว ไม่ถูกเพิ่มใน allowedPaths ของ task

#### Scenario: task ที่เกี่ยวข้องได้ prototype

- **GIVEN** prototype covers requirement A และ task T cover A
- **WHEN** advance คืน EDIT ของ T
- **THEN** contextFiles มี path ของ prototype ใน packet
- **AND** allowedPaths ของ T ไม่มี path นั้น

#### Scenario: task ที่ไม่เกี่ยวข้อง

- **GIVEN** task U cover แค่ requirement B ซึ่งไม่อยู่ใน covers ของ prototype
- **WHEN** advance คืน EDIT ของ U
- **THEN** contextFiles ของ U ไม่มี prototype

#### Scenario: change ไม่มี prototype

- **WHEN** advance คืน EDIT ของ change ที่ไม่มี prototypeSelection
- **THEN** contextFiles เหมือนพฤติกรรมเดิมทุกประการ

### Requirement: visual-check-mode

ระบบ SHALL กำหนดให้ capability visual เป็น required เฉพาะ claim ของ requirement ที่ prototype แบบ strict ผูกไว้

#### Scenario: strict เป็นค่าเริ่มต้น

- **GIVEN** prototypeSelection ไม่ระบุ mode และ covers requirement A
- **WHEN** change ถูก compile
- **THEN** claim ของ A ต้องการ capability visual

#### Scenario: advisory รายงานอย่างเดียว

- **GIVEN** prototypeSelection.mode เป็น advisory
- **WHEN** Prove รัน
- **THEN** provider visual รันและรายงานความต่าง แต่ visual ไม่เป็น required และผลไม่ถูกนำไปตัดสินว่า proven หรือไม่

#### Scenario: ไม่มี prototype

- **WHEN** change ไม่มี prototypeSelection
- **THEN** ไม่มี claim ใดต้องการ visual และไม่มี provider visual ถูกเสนอ

#### Scenario: ความต่างแบบ advisory แสดงให้ผู้ใช้เห็น

- **GIVEN** provider visual แบบ advisory มี receipt ที่มีความต่างอย่างน้อยหนึ่งจุด
- **WHEN** Prove จบหรือ Land แสดงรายงาน
- **THEN** ผลของ advance และรายงาน Land ระบุ visual แบบ advisory พร้อมจำนวนและรายการความต่าง
- **AND** ข้อความระบุว่าเป็น advisory และไม่นับเป็นหลักฐานผ่าน

#### Scenario: advisory provider ล้มเหลวกลางทาง

- **WHEN** adapter ของ provider visual แบบ advisory throw หรือ dependency ของมันไม่มีหรือไม่ได้รัน
- **THEN** provider ที่ required ยังรันและบันทึก receipt ครบ และ proof ไม่ถูกยกเลิก

### Requirement: visual-check-judgement

ระบบ SHALL ให้ agent reviewer เทียบ screenshot ของ UI จริงกับ prototype ใน packet และคืนรายการความต่างที่ระบุหน้าจอ จุดที่ต่าง และความรุนแรง

- screenshot มาจาก artifact ของ provider browser หรือ playwright ของโปรเจกต์
- receipt ผูก digest ของ prototype และ screenshot เป็น inputs เพื่อใช้ซ้ำเมื่อไม่มีอะไรเปลี่ยน

#### Scenario: ภาพตรงกัน

- **GIVEN** screenshot ของทุกหน้าจอที่ผูกตรงกับ prototype
- **WHEN** provider visual รัน
- **THEN** receipt มี status pass และรายการความต่างว่าง

#### Scenario: ภาพไม่ตรง

- **GIVEN** screenshot ปุ่มหลักอยู่คนละตำแหน่งกับ prototype
- **WHEN** provider visual รัน
- **THEN** receipt มี status fail และ finding ระบุหน้าจอ จุดที่ต่าง และ severity

#### Scenario: ไม่มี screenshot

- **WHEN** provider visual รันโดยไม่มี screenshot artifact ของหน้าจอที่ผูก
- **THEN** receipt มี status inconclusive และไม่ถูกนับเป็นผ่าน

#### Scenario: ใช้ผลเดิมเมื่อไม่มีอะไรเปลี่ยน

- **GIVEN** มี receipt visual ที่ผ่านแล้ว
- **WHEN** แก้ไฟล์ที่ไม่อยู่ใน inputs ของ provider visual แล้ว Prove รันอีกครั้ง
- **THEN** receipt visual เดิมถูกใช้ซ้ำโดยไม่เรียก reviewer ใหม่

### Requirement: visual-repair-budget

ระบบ SHALL ซ่อมความต่างด้านภาพเองได้ไม่เกิน 2 รอบ แล้วหยุดซ่อม visual โดยไม่หยุด gate อื่น

#### Scenario: ซ่อมสำเร็จในรอบแรก

- **GIVEN** receipt visual fail มี finding ระดับ major
- **WHEN** Build ซ่อมตาม repair batch แล้ว Prove รันใหม่
- **THEN** receipt visual ผ่าน และไม่มีการถาม user

#### Scenario: ครบ 2 รอบยังไม่ตรง

- **GIVEN** ซ่อม visual มาแล้ว 2 รอบและยังมี finding ระดับ blocker หรือ major
- **WHEN** Prove รอบถัดไป
- **THEN** ระบบไม่สร้าง repair batch ของ visual เพิ่ม และบันทึกรายการ visual drift ที่ค้าง
- **AND** provider และ gate อื่นยังรันและซ่อมต่อตามปกติ

#### Scenario: finding ระดับ minor

- **WHEN** receipt visual มีแค่ finding ระดับ minor
- **THEN** ไม่มี repair batch ของ visual และ minor ถูกรายงานใน proof โดยไม่ถูกนับเป็นผ่านแบบไม่มีความต่าง

### Requirement: visual-drift-decision

ระบบ SHALL ถาม user เรื่อง visual drift ที่ค้างเพียงครั้งเดียวเมื่อ gate อื่นจบแล้ว พร้อมตัวเลือกซ่อมต่อ ยอมรับความต่างพร้อมเหตุผล หรือแก้ agreement

#### Scenario: user ยอมรับความต่าง

- **GIVEN** gate อื่นผ่านหมดและมี visual drift ค้าง
- **WHEN** user เลือกยอมรับพร้อมเหตุผลและ decision-ref
- **THEN** waiver ของ visual ถูกบันทึกพร้อมรายการ finding ที่ยอมรับ
- **AND** proof และรายงาน Land แสดงว่าไม่ตรงแต่ user ยอมรับ ไม่แสดงว่าผ่าน

#### Scenario: user ขอซ่อมต่อ

- **WHEN** user เลือกซ่อมต่อ
- **THEN** ระบบให้ budget visual เพิ่มอีก 2 รอบแล้วกลับเข้า repair

#### Scenario: user แก้ agreement

- **WHEN** user เลือกแก้ agreement ให้ตรงกับงานจริง
- **THEN** ระบบส่งไปที่ change amend และ receipt visual ที่เกี่ยวข้องถูก invalidate

#### Scenario: ยอมรับโดยไม่ให้เหตุผล

- **WHEN** มีการ waive visual โดยไม่มีเหตุผลหรือ decision-ref
- **THEN** ระบบปฏิเสธและไม่บันทึก waiver

#### Scenario: ภาพเปลี่ยนหลังยอมรับ

- **GIVEN** มี waiver ของ visual แล้ว
- **WHEN** ไฟล์ UI ใน workspace เปลี่ยน
- **THEN** waiver เดิมกลายเป็น stale และ visual ถูกตรวจใหม่
