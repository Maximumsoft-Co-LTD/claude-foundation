# คู่มือ skill

ขั้นตอนใน skill ที่ตรวจได้ ไม่ขัดกฎเดิมและไม่เกิน budget ของบริบท

## ADDED Requirements

### Requirement: approval-page-contract

หน้าอนุมัติที่ skill prototype สร้าง SHALL เรียงหัว แถบข้อเท็จจริงของ harness มุมมองหลักคือ prototype รายการที่ต้องแสดงพร้อมสถานะ ก่อน-หลัง เส้นทาง กรณีพลาดพร้อม recovery undo และ who แล้วรายละเอียดผู้ตรวจที่พับไว้ SHALL เป็นไฟล์เดียวที่ไม่เรียกเครือข่าย SHALL NOT มีฟอร์มหรือปุ่มตัดสินใจ SHALL ใช้ภาษาของ draft และ SHALL อ่านได้ด้วยคีย์บอร์ดโดยไม่พึ่งสีอย่างเดียว

#### Scenario: ลำดับของหน้า

- **GIVEN** skill สร้างหน้าของ change ที่มี scratch ครบและข้อมูลจาก package
- **WHEN** เปิดหน้า
- **THEN** ลำดับคือ หัว แถบข้อเท็จจริง prototype รายการที่ต้องแสดง ก่อน-หลัง เส้นทาง กรณีพลาด undo และ who รายละเอียดผู้ตรวจ

#### Scenario: แถบข้อเท็จจริงคัดลอกจากข้อมูล

- **GIVEN** package พิมพ์ระดับความเสี่ยง proof และ role พร้อม factsDigest
- **WHEN** skill สร้างแถบข้อเท็จจริง
- **THEN** แถบใช้ค่าเดียวกับข้อมูลทุกค่าและมี factsDigest ล่าสุดอยู่ในหน้า

#### Scenario: ค่าที่ไม่ทราบ

- **GIVEN** draft ไม่ระบุฟิลด์ที่ต้องแสดง
- **WHEN** skill สร้างหน้า
- **THEN** ช่องนั้นเขียนว่า ไม่ทราบ ไม่เดาค่าและไม่ประดิษฐ์ข้อมูล

#### Scenario: ป้ายไม่ใช่ proof

- **GIVEN** หน้ามี prototype
- **WHEN** เปิดหน้า
- **THEN** มีป้ายว่าเป็นภาพจำลองไม่ใช่ proof และไม่มีฟอร์มหรือปุ่มตัดสินใจ

#### Scenario: ไม่พึ่งเครือข่าย

- **GIVEN** เครื่องที่เปิดหน้าไม่มีอินเทอร์เน็ต
- **WHEN** เปิดหน้า
- **THEN** หน้าแสดงครบ ฟอนต์ภาพและสคริปต์อยู่ในไฟล์หรือใช้ของระบบ

#### Scenario: ใช้คีย์บอร์ดและไม่พึ่งสี

- **GIVEN** ผู้ใช้ใช้คีย์บอร์ดหรือมองสีไม่ชัด
- **WHEN** สลับสถานะและอ่านระดับความเสี่ยงกับสถานะครอบคลุม
- **THEN** ทุกปุ่มใช้ Tab ได้ และระดับกับสถานะอ่านได้จากคำและสัญลักษณ์

### Requirement: prototype-skill-contract

skill prototype SHALL กำหนดรายการที่ต้องแสดงจากข้อมูลของ package เองโดยไม่ถามผู้ใช้ว่าต้องการแบบไหน

- อ่าน change ก่อนสร้างทุกครั้ง คือ proposal, specs, design, tasks ที่คอมไพล์แล้ว หรือ draft ถ้ายังไม่คอมไพล์ ไม่ใช้ความจำจากแชทแทน
- มีแนวทางครบทุก work type ที่ catalog ประกาศ
- ใช้ design token ของ project นั้นเมื่อมี
- เมื่อหน้าถูกแก้ ต้อง revise หรือ amend change ให้ตรงในรอบเดียวกัน
- เมื่อ host มี skill design หรือ Artifact ชนิด design ต้องสร้างและแก้หน้าบน canvas นั้นเป็นหลัก จัดเป็นเฟรมต่อหน้าจอหรือสถานะ มีเลขลำดับและหัวข้อกลุ่ม
- ส่งออกไฟล์ใน .foundation/previews ทุกครั้งที่สร้างหรือแก้ เพราะ harness ตรวจจากไฟล์นั้น

#### Scenario: อ่าน change ก่อนสร้าง

- **GIVEN** change มี requirement และ scenario ที่คอมไพล์แล้ว และมีเรื่องที่คุยในแชทแต่ไม่อยู่ใน change
- **WHEN** skill ทำงาน
- **THEN** skill อ่านเอกสารของ change ก่อน และทุกอย่างในหน้ามาจาก requirement scenario หรือข้อมูลของ package ส่วนเรื่องที่มีแต่ในแชทไม่ถูกใส่ในหน้า แต่ skill เสนอ change revise

#### Scenario: ยังไม่มี change

- **GIVEN** ผู้ใช้สั่งให้ทำหน้าอนุมัติแต่ยังไม่มี change หรือ draft
- **WHEN** skill ทำงาน
- **THEN** skill ไม่สร้างหน้าจากการเดา และบอกให้ทำ change ก่อน

#### Scenario: รู้เองว่าต้องแสดงอะไร

- **GIVEN** change ประเภท api ที่ draft มี apiContracts และผู้ใช้สั่งให้ทำหน้าอนุมัติ
- **WHEN** skill ทำงาน
- **THEN** skill ใช้รายการจาก package สร้างแผง API ตามนั้นและประกาศ covers โดยไม่ถามว่าต้องการแบบไหน

#### Scenario: ทุก work type มีแนวทาง

- **GIVEN** catalog ประกาศ work type ทั้ง 26 ชนิด
- **WHEN** ตรวจ reference แนวทางตามชนิดงานของ skill
- **THEN** reference ระบุทุกชนิดพร้อมรูปแบบ prototype ที่เหมาะ และชุดทดสอบ catalog ล้มถ้ามีชนิดที่ขาด

#### Scenario: ใช้ design ของ project

- **GIVEN** project มี design token หรือธีมในซอร์ส
- **WHEN** skill สร้างหน้า
- **THEN** หน้าใช้ token นั้นและบอกที่มาไว้ในหน้า ถ้าไม่มี token ใช้ค่ากลางและบอกว่าไม่ใช่ design ของ project

#### Scenario: แก้หน้าแล้วแก้ change

- **GIVEN** ผู้ใช้ขอเพิ่มปุ่มกรองที่ agreement ไม่มี
- **WHEN** skill แก้หน้า
- **THEN** skill revise draft ก่อน Build หรือ amend ระหว่าง Build ให้มี requirement และ scenario ของปุ่มนั้นในรอบเดียวกัน แล้วรายงาน requirement delta ที่รออนุมัติ

#### Scenario: ขัดกับ agreement ที่อนุมัติแล้ว

- **GIVEN** ผู้ใช้ขอให้หน้าแสดงสิ่งที่ขัดกับ requirement ที่อนุมัติแล้ว
- **WHEN** skill แก้หน้า
- **THEN** skill ไม่ปล่อยให้ไม่ตรงเงียบ ๆ แต่เสนอ amend หรือยกเลิกการแก้ และไม่ลบ requirement โดยไม่ได้รับอนุมัติ

#### Scenario: ใช้ canvas เมื่อมี design skill

- **GIVEN** host มี skill design หรือ Artifact ชนิด design
- **WHEN** skill สร้างหน้าอนุมัติ
- **THEN** skill สร้างบน canvas นั้นโดยไม่ถามผู้ใช้ว่าจะใช้หรือไม่ จัดเป็นเฟรมต่อหน้าจอหรือสถานะ มีเลขลำดับและหัวข้อกลุ่ม แล้วส่งออกไฟล์ prototype.html ใน .foundation/previews เพราะ harness ตรวจจากไฟล์นั้น

#### Scenario: แก้บน canvas แล้วส่งออกใหม่

- **GIVEN** ผู้ใช้แก้เฟรมบน canvas
- **WHEN** skill ทำงานต่อ
- **THEN** skill ส่งออกไฟล์ใหม่และ revise หรือ amend change ให้ตรงในรอบเดียวกัน ไม่ปล่อยให้ไฟล์ค้างเป็นฉบับเก่า

#### Scenario: canvas ใช้ไม่ได้

- **GIVEN** host มี design skill แต่สร้างบน canvas ไม่สำเร็จ
- **WHEN** skill สร้างหน้า
- **THEN** skill ตกกลับไปเขียนไฟล์ HTML อย่างเดียว บอกผู้ใช้ว่าเหตุใดไม่ได้ใช้ canvas และไม่หยุดงาน

#### Scenario: ไม่มีที่แสดงผลแบบ design

- **GIVEN** host ไม่มีทั้ง skill design และ Artifact ชนิด design
- **WHEN** skill สร้างหน้าเสร็จ
- **THEN** skill เขียนไฟล์ HTML อย่างเดียวและไม่ถามผู้ใช้

#### Scenario: ไม่แชร์เอง

- **GIVEN** ที่แสดงผลแบบ design รองรับการแชร์
- **WHEN** skill แสดงหน้า
- **THEN** skill ไม่แชร์หรือเผยแพร่ให้ผู้อื่นจนกว่าผู้ใช้จะสั่ง
