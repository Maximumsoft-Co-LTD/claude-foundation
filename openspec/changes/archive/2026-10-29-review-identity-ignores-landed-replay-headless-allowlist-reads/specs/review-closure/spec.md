# review-closure

## ADDED Requirements

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
