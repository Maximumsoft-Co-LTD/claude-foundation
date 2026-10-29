# review-closure Specification

## Purpose
ทำให้ทางตัน CONTRACT_DECISION_REQUIRED หลัง amendment บอกทางต่อที่มีอยู่จริง และเตือนตั้งแต่ตอน amend.
## Requirements
### Requirement: decision-route-command

ระบบ SHALL ระบุคำสั่งที่ได้ approved decision revision ในผลลัพธ์ของ advance เมื่อ agreement เปลี่ยนหลัง delta รอบสุดท้ายที่ล้ม แทนคำสั่ง packet --phase build

#### Scenario: change แบบ grounding

- **GIVEN** change ที่ groundingRequired เป็นจริงและ agreement เปลี่ยนหลัง delta รอบสุดท้ายที่ล้ม
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น ASK_USER และมีคำสั่ง change resolve <change> --reopen-grounding --decision-ref <ref> --reopen-reason <why>

#### Scenario: change แบบ non-grounding

- **GIVEN** change ที่ไม่ใช่ grounding และ spec approval ไม่ตรงกับ contractRevision ปัจจุบัน
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น ASK_USER และมีคำสั่ง advance <change> --approve-spec --decision-ref <ref>

#### Scenario: gate ไม่ถูกผ่อน

- **GIVEN** agreement เปลี่ยนโดยไม่มี approved decision revision
- **WHEN** agent รัน advance
- **THEN** closure ยังคืน closed false และ route CONTRACT_DECISION_REQUIRED เหมือนเดิม

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

### Requirement: landed-aware-diff-identity

ระบบ SHALL บันทึก identity bridge (diff identity ก่อนและหลัง) เมื่อ sandbox sync เขียน sandbox ด้วย replay ของงานที่ยังไม่ commit ของ harness เอง (landed replay หรือ carried target edit) โดยไม่มี conflict และไม่มี base move ใน sync เดียวกัน และ receipt review/acceptance ที่ผูก diff identity ใดที่ bridge เชื่อมถึง identity ปัจจุบัน SHALL rebind ได้

#### Scenario: sync ที่ merge งานที่ land แล้วบันทึก bridge

- **GIVEN** bravo archived แล้วและ alpha แก้ไฟล์เดียวกันคนละบรรทัด
- **WHEN** sandbox sync alpha merge ได้สะอาด
- **THEN** workspace.identityBridges มี 1 แถวที่ from ไม่เท่า to และ kinds มี landed-replay

#### Scenario: sync ที่ไม่เปลี่ยนอะไรไม่บันทึก bridge

- **GIVEN** sync ก่อนหน้าบันทึก bridge แล้ว
- **WHEN** sandbox sync อีกครั้งโดยไม่มีงานใหม่
- **THEN** จำนวน bridge เท่าเดิม

#### Scenario: receipt rebind ข้าม bridge

- **GIVEN** receipt review ผูก diff identity ก่อน sync และ bridge เชื่อม identity นั้นถึง identity ปัจจุบัน (ผ่านกี่ขั้นก็ได้)
- **WHEN** ตรวจ receipt validity
- **THEN** validity เป็น reusable-diff

#### Scenario: bridge ที่ไม่ถึง identity ปัจจุบัน

- **GIVEN** bridge เชื่อมไปยัง identity อื่น (agent แก้ต่อหลัง sync)
- **WHEN** ตรวจ receipt validity
- **THEN** stale ด้วยเหตุ review-contribution-changed

#### Scenario: packet เปลี่ยนแม้มี bridge

- **GIVEN** bridge ถึง identity ปัจจุบัน แต่ packetReviewHash ไม่ตรง
- **WHEN** ตรวจ receipt validity
- **THEN** stale ด้วยเหตุ review-packet-changed

#### Scenario: base move ที่ reshape diff ยังทำให้ verdict หมดอายุ

- **GIVEN** sync replay sandbox ลงบน base ที่ขยับและ diff identity เปลี่ยน
- **WHEN** ตรวจ receipt acceptance/review
- **THEN** stale ตาม contract base-move เดิม ไม่มี bridge ถูกบันทึกใน sync นั้น

#### Scenario: sync ที่ทิ้ง conflict ไม่บันทึก bridge

- **GIVEN** replay รายงาน conflict
- **WHEN** sandbox sync
- **THEN** ไม่มี bridge ใหม่ และ receipt ยัง stale เมื่อ identity เปลี่ยน
