# approval-package

## ADDED Requirements

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
