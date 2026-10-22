# approval-package

## ADDED Requirements

### Requirement: flow-in-card-a

หน้า package SHALL วาด flow chart ของ userFlow.source ภายในการ์ดแบบ A ที่กางอยู่ และไม่แสดงซ้ำในส่วนรายละเอียดผู้ตรวจ

#### Scenario: มี userFlow

- **GIVEN** draft ประกาศ workType feature และมี userFlow.source เป็น Mermaid flowchart
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ด A มีบล็อก Mermaid ของ flowchart นั้นกางอยู่ และไม่มีบล็อกเดียวกันในส่วนรายละเอียดผู้ตรวจ

#### Scenario: ไม่มี source

- **GIVEN** userFlow มีแต่ purpose ไม่มี source
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ด A แสดงข้อความ purpose และไม่มีกรอบแผนภาพว่าง

#### Scenario: วาดไม่ได้

- **GIVEN** ไม่มีไฟล์ Mermaid ของ harness
- **WHEN** เรนเดอร์หน้าที่มี userFlow.source
- **THEN** การ์ด A แสดงข้อความ Mermaid ของแผนภาพนั้นเป็นข้อความที่อ่านได้

### Requirement: sequence-in-cards

หน้า package SHALL วางแผนภาพใน diagrams ลงการ์ดที่เกี่ยวข้องโดย sequenceDiagram ไปการ์ด D ก่อน แล้ว F แล้ว A และ stateDiagram ไปการ์ด F ก่อน แล้ว E แล้ว A และแผนภาพอื่นไปการ์ด A ก่อน และวางแต่ละแผนภาพที่เดียว

#### Scenario: sequence กับ api

- **GIVEN** workType เป็น api และ feature และ diagrams มี sequenceDiagram
- **WHEN** เรนเดอร์หน้า package
- **THEN** แผนภาพอยู่ในการ์ด D ไม่อยู่ในการ์ด A และไม่ซ้ำ

#### Scenario: state กับ async

- **GIVEN** workType เป็น async และ diagrams มี stateDiagram-v2
- **WHEN** เรนเดอร์หน้า package
- **THEN** แผนภาพอยู่ในการ์ด F

#### Scenario: ไม่มีการ์ดที่ตรง

- **GIVEN** workType เป็น docs ที่ได้การ์ด C เท่านั้นและ diagrams มี sequenceDiagram
- **WHEN** เรนเดอร์หน้า package
- **THEN** แผนภาพอยู่ในการ์ดแรกที่แสดง คือ C และไม่หายไป

#### Scenario: ไม่มีการ์ดเลย

- **GIVEN** draft ไม่มี workType ที่ให้การ์ดและมี diagrams
- **WHEN** เรนเดอร์หน้า package
- **THEN** แผนภาพยังแสดงในส่วนรายละเอียดผู้ตรวจ ไม่หาย

### Requirement: prototype-visible

หน้า package SHALL แสดงตัวอย่างชนิด prototype เป็นอันแรกของส่วนตัวอย่างและกางอยู่ และเมื่อการ์ด A แสดงโดยไม่มี prototype SHALL บอกว่ายังไม่มี prototype โดยไม่ทำให้ draft ตกหรือถามผู้ใช้

#### Scenario: prototype ไม่ใช่ตัวแรก

- **GIVEN** examples มี api เป็นตัวแรกและ prototype เป็นตัวที่สาม
- **WHEN** เรนเดอร์ส่วนตัวอย่าง
- **THEN** prototype ถูกวางเป็นอันแรกและกางอยู่ ตัวอื่นเรียงตามเดิมต่อจากนั้น

#### Scenario: ไม่มี prototype

- **GIVEN** workType เป็น ui และไม่มีตัวอย่างชนิด prototype
- **WHEN** เรนเดอร์การ์ด A
- **THEN** การ์ด A มีข้อความ ยังไม่มี prototype

#### Scenario: งานที่ไม่ใช่แบบ A

- **GIVEN** workType เป็น bugfix เท่านั้น
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่มีข้อความยังไม่มี prototype

#### Scenario: ไม่กั้นการเริ่ม

- **GIVEN** draft ประเภท ui ไม่มี prototype
- **WHEN** รัน change start
- **THEN** ไม่ได้ EDIT เรื่อง prototype และไม่ถามผู้ใช้

### Requirement: diagram-layout

หน้า package SHALL ใส่แต่ละแผนภาพในกรอบที่มีหัวข้อ กางอยู่ ย่อได้ และเลื่อนแนวนอนเมื่อกว้างเกินจอ โดยไม่เพิ่ม script นอกจากตัวโหลด Mermaid เดิม

#### Scenario: กรอบเลื่อนได้

- **WHEN** เรนเดอร์หน้าที่มีแผนภาพในการ์ด
- **THEN** แผนภาพอยู่ใน details ที่มี open และ summary เป็นหัวข้อ และ CSS ตั้ง overflow-x เป็น auto

#### Scenario: ไม่มี script เพิ่ม

- **WHEN** เรนเดอร์หน้าที่ไม่มี diagram
- **THEN** ไม่มี script form button หรือ event handler ในหน้า

### Requirement: visual-fixes

ป้าย ก่อน และ หลัง ของการ์ดก่อน-หลัง SHALL แสดงเป็นป้ายคำกะทัดรัดไม่เป็นกรอบเต็มความกว้าง และการ์ดข้อมูลส่วนบุคคลสองใบ SHALL มีหัวข้อต่างกัน

#### Scenario: ป้ายกะทัดรัด

- **GIVEN** scratch มี asIs และ toBe
- **WHEN** เรนเดอร์หน้า package
- **THEN** ป้ายในการ์ดก่อน-หลังไม่ได้รับสไตล์กรอบของป้ายแนะนำ

#### Scenario: หัวข้อต่างกัน

- **GIVEN** workType เป็น privacy และมี privacyAssessment
- **WHEN** เรนเดอร์การ์ด G
- **THEN** การ์ดวัตถุประสงค์และการ์ดตารางฟิลด์มีหัวข้อไม่เหมือนกันทั้ง th และ en

### Requirement: no-decision-bar

หน้า package SHALL ไม่แสดงส่วนตัดสินใจท้ายหน้า ได้แก่หัวข้อ ข้อความผลของการอนุมัติ ประโยคตอบ และช่อง textarea และการตัดสินใจ SHALL ทำในแชท

#### Scenario: ไม่มีส่วนตัดสินใจ

- **GIVEN** spec ยังไม่อนุมัติ
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่มีหัวข้อ การตัดสินใจของคุณ ไม่มี textarea ไม่มีประโยคตอบ และไม่มีข้อความผลของการอนุมัติ

#### Scenario: ไม่มี form หรือ script

- **WHEN** เรนเดอร์หน้า package ที่ไม่มี diagram
- **THEN** ไม่มี script form button หรือ event handler ในหน้า

#### Scenario: ถามในแชทเหมือนเดิม

- **GIVEN** agent ถึงขั้นขออนุมัติ spec
- **WHEN** ทำตาม commands/change.md
- **THEN** ถามด้วยการ์ดในแชทและบันทึกด้วย advance --approve-spec เหมือนเดิม

### Requirement: approval-status-line

หน้า package SHALL แสดงบรรทัดสถานะใต้หัวหน้าเมื่อ revision นี้อนุมัติแล้ว หรือเมื่อยังรออนุมัติจาก role ที่ตั้งไว้ใน approval.roles และไม่แสดงเมื่อไม่มีอะไรต้องบอก

#### Scenario: อนุมัติแล้ว

- **GIVEN** spec อนุมัติแล้วและ revision ไม่เปลี่ยน
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงบรรทัดว่าอนุมัติแล้วสำหรับฉบับนี้

#### Scenario: lane ยังไม่ครบ

- **GIVEN** ตั้ง approval.roles และ qa กับ security ยังไม่อนุมัติ
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงบรรทัดที่ระบุ qa และ security ว่ายังรออนุมัติ และไม่บอกว่าอนุมัติแล้ว

#### Scenario: ไม่มีอะไรต้องบอก

- **GIVEN** spec ยังไม่อนุมัติและไม่ได้ตั้ง approval.roles
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงบรรทัดสถานะ

### Requirement: visual-polish

หน้า package SHALL ดูเรียบร้อยและอ่านง่ายขึ้นด้วย CSS ล้วน: แถบความเสี่ยงใช้สีตามระดับพร้อมป้ายข้อความ ชิปยาวตัดบรรทัดไม่ล้นจอ แท็กก่อน/หลังพอดีตัวอักษร และการ์ดมีระยะห่างและเงาบางสม่ำเสมอ ทั้งโหมดสว่างและมืด

#### Scenario: แถบความเสี่ยงมีสีตามระดับ

- **GIVEN** ระดับความเสี่ยงเป็นวิกฤต
- **WHEN** เรนเดอร์หน้า package
- **THEN** ช่องที่เติมใช้คลาสสีของระดับนั้น และป้ายข้อความระดับยังแสดง ไม่ใช้สีอย่างเดียวสื่อความหมาย

#### Scenario: ชิปยาวไม่ล้น

- **GIVEN** ชิปมีข้อความยาวเช่นชื่อ path
- **WHEN** เรนเดอร์ที่ความกว้าง 360px
- **THEN** ข้อความตัดบรรทัดภายในชิป ไม่เกิดแถบเลื่อนแนวนอนของหน้า

#### Scenario: แท็กก่อนหลังพอดีตัว

- **GIVEN** มีการ์ดก่อน-หลัง
- **WHEN** เรนเดอร์หน้า package
- **THEN** แท็กไม่ยืดเต็มความกว้างของการ์ด

#### Scenario: โหมดมืด

- **GIVEN** ระบบใช้ prefers-color-scheme dark
- **WHEN** เรนเดอร์หน้า package
- **THEN** สีของแถบความเสี่ยงและการ์ดกำหนดผ่านตัวแปรสีของโหมดมืด ไม่ใช้สีคงที่ที่อ่านไม่ออก

## MODIFIED Requirements

### Requirement: decision-first-page

หน้า approval package SHALL แสดงสรุปและความเสี่ยงก่อนรายละเอียดเทคนิค

#### Scenario: สรุปมาก่อน

- **GIVEN** draft มี scratch ครบ 4 บรรทัด
- **WHEN** เรนเดอร์หน้า package
- **THEN** ลำดับในหน้าคือ หัว ความเสี่ยง สรุป 4 บรรทัด แถบขอบเขต ตัวอย่าง รายละเอียดผู้ตรวจ

#### Scenario: ไม่มี scratch

- **GIVEN** draft ไม่มี scratch
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงกรอบเตือนว่ายังไม่มีสรุปและแสดง intent แทน

#### Scenario: ไม่ทราบตัวเลขขอบเขต

- **GIVEN** draft ไม่มี tasks paths หรือ openQuestions ที่นับได้
- **WHEN** เรนเดอร์แถบขอบเขต
- **THEN** ตัวเลขนั้นแสดงว่า ไม่ทราบ ไม่ใช่ 0

### Requirement: before-after-and-questions

หน้า package SHALL แสดงก่อน-หลังเป็นการ์ดคู่ และแสดงตัวข้อความของคำถามที่ค้างอยู่ในกล่องเด่นก่อนรายละเอียดผู้ตรวจ

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

## REMOVED Requirements

### Requirement: copyable-decision-bar

ถอดข้อกำหนดเดิมของแถบตัดสินใจ: copyable-decision-bar

**Migration:** ถอดแถบตัดสินใจที่แสดงประโยคตอบ เพราะผู้ใช้ตอบผ่านการ์ดถามในแชทอยู่แล้ว (chat-approval-card) สถานะอนุมัติและ lane ที่ขาดย้ายไปอยู่ในบรรทัดสถานะ (approval-status-line) และข้อกำหนดห้าม script ย้ายไปอยู่ที่ no-decision-bar

### Requirement: mobile-decision-bar

ถอดข้อกำหนดเดิมของแถบตัดสินใจ: mobile-decision-bar

**Migration:** ไม่มีแถบตัดสินใจให้จัดตำแหน่งบนมือถืออีก (ดู no-decision-bar) ข้อกำหนดห้าม script ยังอยู่ที่ no-decision-bar และ diagram-layout
