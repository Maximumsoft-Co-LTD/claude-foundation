# review-policy

## ADDED Requirements

### Requirement: dispatched-review-binds-sent-rules

ระบบ SHALL บันทึก reviewRulesHash ของ AI review ที่ผ่าน dispatch จาก hash ที่ส่งไปกับ dispatch นั้น ไม่ใช่จากไฟล์ตอนบันทึก

#### Scenario: บันทึก hash ที่ส่งไป

- **GIVEN** AI review ถูก dispatch ขณะ REVIEW.md มี hash A
- **WHEN** บันทึก review receipt ด้วย --review-attempt ของ dispatch นั้น
- **THEN** receipt มี review.reviewRulesHash เท่ากับ A

#### Scenario: แก้ REVIEW.md ระหว่างรีวิว

- **GIVEN** AI review ถูก dispatch ขณะ REVIEW.md มี hash A และไฟล์ถูกแก้เป็น hash B ก่อนบันทึก receipt
- **WHEN** บันทึก receipt แล้วตรวจความใช้ได้
- **THEN** receipt บันทึก A และเป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: dispatch ตอนไม่มีเกณฑ์

- **GIVEN** AI review ถูก dispatch ขณะไม่มี REVIEW.md หรือไฟล์อ่านไม่ได้
- **WHEN** บันทึก receipt ด้วย --review-attempt
- **THEN** receipt มี review.reviewRulesHash เป็น null

#### Scenario: attempt รุ่นเก่าไม่มีฟิลด์

- **GIVEN** dispatch attempt ถูกสร้างก่อนอัปเกรดและไม่มีฟิลด์ reviewRulesHash
- **WHEN** บันทึก receipt ด้วย --review-attempt ของ attempt นั้น
- **THEN** receipt ใช้ hash ของ REVIEW.md ปัจจุบัน และ attempt ยังผ่านการตรวจเหมือนเดิม

#### Scenario: receipt ที่ไม่ผ่าน dispatch

- **GIVEN** บันทึก review receipt โดยไม่มี dispatch attempt (เส้นทาง reserve)
- **WHEN** บันทึก receipt
- **THEN** receipt ใช้ hash ของ REVIEW.md ปัจจุบัน

### Requirement: receipt-validity-without-rules-lookup

ระบบ SHALL ถือว่าไม่มีเกณฑ์รีวิวเมื่อ receipt validity ถูกสร้างโดยไม่มีฟังก์ชันอ่าน hash ของเกณฑ์

#### Scenario: ไม่ส่ง callback และ receipt บันทึก null

- **GIVEN** receipt validity ไม่มี currentReviewRulesHash และ receipt มี reviewRulesHash เป็น null
- **WHEN** ตรวจความใช้ได้ของ receipt
- **THEN** ผลเหมือนตอนไม่มีฟีเจอร์ REVIEW.md และไม่มี exception

#### Scenario: ไม่ส่ง callback แต่ receipt มี hash

- **GIVEN** receipt validity ไม่มี currentReviewRulesHash และ receipt มี hash
- **WHEN** ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

### Requirement: seeded-review-rules-staged

installer SHALL stage REVIEW.md เข้า git เฉพาะเมื่อ installer เป็นผู้สร้างไฟล์นั้นในรอบนั้น

#### Scenario: installer สร้างไฟล์

- **GIVEN** target เป็น git repository ที่ไม่มี REVIEW.md
- **WHEN** install.sh stage ไฟล์ที่ติดตั้ง
- **THEN** REVIEW.md อยู่ใน git index

#### Scenario: ไฟล์ของโปรเจกต์ที่ยังไม่ commit

- **GIVEN** target มี REVIEW.md ที่แก้แล้วยังไม่ stage
- **WHEN** install.sh stage ไฟล์ที่ติดตั้ง
- **THEN** REVIEW.md ยังไม่ถูก stage
