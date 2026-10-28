# review-closure

## ADDED Requirements

### Requirement: partial-closure-is-a-verdict

ระบบ SHALL รับผล review รอบ closure ที่ fail และ verify finding รอบแรกเป็นชุดย่อยเมื่อรายงาน blocker หรือ major อย่างน้อยหนึ่งตัว และปล่อย ID ที่ไม่ถูก verify ให้ยังเปิดอยู่

#### Scenario: ปิดได้สามจากสี่แล้วยังเห็นปัญหาค้าง

- **GIVEN** finding รอบแรกคือ F1 F2 F3 F4 และ reviewer รอบ closure ตอบ status fail, verified เป็น F1 F3 F4 และรายงาน finding major D1 ในขอบเขตที่ส่งไป
- **WHEN** harness ตรวจและบันทึกผลรอบ closure
- **THEN** ผลถูกบันทึกเป็น review ที่ fail ที่ส่งมอบแล้ว ไม่ใช่ error
- **AND** F2 ไม่อยู่ในรายการที่ verified
- **AND** D1 เป็น finding ที่ยังค้างอยู่

#### Scenario: pass ที่ปิดไม่ครบถูกปฏิเสธ

- **GIVEN** finding รอบแรกคือ F1 และ F2 และ reviewer ตอบ status pass โดย verified เป็น F1 อย่างเดียว
- **WHEN** harness ตรวจผลรอบ closure
- **THEN** ผลถูกปฏิเสธและข้อความระบุว่ารอบ closure ต้อง verify F1 และ F2 ครบ

#### Scenario: fail ที่ขาด ID โดยไม่มี finding อธิบายถูกปฏิเสธ

- **GIVEN** reviewer ตอบ status fail โดย verified ขาด F2 และไม่มี finding แบบ blocker หรือ major
- **WHEN** harness ตรวจผลรอบ closure
- **THEN** ผลถูกปฏิเสธเพราะไม่มี finding ใดอธิบายส่วนที่ขาด

#### Scenario: verified ที่มี ID นอกรอบแรกถูกปฏิเสธ

- **GIVEN** finding รอบแรกคือ F1 และ reviewer ตอบ fail พร้อม major โดย verified มี F-ZZ ที่ไม่ใช่ finding รอบแรก
- **WHEN** harness ตรวจผลรอบ closure
- **THEN** ผลถูกปฏิเสธและข้อความระบุ F1 เป็น ID ที่รอบ closure อ้างอิงได้

#### Scenario: ปิดครบทุกตัวคงเดิม

- **GIVEN** reviewer รอบ closure verify F1 ถึง F4 ครบ
- **WHEN** harness ตรวจผลรอบ closure
- **THEN** ผลถูกตัดสินตาม status เหมือนก่อนการเปลี่ยนนี้

#### Scenario: ผลที่บันทึกด้วยมือผ่านกติกาเดียวกัน

- **GIVEN** คำตอบ authority ที่ส่งมาด้วย authority record เป็น fail, verified เป็นชุดย่อย และมี blocker หนึ่งตัว
- **WHEN** harness ตรวจคำตอบก่อนบันทึก
- **THEN** คำตอบผ่านการตรวจด้วยกติกาเดียวกับผลของ reviewer ที่ตั้งค่าไว้

### Requirement: reviewer-told-how-to-report-open-findings

ระบบ SHALL บอก reviewer รอบ closure ให้ใส่ใน verifiedFindingIds เฉพาะ finding ที่การซ่อมปิดแล้ว และรายงานปัญหาที่ยังเหลือเป็น finding

#### Scenario: คำสั่งของ reviewer อธิบายวิธีตอบเมื่อปิดไม่ครบ

- **GIVEN** packet ของรอบ closure มี closureFindings
- **WHEN** harness สร้างคำสั่งสำหรับ reviewer
- **THEN** คำสั่งระบุว่าให้ verify เฉพาะ finding ที่ปิดแล้ว, ให้ละ ID ที่ยังไม่ปิด, และให้รายงานปัญหาที่เหลือเป็น finding
