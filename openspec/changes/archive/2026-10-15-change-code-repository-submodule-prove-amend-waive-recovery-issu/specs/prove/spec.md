# prove

## ADDED Requirements

### Requirement: A waiver cannot leave proof without evidence

ระบบ SHALL ปฏิเสธ change waive เมื่อหลังบันทึก waiver แล้วไม่เหลือ required provider

#### Scenario: waive test ที่เป็นหลักฐานเดียว

- **GIVEN** claim ทั้งหมดต้องการเฉพาะ capability test และไม่ต้องการ review
- **WHEN** change waive --capability test
- **THEN** คำสั่งล้มด้วยข้อความว่าไม่เหลือหลักฐานที่รันจริงและ Land จะปฏิเสธ proof ที่ไม่มี receipt
- **AND** ไม่มี waiver ถูกบันทึก

#### Scenario: waive ที่ยังเหลือหลักฐาน

- **GIVEN** change ต้องการ test และ review
- **WHEN** change waive --capability review
- **THEN** waiver ถูกบันทึกตามเดิม

### Requirement: Proof never finalizes without receipts

ระบบ SHALL ไม่ประกาศ PROVEN เมื่อไม่มี required provider และ SHALL ระบุสาเหตุ missing-receipt-manifest ใน REPAIR

#### Scenario: finalize โดยไม่มี required provider

- **GIVEN** waiver เดิมทำให้ required providers ว่าง
- **WHEN** proof finalize
- **THEN** ไม่เขียน proof pass และรายงานว่าไม่มี receipt manifest

#### Scenario: proof ปกติ

- **GIVEN** มี required provider ที่ผ่าน
- **WHEN** proof finalize
- **THEN** เขียน proof pass พร้อม receipts ตามเดิม

### Requirement: Proof no-progress decisions are answered through advance

ระบบ SHALL บันทึก decision repair-no-progress ของ proof gate ที่ตัวเลือกไม่มีคำสั่งของตัวเองเป็น decision ที่ตอบได้ด้วย advance --decision

#### Scenario: ตัวเลือกมีคำสั่งตอบ

- **GIVEN** proof gate คืน ASK_USER repair-no-progress
- **WHEN** advance แสดง decision
- **THEN** แต่ละตัวเลือกมีคำสั่ง advance --decision พร้อม fingerprint

#### Scenario: ตอบ change-strategy

- **GIVEN** decision นั้นเป็น pending
- **WHEN** advance --decision change-strategy พร้อม decision-ref และ reason
- **THEN** คำตอบถูกบันทึกและ advance รอบนั้นคืน REPAIR จาก findings แทน ASK_USER เดิม

#### Scenario: ตอบ pause

- **GIVEN** decision นั้นเป็น pending
- **WHEN** advance --decision pause
- **THEN** change ถูกพักและคงหลักฐานทั้งหมด

#### Scenario: decision ที่ตัวเลือกมีคำสั่งเองคงเดิม

- **GIVEN** review route exhausted มีตัวเลือก accept-review-risk ที่มีคำสั่ง change waive
- **WHEN** advance แสดง decision
- **THEN** คำสั่งเดิมของตัวเลือกไม่ถูกแทน

#### Scenario: fingerprint ไม่ตรง

- **GIVEN** decision เปลี่ยนแล้ว
- **WHEN** advance --decision ด้วย fingerprint เก่า
- **THEN** ปฏิเสธว่า decision stale

### Requirement: Exhausted review infrastructure names its supported reset

ระบบ SHALL ระบุ claude-foundation authority reset-infra ใน recovery ของ REPAIR_REVIEW_INFRASTRUCTURE

#### Scenario: request หมด fallback

- **GIVEN** review request status infrastructure-exhausted
- **WHEN** advance
- **THEN** envelope REPAIR_REVIEW_INFRASTRUCTURE มีคำสั่ง authority reset-infra ของ change นั้นพร้อม --decision-ref

### Requirement: A review no reviewer can start says so

ระบบ SHALL ระบุใน WAIT ของ review ที่ requested แต่ไม่มี configured reviewer ที่รันได้ ว่าไม่มี reviewer ที่เริ่มได้ และคำสั่งที่ใช้บันทึก verdict หรือดูสถานะ

#### Scenario: ไม่มี authority run

- **GIVEN** review request requested และ router ไม่เสนอ authority run
- **WHEN** advance
- **THEN** reason ระบุว่าไม่มี configured reviewer ที่เริ่มได้ และ requestId กับคำสั่ง authority status
