# การสังเกตการณ์ข้าม change

outcomes และ lessons เป็น rollup แบบอ่านอย่างเดียว

## ADDED Requirements

### Requirement: Cross-change outcomes are a read-only rollup

ระบบ SHALL ให้คำสั่ง outcomes สรุปผลลัพธ์ของทุก change ที่ archive แล้วโดยไม่เขียน state ใด

- cohort = workType × impact × riskSignals (เรียงและ join)
- firstProofPass = true เมื่อ proofRuns เท่ากับ 1 และ reviewRepairRounds เท่ากับ 0; null เมื่อไม่มี evidence directory
- userDecisions = จำนวน advanceRecovery.answers + waivers + groundingReopens ที่บันทึก (นับเฉพาะคำตอบที่บันทึก ไม่ใช่คำถามที่ถาม)
- cost = ผลรวม cost ที่รู้จาก events.jsonl; null เมื่อไม่มี event ที่มี cost
- escapedDefects = จำนวน change อื่นที่ fixes อ้าง change นี้; availability declared-only
- อัตราต่อ cohort คำนวณจากค่าที่รู้เท่านั้น และรายงาน denominator กับ unknownCount
- --pretty แสดงตาราง; ค่าเริ่มต้นเป็น JSON

#### Scenario: สรุป change ที่ archive

- **GIVEN** มี change ที่ archive สองตัว ตัวหนึ่ง proof ครั้งเดียวไม่มี repair อีกตัว proof สองครั้ง
- **WHEN** รัน outcomes
- **THEN** ตัวแรก firstProofPass true ตัวที่สอง false และ cohort rate เท่ากับ 0.5 denominator 2

#### Scenario: ค่าที่ไม่รู้เป็น null

- **GIVEN** change ที่ archive ไม่มี events.jsonl
- **WHEN** รัน outcomes
- **THEN** cost เป็น null และ cohort นับเป็น unknownCount ไม่ใช่ 0

#### Scenario: escaped defect จาก fixes

- **GIVEN** change b ประกาศ fixes [a]
- **WHEN** รัน outcomes
- **THEN** a มี escapedDefects 1

#### Scenario: ไม่เขียน state

- **GIVEN** store .foundation มี digest D ก่อนรัน
- **WHEN** รัน outcomes
- **THEN** digest ของ store หลังรันเท่ากับ D

#### Scenario: ไม่มีประวัติ

- **GIVEN** ไม่มี change ที่ archive
- **WHEN** รัน outcomes
- **THEN** exit 0 พร้อม changes ว่างและ cohorts ว่าง

#### Scenario: state เสียหนึ่งตัว

- **GIVEN** runtime state ของ change หนึ่งเป็น JSON ที่ parse ไม่ได้
- **WHEN** รัน outcomes
- **THEN** change นั้นอยู่ใน skipped พร้อม reason และ change อื่นยังถูกสรุป

### Requirement: Recurring problems become advisory check proposals

ระบบ SHALL ให้คำสั่ง lessons จัดกลุ่ม blocker code และ review finding code ที่เกิดซ้ำข้าม change และเสนอ check ถาวรแบบ advisory

- recurring เมื่อเกิดใน change ที่แตกต่างกันอย่างน้อย --min-changes (ค่าเริ่มต้น 3)
- ตาราง mapping คงที่จาก code ไปชนิด check เช่น authority-required/permission → authorization test, contract-invalid → contract/compatibility check, workspace-boundary → dependency rule, idempotency → idempotency test; code ที่ไม่มี mapping เสนอ investigate
- blocker untyped และ finding ที่ไม่มี code รายงานรวมเป็นจำนวน uncoded แยกต่างหาก ไม่นับเป็น lesson
- ไม่ export reason แบบข้อความอิสระ

#### Scenario: code เกิดซ้ำ

- **GIVEN** blocker contract-invalid เกิดใน change สามตัว
- **WHEN** รัน lessons
- **THEN** มี lesson code contract-invalid source blocker changes สามตัว และ suggestedCheck contract-compatibility-check

#### Scenario: ต่ำกว่าเกณฑ์

- **GIVEN** finding code missing-authz เกิดใน change สองตัว และ min-changes ค่าเริ่มต้น
- **WHEN** รัน lessons
- **THEN** ไม่มี lesson ของ missing-authz

#### Scenario: uncoded แยกรายงาน

- **GIVEN** มี review finding ไม่มี code 99 รายการ
- **WHEN** รัน lessons
- **THEN** uncoded.review เท่ากับ 99 และไม่มี lesson จากรายการเหล่านั้น

#### Scenario: ไม่เขียน state

- **GIVEN** store .foundation มี digest D ก่อนรัน
- **WHEN** รัน lessons
- **THEN** digest ของ store หลังรันเท่ากับ D

#### Scenario: min-changes ผิด

- **GIVEN** ผู้เรียกส่ง --min-changes 0
- **WHEN** รัน lessons
- **THEN** exit ไม่ใช่ 0 พร้อมข้อความว่า min-changes ต้องเป็นจำนวนเต็มอย่างน้อย 2
