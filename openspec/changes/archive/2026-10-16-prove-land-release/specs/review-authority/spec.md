# review-authority

## ADDED Requirements

### Requirement: human-verdict-rebind

ระบบ SHALL คง review receipt ที่มาจาก verdict ของคนเมื่อ sandbox sync ย้าย base และ hunk ของ change กับไฟล์ใน packet เหมือนเดิมทุกไบต์ และ SHALL เปิด request ใหม่เมื่อ hunk ของ change เปลี่ยน

#### Scenario: upstream แก้ไฟล์อื่น

- **GIVEN** change มี verdict ของคนเป็น pass
- **WHEN** sandbox sync ย้าย base ไปบน commit ที่แก้เฉพาะไฟล์ที่ change ไม่ได้แก้
- **THEN** review receipt ยัง valid และไม่มี request ใหม่

#### Scenario: upstream แก้ไฟล์ของ change

- **GIVEN** change มี verdict ของคนเป็น pass
- **WHEN** sync ย้าย base ไปบน commit ที่แก้ไฟล์ที่ change แก้ด้วย
- **THEN** harness เปิด review request ใหม่

### Requirement: review-exhausted-decision

ระบบ SHALL คืน ASK_USER ที่ระบุว่า AI review ใช้ครบแล้ว พร้อมตัวเลือก verdict ของคน, AI review เพิ่มหนึ่งครั้งด้วย decision ของผู้ใช้ และ pause เมื่อ request ของ review ไม่มี reviewer เพราะใช้ครบ และ SHALL คงข้อความ WAIT เดิมเมื่อไม่มี reviewer ที่ตั้งค่าไว้

#### Scenario: AI review ครบ

- **GIVEN** change ใช้ AI review ครบ maxAiAttempts แล้ว
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น ASK_USER ที่มีตัวเลือก human-verdict, one-more-ai-attempt และ pause พร้อมคำสั่งของแต่ละทาง

#### Scenario: AI เพิ่มหนึ่งครั้ง

- **GIVEN** ผู้ใช้เลือก one-more-ai-attempt พร้อม decision-ref
- **WHEN** agent รันคำสั่งของตัวเลือกนั้น
- **THEN** harness ส่ง AI review ได้อีกหนึ่งครั้ง

#### Scenario: ไม่มี reviewer

- **GIVEN** project ไม่มี reviewer ที่ตั้งค่า
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น WAIT ที่บอกให้ตั้งค่า reviewer หรือบันทึก verdict ภายนอกเหมือนเดิม

### Requirement: authority-record-issues

ระบบ SHALL ให้ authority record รายงานปัญหาทั้งหมดของ response ในครั้งเดียว และ SHALL ให้ template ของ delta review ตั้ง verified-findings เท่ากับจำนวน verifiedFindingIds และบอกให้ dispatch ก่อนเมื่อ request ยังไม่ถูก dispatch

#### Scenario: หลายปัญหาพร้อมกัน

- **GIVEN** response ที่ไม่มี subject-session และ reference ชี้ไปยัง path ที่ไม่มีอยู่
- **WHEN** agent รัน authority record
- **THEN** ข้อความ BLOCKED ระบุทั้งสองปัญหาในครั้งเดียว

#### Scenario: template ของ delta ใช้ได้

- **GIVEN** delta review request ที่มี finding รอบแรก F1
- **WHEN** agent ดึง template
- **THEN** verified-findings เป็น 1 และ verifiedFindingIds เป็น F1

#### Scenario: request ยังไม่ dispatch

- **GIVEN** review request ที่ยังไม่ dispatch
- **WHEN** agent ดึง template
- **THEN** template ระบุคำสั่ง authority dispatch ที่ต้องรันก่อน record
