# review-authority

## ADDED Requirements

### Requirement: interrupted-review-recovers-dispatched-model

ระบบ SHALL กู้คืนผลรีวิวที่ถูกขัดจังหวะโดยเทียบกับ reviewer ที่บันทึกไว้ตอน dispatch

#### Scenario: รอบแรก standard ถูกขัดจังหวะ

- **GIVEN** รีวิวรอบแรก dispatch ด้วย model standard, attempt เสร็จเป็น pass และการบันทึก receipt ถูกขัดจังหวะ
- **WHEN** advance กู้คืนผลจาก checkpoint
- **THEN** receipt ของรีวิวถูกบันทึกด้วยผล pass และ provenance ของ model standard

#### Scenario: รอบแรก fast ถูกขัดจังหวะ

- **GIVEN** รีวิวรอบแรก dispatch ด้วย model fast และถูกขัดจังหวะหลัง attempt เสร็จ
- **WHEN** advance กู้คืนผล
- **THEN** receipt ถูกบันทึกด้วย provenance ของ model fast

#### Scenario: รอบ configured ยังกู้ได้

- **GIVEN** รีวิว dispatch ด้วย model configured และถูกขัดจังหวะหลัง attempt เสร็จ
- **WHEN** advance กู้คืนผล
- **THEN** receipt ถูกบันทึกเหมือนก่อนแก้

#### Scenario: คำตอบไม่ตรงกับที่ dispatch

- **GIVEN** คำตอบที่เก็บไว้ระบุ model ต่างจาก request.dispatch.reviewer หรือ digest ของรายงานไม่ตรง
- **WHEN** advance กู้คืนผล
- **THEN** ยังปฏิเสธด้วย configured review result integrity or reviewer provenance does not match

### Requirement: abort-refuses-unrecorded-result

authority abort SHALL ปฏิเสธ request ที่ AI attempt เสร็จแบบ delivered แล้วแต่ยังไม่มี receipt

#### Scenario: abort หลังผลเสร็จแต่ยังไม่บันทึก

- **GIVEN** request ถูก dispatch และ attempt เสร็จเป็น pass แต่ยังไม่มี review receipt
- **WHEN** รัน authority abort กับ request นั้น
- **THEN** คำสั่งถูกปฏิเสธโดยไม่เปลี่ยน request หรือ attempt history และบอกให้ใช้ authority record หรือ advance

#### Scenario: abort ระหว่างรีวิวยังรัน

- **GIVEN** request ถูก dispatch และ attempt ยังไม่เสร็จ
- **WHEN** รัน authority abort
- **THEN** request เป็น aborted และ attempt เสร็จเป็น error เหมือนเดิม

#### Scenario: abort request ที่ยังไม่ dispatch

- **GIVEN** request อยู่ในสถานะ requested
- **WHEN** รัน authority abort
- **THEN** request เป็น cancelled เหมือนเดิม

#### Scenario: abort หลังบันทึกแล้ว

- **GIVEN** attempt เสร็จและ receipt ผูก attempt นั้นแล้ว
- **WHEN** รัน authority abort
- **THEN** พฤติกรรมเหมือนก่อนแก้
