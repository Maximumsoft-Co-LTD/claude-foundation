# เอกสาร change ที่อ่านง่าย

## Purpose

เอกสาร change เรียงลำดับสำหรับคน ครบ และไม่ซ้ำ

## ADDED Requirements

### Requirement: Amendments update the investigation agreement in place

ระบบ SHALL แทนที่ส่วน investigation agreement ของ proposal เมื่อ amend แทนการต่อท้ายส่วนใหม่

- ประวัติการ amend: revision, เหตุผล และวันที่
- proposal ที่มีส่วนซ้ำจากรุ่นก่อนถูกรวมเหลือชุดเดียวในการ amend ครั้งถัดไป

#### Scenario: amend สามครั้งเหลือชุดเดียว

- **GIVEN** change ที่มาจาก investigation
- **WHEN** amend สามครั้ง
- **THEN** proposal มีส่วน investigation agreement หนึ่งชุด
- **AND** ประวัติการ amend มีสามบรรทัด

#### Scenario: รวมส่วนซ้ำจากรุ่นก่อน

- **GIVEN** proposal มีส่วน Latest amended investigation agreement สามชุด
- **WHEN** amend อีกครั้ง
- **THEN** proposal เหลือส่วนเดียวที่เป็นปัจจุบัน

#### Scenario: amend ที่ไม่เกี่ยวกับ investigation

- **GIVEN** change ที่ไม่มี investigation
- **WHEN** amend
- **THEN** ไม่มีส่วน investigation agreement เกิดขึ้น

### Requirement: Proposals put reader decisions before reference material

ระบบ SHALL เรียง proposal ให้เนื้อหาสำหรับการตัดสินใจอยู่ก่อนข้อมูลอ้างอิงและข้อมูลสำหรับเครื่อง

#### Scenario: ไม่มี appendix ก่อน Definition of done

- **WHEN** compile draft ที่มีทุกส่วน
- **THEN** appendix ทุกอันอยู่หลัง Definition of done

#### Scenario: ส่วนที่ไม่มีข้อมูลไม่แสดง

- **GIVEN** draft ไม่มี constraints และไม่มี investigation
- **WHEN** compile
- **THEN** ไม่มีหัวข้อข้อจำกัดหรือ appendix investigation

### Requirement: Investigation context appears once in one appendix

ระบบ SHALL แสดงข้อมูลจาก investigation ใน appendix เดียวโดยแต่ละรายการปรากฏครั้งเดียว

#### Scenario: ไม่มีรายการซ้ำ

- **GIVEN** change มาจาก investigation ที่มี 6 requirement
- **WHEN** compile
- **THEN** ข้อความของแต่ละ requirement ปรากฏครั้งเดียวใน proposal

#### Scenario: คำตอบครบ

- **GIVEN** investigation มีคำตอบ ตัวอย่าง และ history gap
- **WHEN** compile
- **THEN** ทุกคำตอบ ตัวอย่าง และ history gap ปรากฏใน appendix

### Requirement: Acceptance traceability uses scenario names grouped by requirement

ระบบ SHALL แสดงตารางเกณฑ์ผ่านด้วยชื่อ scenario จัดกลุ่มตาม requirement เรียง success, boundary แล้ว failure พร้อมชนิด access task check และ decision ที่อ้าง

#### Scenario: ใช้ชื่อ scenario

- **WHEN** compile draft ที่ scenario มีชื่อ
- **THEN** ตารางแสดงชื่อ scenario และไม่แสดง claim id

#### Scenario: เรียงตามชนิด

- **GIVEN** requirement มี failure, success และ boundary
- **WHEN** compile
- **THEN** แถวเรียง success, boundary แล้ว failure

#### Scenario: check ไม่ซ้ำทุกแถว

- **GIVEN** requirement มีห้า scenario ที่ใช้ check ชุดเดียวกัน
- **WHEN** compile
- **THEN** check ปรากฏครั้งเดียวสำหรับ requirement นั้น

### Requirement: Derived file maps state each task's responsibility once

ระบบ SHALL แสดงไฟล์ของ task ในกลุ่มเดียวต่อ task ใน file map ที่ derive โดยอ้าง task ด้วย id และไม่คัดลอก outcome ซึ่งอยู่ที่ tasks.md

#### Scenario: อ้าง task ด้วย id

- **GIVEN** task หนึ่งมี 9 path
- **WHEN** compile
- **THEN** file map แสดง id ของ task กับทั้ง 9 path ครั้งเดียว และ outcome ของ task ไม่ปรากฏใน design.md

#### Scenario: file map ที่ผู้เขียนให้มา

- **GIVEN** draft มี fileMap เอง
- **WHEN** compile
- **THEN** file map แสดงตามที่ผู้เขียนให้มา

### Requirement: Discovery appendix shows authored rows and summarizes derived ones

ระบบ SHALL แสดงแถว discovery coverage ที่ผู้เขียนให้มาเต็ม และสรุปแถวที่ derive เป็นรายชื่อ dimension บรรทัดเดียว

#### Scenario: สรุปแถว derive

- **GIVEN** coverage มี 9 แถว derive และ 2 แถวที่ผู้เขียนให้มา
- **WHEN** compile
- **THEN** ตารางมี 2 แถวและบรรทัดสรุประบุชื่อ dimension ทั้ง 9

### Requirement: Proposal headers carry only stable facts

ระบบ SHALL ให้ส่วนหัวของ proposal แสดงเฉพาะข้อเท็จจริงที่ไม่เปลี่ยนหลังอนุมัติ

#### Scenario: ไม่มี Status ตายตัว

- **WHEN** compile
- **THEN** ส่วนหัวไม่มีบรรทัด Status ที่เป็นข้อความคำสั่ง

#### Scenario: lane ไม่มีวงเล็บซ้อน

- **WHEN** compile change แบบ standard
- **THEN** บรรทัด Lane มีเหตุผลหนึ่งวลีโดยไม่มีวงเล็บซ้อน

### Requirement: User stories use the document language frame

ระบบ SHALL ใช้กรอบ user story และหัวข้อตามภาษาของเอกสาร โดยภาษาไทยใช้ ในฐานะ … ฉันต้องการ … เพื่อ …

#### Scenario: ภาษาไทย

- **GIVEN** draft language th
- **WHEN** compile
- **THEN** story แสดงเป็นประโยคเดียวแบบ ในฐานะ ผู้อนุมัติ ฉันต้องการ อ่านขอบเขต เพื่อ อนุมัติได้เร็ว

#### Scenario: ภาษาอื่นคงเดิม

- **GIVEN** draft language en หรือไม่ระบุ
- **WHEN** compile
- **THEN** story ใช้กรอบ As …, I want … so that …

### Requirement: Compiled packets keep every authored item

ระบบ SHALL มี test ที่ยืนยันว่าเนื้อหาทุกชิ้นจาก draft v4 และ v5 ปรากฏใน packet อย่างน้อยหนึ่งครั้ง

#### Scenario: ทุกชิ้นปรากฏ

- **GIVEN** draft fixture ที่มีทุก field และ investigation
- **WHEN** compile
- **THEN** ทุก requirement, scenario, decision, constraint, non-goal, story และคำตอบปรากฏใน packet

#### Scenario: เนื้อหาหายถูกจับ

- **GIVEN** renderer ทำ non-goal หาย
- **WHEN** รัน test ความครบ
- **THEN** test fail และระบุชิ้นที่หาย

### Requirement: Document budgets favor completeness over trimming

ระบบ SHALL ใช้ soft budget 1200/2000/1200 คำสำหรับงานเล็กและ 2400/3600/2400 คำสำหรับงานอื่น และคำเตือนที่ให้ย้ายส่วนซ้ำหรือข้อมูลสำหรับเครื่องไป appendix แทนการตัดเนื้อหา

#### Scenario: budget ใหม่

- **GIVEN** change ขนาดกลาง
- **WHEN** validate
- **THEN** budget เป็น 2400/3600/2400

#### Scenario: ข้อความเตือนใหม่

- **GIVEN** proposal ยาวเกิน budget
- **WHEN** validate
- **THEN** คำเตือนบอกให้ย้ายส่วนซ้ำหรือข้อมูลสำหรับเครื่องไป appendix

### Requirement: Change ids stay meaningful for non-Latin intents

ระบบ SHALL สร้าง change id จาก capability และ key ของ requirement แรกเมื่อ draft ไม่มี id และ intent สร้าง slug ได้น้อยกว่าสามคำ

#### Scenario: intent ภาษาไทย

- **GIVEN** draft ไม่มี id, intent ภาษาไทย, capability readable-change-packets และ requirement แรก amendment-replaces
- **WHEN** change start
- **THEN** id เป็น readable-change-packets-amendment-replaces

#### Scenario: draft มี id

- **GIVEN** draft มี id my-change
- **WHEN** change start
- **THEN** id เป็น my-change

### Requirement: The start template guides reader-sized writing and v5 layout

ระบบ SHALL ให้ change start --template มีคำแนะนำการเขียนสำหรับคนอ่าน ตัวอย่าง field ของทุกประเภทงาน และโครงโฟลเดอร์ v5

#### Scenario: template มีคำแนะนำ

- **WHEN** เรียก change start --template
- **THEN** ผลลัพธ์มีคำแนะนำการเขียน ตัวอย่างของทุกประเภทงาน และโครงโฟลเดอร์ v5
