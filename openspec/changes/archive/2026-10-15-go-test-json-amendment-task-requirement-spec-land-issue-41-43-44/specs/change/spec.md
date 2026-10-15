# change

## ADDED Requirements

### Requirement: Amendments add tasks for existing requirements

ระบบ SHALL รับ amendment ที่มีเฉพาะ addTasks ซึ่ง covers requirement ที่มีอยู่ โดยไม่ต้องมี requirement change หรือ semantic intake

#### Scenario: เพิ่ม task ให้ requirement เดิม

- **GIVEN** change มี requirement r1 และ task T001
- **WHEN** amend ด้วย addTasks [{key, covers:[r1], verify, paths}] เท่านั้น
- **THEN** tasks.md มี T002 ที่ claims ของ r1
- **AND** claims ของ r1 อยู่ใน invalidatedClaims

#### Scenario: covers requirement ที่ไม่มี

- **WHEN** addTasks covers r-missing
- **THEN** amend ปฏิเสธว่า covers unknown requirement

#### Scenario: ไม่มี covers

- **WHEN** addTasks ไม่มี covers
- **THEN** amend ปฏิเสธว่า task ต้อง covers requirement

### Requirement: Completed-task refusals name the state they used

ระบบ SHALL ระบุในข้อความปฏิเสธ updateTasks ว่า task ถูกถือว่าเสร็จเพราะถูกติ๊กใน tasks.md ของ agreement หรือเพราะ claim มี receipt ที่ผ่านแล้ว

#### Scenario: task ไม่ติ๊กแต่มี receipt ผ่าน

- **GIVEN** T001 ไม่ติ๊กแต่ claim มี passing command receipt
- **WHEN** updateTasks เปลี่ยน verify ของ T001 โดยไม่ reopen
- **THEN** ข้อความระบุว่า T001 ถือว่าเสร็จเพราะ claim มี passing receipt และเสนอ addTasks หรือ reopen

#### Scenario: task ติ๊กแล้ว

- **GIVEN** T001 ติ๊กใน tasks.md
- **WHEN** updateTasks เปลี่ยน verify โดยไม่ reopen
- **THEN** ข้อความระบุว่า T001 ติ๊กแล้วใน tasks.md ของ agreement
