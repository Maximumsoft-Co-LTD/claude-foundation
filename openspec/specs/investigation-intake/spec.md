# investigation-intake Specification

## Purpose
เก็บข้อมูลและการตัดสินใจที่มีผลต่อ agreement ตรวจความสดและความครบ โดย agent ทำงานอิสระต่อและผู้ใช้ตัดสินเฉพาะ consequential semantics
## Requirements
### Requirement: เก็บความต้องการและบทสนทนา

ระบบ SHALL เก็บความต้องการและบทสนทนา

- เก็บเป้าหมาย พฤติกรรม ตัวอย่าง เกณฑ์สำเร็จ ข้อจำกัด ข้อยกเว้น ข้อห้าม และนอกขอบเขตพร้อม ID คงที่ แยกผู้ใช้ระบุจาก agent เสนอ เก็บ revision และความสัมพันธ์แทนที่หรือยกเลิก ตรวจรายการที่หายโดยไม่มีเหตุผล

#### Scenario: เก็บความต้องการและบทสนทนา

- **WHEN** ผู้ใช้แก้ requirement แล้วกลับมาทำต่อหลังเปลี่ยน session
- **THEN** โหลดข้อมูลล่าสุดพร้อมประวัติและไม่ย้อนใช้ข้อเสนอที่ยกเลิก

#### Scenario: ขอบเขตของเก็บความต้องการและบทสนทนา

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: รายการสำคัญหาย

- **WHEN** incoming record ลบ requirement หรือ conversation event เดิมโดยไม่มี replacement/cancellation
- **THEN** agent ได้ finding และ valid baseline เดิมยังอยู่สำหรับการซ่อม

#### Scenario: คำแก้ไขบางส่วน

- **WHEN** ผู้ใช้แก้ข้อจำกัดหนึ่งข้อและเปิด session ใหม่
- **THEN** เฉพาะข้อนั้นถูกแทนที่ ข้อกำหนดอื่นและ provenance ยังอยู่

#### Scenario: ประวัติที่เข้าถึงไม่ได้

- **WHEN** agent เข้าถึงข้อความต้นทางบางช่วงไม่ได้
- **THEN** report ระบุ gap ไม่อ้างการอ่านหรือการยืนยันที่ไม่มี

### Requirement: สอบถามโดยทำงานต่อได้

ระบบ SHALL สอบถามโดยทำงานต่อได้

- รองรับคำถามปลายเปิดและคำถามเลือกทาง แยกคำถามเจตนาจากข้อเท็จจริง ระบุงานที่ขึ้นกับคำตอบ ใช้คำตอบเดิม ทำงานอิสระระหว่างรอ และไม่อนุมานการยอมรับจากความเงียบ

#### Scenario: สอบถามโดยทำงานต่อได้

- **WHEN** มีคำถามสำคัญที่ยังไม่ได้ตอบ
- **THEN** ถามเฉพาะส่วนที่ต้องตัดสินและสืบงานอิสระต่อได้

#### Scenario: ขอบเขตของสอบถามโดยทำงานต่อได้

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: คำถามปลายเปิด

- **WHEN** ผู้ใช้ยังไม่ได้ระบุเกณฑ์สำเร็จ
- **THEN** agent ถามปลายเปิดได้โดยไม่บังคับ alternatives หรือ code fact

#### Scenario: งานอิสระระหว่างรอ

- **WHEN** มีคำถาม material ค้างและมี source investigation ที่ไม่ขึ้นกับคำตอบ
- **THEN** typed action แสดงคำถามและงานอิสระที่ทำต่อได้โดยไม่ grant authority

#### Scenario: ยังไม่ได้ยอมรับ

- **WHEN** agent เสนอพฤติกรรมแล้วผู้ใช้ไม่ตอบ
- **THEN** พฤติกรรมนั้นยังเป็น proposal และไม่ถูกผูกเป็น confirmed requirement

#### Scenario: ไม่ถามซ้ำ

- **WHEN** มี explicit answer หรือคำสั่งที่ชัดใน retained conversation
- **THEN** agent ใช้ข้อมูลเดิมและไม่เพิ่มขั้น confirm ซ้ำ

### Requirement: ทดลองตาม requirement

ระบบ SHALL ทดลองตาม requirement

- ผูก PoC/prototype กับคำถาม สมมติฐาน เกณฑ์ตัดสิน ผลและข้อจำกัด รักษาขอบเขต prototypes เดิมและไม่ใช้เป็น proof ทบทวนผลที่ได้รับผลจาก requirement ที่เปลี่ยน

#### Scenario: ทดลองตาม requirement

- **WHEN** requirement เปลี่ยนหลังทำ prototype
- **THEN** แสดงผลที่ยังใช้ได้และส่วนที่ต้องทบทวน

#### Scenario: ขอบเขตของทดลองตาม requirement

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: ผลทดลองเฉพาะส่วน

- **WHEN** แก้ requirement ที่ experiment หนึ่งอ้างและอีก experiment ไม่อ้าง
- **THEN** เฉพาะผลที่สัมพันธ์กับ revision เก่าถูกระบุให้ทบทวน

#### Scenario: ข้อจำกัดต้นแบบ

- **WHEN** นำผล PoC ไปสร้าง Change
- **THEN** ผลและ limitations ถูกบันทึกแต่ไม่ถูกนำไปอ้าง proof pass

### Requirement: ส่งต่อข้อมูลล่าสุด

ระบบ SHALL ส่งต่อข้อมูลล่าสุด

- แยก unresolved material semantics จากสมมติฐานที่เปิดเผยได้ ไม่เพิ่มการอนุมัติทุก requirement ผูก handoff กับ revision/digest และคืนข้อมูลขาดให้ agent ซ่อมพร้อม exact resume

#### Scenario: ส่งต่อข้อมูลล่าสุด

- **WHEN** requirement เปลี่ยนหลังสร้าง handoff
- **THEN** handoff เก่าถูกปฏิเสธและ agent refresh จากผลวิจัยที่ยังใช้ได้

#### Scenario: ขอบเขตของส่งต่อข้อมูลล่าสุด

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: ไม่บังคับอนุมัติทุกข้อ

- **WHEN** ผู้ใช้ระบุ requirement ชัดและไม่มี unresolved material meaning
- **THEN** สร้าง handoff ได้โดยไม่ถาม approve ทุก requirement

#### Scenario: ข้อมูลล่าสุดเปลี่ยน

- **WHEN** แก้ record หลัง handoff โดยยังไม่ inspect ใหม่
- **THEN** Change ปฏิเสธ stale request และคืน agent refresh route

### Requirement: รายงานบริบทครบ

ระบบ SHALL รายงานบริบทครบ

- สร้างรายงานไทยและอังกฤษแสดงความต้องการล่าสุด ขอบเขต ที่มา การตัดสินใจ การแก้ไข ผลสืบและทดลอง คำถามค้าง งานอิสระและ resume รักษา authored notes

#### Scenario: รายงานบริบทครบ

- **WHEN** สร้างรายงานจาก record ล่าสุด
- **THEN** อ่านเข้าใจความต้องการและทำต่อโดยไม่ต้องมีแชตทั้งหมด

#### Scenario: ขอบเขตของรายงานบริบทครบ

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: กู้รายงาน

- **WHEN** generated report เขียนไม่ได้เพราะมี authored content ในปลายทาง
- **THEN** ไม่ overwrite authored content รักษาวิจัยและคืน regeneration route

### Requirement: เอกสาร Change ละเอียด

ระบบ SHALL เอกสาร Change ละเอียด

- รับ record ล่าสุดและรักษารายละเอียดสู่ proposal specs design เมื่อจำเป็น tasks และ evidence ให้มี before/after ขอบเขต scenarios failure/boundary เหตุผลและ recovery ตามประเภทงาน ไม่มี filler และไม่ใช้ prototype เป็น proof

#### Scenario: เอกสาร Change ละเอียด

- **WHEN** compile draft ที่มี requirement ตัวอย่าง ข้อยกเว้นและ design
- **THEN** packet อ่านลงมือทำและตรวจรับได้โดยไม่ย้อนอ่านแชต

#### Scenario: ขอบเขตของเอกสาร Change ละเอียด

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: รายละเอียดหลัง compile

- **WHEN** draft มีตัวอย่าง ข้อยกเว้น ข้อห้าม before/after และ recovery
- **THEN** รายละเอียดปรากฏใน native compiled artifacts ตามบทบาทโดยไม่สูญหาย

#### Scenario: ไม่เพิ่มเอกสารว่าง

- **WHEN** งานไม่มี material design แต่ผู้ใช้ขอเอกสารละเอียด
- **THEN** proposal/spec มีรายละเอียดที่เกี่ยวข้องโดยไม่เพิ่ม design filler หรือ assurance approval

### Requirement: ตรวจความครบใน packet

ระบบ SHALL ตรวจความครบใน packet

- เชื่อม requirement ต้นทางกับ requirement/scenario non-goal หรือ design ที่มีอยู่จริง รองรับหลายต่อหลายและยกเว้นอย่างมีเหตุผล ให้ agent ตรวจความหมายและซ่อม draft ไม่สร้าง ledger คู่ขนาน

#### Scenario: ตรวจความครบใน packet

- **WHEN** Change ตกหล่นข้อห้ามหรืออ้าง target ที่ไม่มี
- **THEN** คืน finding ให้ agent ซ่อมก่อน Build โดยไม่ผลักงานเอกสารให้ผู้ใช้

#### Scenario: ขอบเขตของตรวจความครบใน packet

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: ปลายทางไม่มีอยู่จริง

- **WHEN** mapping อ้าง requirement/scenario/non-goal/design ที่ไม่มี
- **THEN** agent ได้ repair findings และไม่อ้าง coverage ครบ

#### Scenario: coverage หลายต่อหลาย

- **WHEN** หลาย requirement ต้นทางรวมเป็น scenario หรือ requirement เดียวแตกหลาย target
- **THEN** coverage ครบเมื่อทุก active material source มี valid targets โดยไม่สร้าง shadow ledger

#### Scenario: coverage หลังแก้ agreement

- **WHEN** revise หรือ amend เพิ่มหรือแก้ requirement
- **THEN** mapping รุ่นใหม่ยังครบและไม่บังคับ migrate legacy changes

### Requirement: รองรับรุ่นเก่าและ shipping

ระบบ SHALL รองรับรุ่นเก่าและ shipping

- อ่าน record state และ handoff เดิมโดยไม่ปลอม user confirmation รักษาคำสั่ง arguments sandbox/source binding report recovery และ upgrade ไม่บังคับ migrate legacy changes ปรับ protocol ตาม wire change จริงและรักษา context budgets

#### Scenario: รองรับรุ่นเก่าและ shipping

- **WHEN** อ่าน record เดิมหรือสืบใน activeChange
- **THEN** ทำต่อได้ด้วย compatibility และ workspace freshness เดิม

#### Scenario: ขอบเขตของรองรับรุ่นเก่าและ shipping

- **WHEN** ข้อมูลที่ต้องใช้ไม่ครบหรือความหมายสำคัญยังขัดกัน
- **THEN** ระบบเก็บข้อมูลที่มี ระบุส่วนที่ขาด และคืนงานไปยังเจ้าของที่เหมาะสมโดยไม่อ้างความครบหรือ authority ที่ไม่มี

#### Scenario: handoff รุ่นเดิม

- **WHEN** โหลด ready v1 binding ที่ state sources และ workspace ยังสด
- **THEN** binding เดิมยัง valid โดยไม่สร้างข้อมูล user confirmation ใหม่

#### Scenario: workspace ไม่สด

- **WHEN** activeChange sandbox หายหรือ base/identity เปลี่ยน
- **THEN** คืน harness-owned workspace recovery และรักษา record
