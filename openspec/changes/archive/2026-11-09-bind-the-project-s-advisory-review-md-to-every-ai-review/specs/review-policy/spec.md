# review-policy

## ADDED Requirements

### Requirement: review-rules-in-packet

ระบบ SHALL ใส่เนื้อหาและ hash ของ REVIEW.md ที่ root ของโปรเจกต์ลงใน AI reviewer packet เมื่อมีไฟล์นั้น

#### Scenario: มี REVIEW.md

- **GIVEN** root ของโปรเจกต์มี REVIEW.md ขนาดไม่เกิน 32 KiB
- **WHEN** harness ประกอบ reviewer packet
- **THEN** packet มี reviewRules ที่มี path REVIEW.md, hash sha256 ของเนื้อหา, เนื้อหาเต็ม และ advisory: true
- **AND** packet version เป็น reviewPacketSchema 7

#### Scenario: ไม่มี REVIEW.md

- **GIVEN** root ของโปรเจกต์ไม่มี REVIEW.md
- **WHEN** harness ประกอบ reviewer packet
- **THEN** packet ไม่มีฟิลด์ reviewRules และ prompt ของ reviewer ไม่มีส่วนเกณฑ์รีวิว

#### Scenario: REVIEW.md ว่าง

- **GIVEN** REVIEW.md มีแต่ whitespace
- **WHEN** harness ประกอบ reviewer packet
- **THEN** ถือเหมือนไม่มีไฟล์ packet ไม่มี reviewRules

#### Scenario: REVIEW.md ใหญ่เกิน

- **GIVEN** REVIEW.md ใหญ่กว่า 32 KiB
- **WHEN** harness ประกอบ reviewer packet
- **THEN** reviewRules มี hash และ omitted: "too-large" แต่ไม่มีเนื้อหา
- **AND** prompt บอก reviewer ว่าเกณฑ์ของโปรเจกต์ไม่ได้ส่งมาเพราะใหญ่เกิน

#### Scenario: อ่าน REVIEW.md ไม่ได้

- **GIVEN** REVIEW.md มีอยู่แต่อ่านไม่ได้ เช่น สิทธิ์ไฟล์ไม่พอ
- **WHEN** harness ประกอบ reviewer packet
- **THEN** รีวิวยังรันได้ reviewRules มี omitted: "unreadable" และไม่มี hash

#### Scenario: รอบรีวิวแบบส่งแค่ diff

- **GIVEN** REVIEW.md มีอยู่และเป็นรอบรีวิวแบบ diff-only
- **WHEN** harness ส่ง packet ให้ AI reviewer
- **THEN** reviewRules ยังอยู่ใน packet ไม่ถูกตัดออกเหมือนฟิลด์อื่นในรอบ diff-only

### Requirement: review-rules-advisory

ระบบ SHALL ใช้ REVIEW.md เป็นคำแนะนำเท่านั้นและไม่ให้มีผลต่อการตัดสินผ่านหรือไม่ผ่านของรีวิว

#### Scenario: prompt ระบุว่าเป็นคำแนะนำ

- **GIVEN** packet มี reviewRules ที่มีเนื้อหา
- **WHEN** harness สร้าง prompt ให้ configured reviewer
- **THEN** prompt มีเนื้อหา REVIEW.md ใต้หัวข้อที่ระบุว่าเป็นคำแนะนำ และบอกว่าห้ามใช้เป็นเหตุให้ไม่ผ่านเกินกว่า review contract

#### Scenario: ผลตัดสินเหมือนเดิม

- **GIVEN** reviewer ตอบผลเดียวกันสองครั้ง ครั้งหนึ่ง packet มี reviewRules อีกครั้งไม่มี
- **WHEN** harness บันทึก review receipt
- **THEN** status และ verdict ของ receipt ทั้งสองเหมือนกัน

### Requirement: review-rules-bind-receipt

ระบบ SHALL บันทึก hash ของ REVIEW.md ใน review receipt และถือว่ารีวิวเก่าเมื่อ hash ปัจจุบันไม่ตรงกับที่บันทึก

#### Scenario: บันทึก hash

- **GIVEN** packet มี reviewRules ที่มี hash
- **WHEN** harness บันทึก review receipt
- **THEN** receipt มี review.reviewRulesHash เท่ากับ hash ใน packet

#### Scenario: แก้ REVIEW.md หลังรีวิว

- **GIVEN** receipt มี reviewRulesHash และต่อมา REVIEW.md ถูกแก้
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: ลบ REVIEW.md หลังรีวิว

- **GIVEN** receipt มี reviewRulesHash และต่อมา REVIEW.md ถูกลบ
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: สร้าง REVIEW.md หลังรีวิว

- **GIVEN** receipt ถูกบันทึกโดยระบุว่าไม่มี REVIEW.md (reviewRulesHash: null) และต่อมามีการสร้างไฟล์
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: REVIEW.md ไม่เปลี่ยน

- **GIVEN** receipt มี reviewRulesHash เท่ากับ hash ปัจจุบัน และ base ของ change ขยับเพราะ change อื่น land ก่อน
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt ยังใช้ได้หรือ rebind ได้เหมือนก่อนมีฟีเจอร์นี้

#### Scenario: receipt เก่าก่อนอัปเกรด

- **GIVEN** receipt ไม่มีฟิลด์ reviewRulesHash เลย และโปรเจกต์มี REVIEW.md แล้ว
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt ไม่ถูกทำให้เก่าด้วยเหตุผล review-rules-changed

### Requirement: starter-review-rules-seeded

installer SHALL ใส่ REVIEW.md ตั้งต้นที่ root ของโปรเจกต์เฉพาะเมื่อยังไม่มีไฟล์นั้น ทั้งตอนติดตั้งใหม่และอัปเกรด

#### Scenario: ติดตั้งใหม่

- **GIVEN** โปรเจกต์ยังไม่มี REVIEW.md
- **WHEN** รัน install.sh
- **THEN** REVIEW.md ถูกสร้างจาก .claude/harness/templates/REVIEW.md
- **AND** แผนติดตั้งแสดงบรรทัด + REVIEW.md

#### Scenario: อัปเกรดโปรเจกต์ที่ไม่มีไฟล์

- **GIVEN** โปรเจกต์ติดตั้ง Change Loop รุ่นก่อนแล้วและไม่มี REVIEW.md
- **WHEN** รัน install.sh เพื่ออัปเกรด
- **THEN** REVIEW.md ถูกสร้างจาก template

#### Scenario: มี REVIEW.md อยู่แล้ว

- **GIVEN** โปรเจกต์มี REVIEW.md ของตัวเอง
- **WHEN** รัน install.sh
- **THEN** REVIEW.md เหมือนเดิมทุก byte

#### Scenario: ติดตั้งล้มกลางทาง

- **GIVEN** โปรเจกต์ไม่มี REVIEW.md และการติดตั้งล้มหลังสร้างไฟล์แล้ว
- **WHEN** installer rollback
- **THEN** REVIEW.md ที่เพิ่งสร้างถูกลบออก
