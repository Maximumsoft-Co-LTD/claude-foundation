# Decision ที่คงอยู่

## Purpose

decision แบบ ADR ย่อที่ตามไปเป็นเหตุผลใน spec ถาวร

## ADDED Requirements

### Requirement: Decisions carry status and full options

ระบบ SHALL แสดง decision แบบ ADR ย่อที่มีสถานะ proposed, accepted หรือ superseded พร้อม drivers ตัวเลือกพร้อมข้อดีข้อเสีย ผลที่ตามมา และสิ่งที่ใช้ยืนยัน

#### Scenario: option เป็น object

- **GIVEN** decision ที่ rejected เป็น object มี option และ reason
- **WHEN** compile
- **THEN** design แสดง option และเหตุผล ไม่มี [object Object]

#### Scenario: proposed รอตัดสิน

- **GIVEN** decision สถานะ proposed
- **WHEN** compile
- **THEN** proposal แสดงในเรื่องที่ต้องให้ผู้ใช้ตัดสิน

#### Scenario: สถานะไม่รู้จัก

- **GIVEN** status เป็น draft
- **WHEN** change start
- **THEN** ได้ EDIT พร้อมสถานะที่รับ

### Requirement: Durable decisions become requirement rationale

ระบบ SHALL แสดงบรรทัด Rationale ใต้ requirement ใน spec delta สำหรับ decision ที่ accepted และ durable ซึ่งผูกกับ requirement นั้น

#### Scenario: Rationale ใน spec

- **GIVEN** decision durable ผูก requirement R1
- **WHEN** compile
- **THEN** spec delta ของ R1 มีบรรทัด Rationale พร้อม decision id

#### Scenario: หลัง archive

- **GIVEN** change ที่มี Rationale
- **WHEN** Land และ archive
- **THEN** openspec/specs มีบรรทัด Rationale

#### Scenario: decision ไม่ durable

- **GIVEN** decision accepted ที่ไม่ durable
- **WHEN** compile
- **THEN** spec ไม่มี Rationale ของ decision นั้น
