# typed-design-fields Specification

## Purpose
field typed สำหรับ architecture, domain, contract, คุณภาพ, การปล่อยงาน และกระบวนการ
## Requirements
### Requirement: Design records boundaries and tenancy

ระบบ SHALL รับ ตรวจ และแสดง boundaries และ tenancy ใน design

#### Scenario: แสดง boundary

- **GIVEN** draft มี boundaries สองแถว
- **WHEN** compile
- **THEN** design มีตาราง boundary decisions สองแถวในหัวข้อ Architecture

#### Scenario: boundary ขาด timeout

- **GIVEN** boundary แบบ sync ไม่มี timeout
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ boundaries[0].timeout

### Requirement: Design records the domain model and modules

ระบบ SHALL รับ ตรวจ และแสดง domain ที่มี type ที่บังคับ invariant, state ที่ห้ามเกิด, module พร้อม interface และสิ่งที่ซ่อน, สิ่งที่ฉีดเข้า และ error สามกลุ่ม

#### Scenario: แสดง domain

- **GIVEN** draft มี domain
- **WHEN** compile
- **THEN** design มีตาราง type ตาราง module และรายการ error สามกลุ่ม

#### Scenario: module ไม่มี interface

- **GIVEN** module ไม่มี exposes
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ field

### Requirement: Contracts carry complete API, event, data, UI, and config detail

ระบบ SHALL รับ ตรวจ และแสดงรายละเอียดของ apiContracts, eventContracts, dataModel, ui และ configContract ตามรูปแบบใน outline โดย field เดิมยังใช้ได้

#### Scenario: API ครบ

- **GIVEN** apiContracts ที่มี errorEnvelope idempotency และ pagination
- **WHEN** compile
- **THEN** design มีตาราง error ต่อ status และสัญญา idempotency

#### Scenario: field เดิมยังผ่าน

- **GIVEN** apiContracts แบบเดิมที่มีแค่ method path auth request response errors
- **WHEN** compile
- **THEN** ผ่านและแสดงเหมือนเดิม

#### Scenario: idempotency ไม่ครบ

- **GIVEN** idempotency ที่ไม่มี scope
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ scope

### Requirement: Design records quality, security, and operability

ระบบ SHALL รับ ตรวจ และแสดง nfr, threatModel, observability, trackingPlan และ capacity ตามรูปแบบใน outline และสร้าง grounding จาก nfr และ observability ของ draft v5

#### Scenario: แสดง threat model

- **GIVEN** threatModel สามแถว
- **WHEN** compile
- **THEN** design มี asset trust boundary และตาราง STRIDE สามแถว

#### Scenario: v5 derive grounding

- **GIVEN** change.json v5 มี nfr และ observability
- **WHEN** compile
- **THEN** grounding.yaml มี nfr และ observability ที่ตรงกัน

#### Scenario: NFR ไม่มีเกณฑ์

- **GIVEN** nfr ไม่มี measure
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ measure

### Requirement: Design records delivery, rollback proof, and testing strategy

ระบบ SHALL รับ ตรวจ และแสดง rollout (deploy order, gates, การเปิดปิด, หลักฐาน rollback, version skew, ขั้นตอน upgrade, maturity, change window), testStrategy, dependencies, recovery และ capacity ตามรูปแบบใน outline

#### Scenario: แสดงการเปิดปิด

- **GIVEN** rollout มี enablement
- **WHEN** compile
- **THEN** design มีตารางคำถามการเปิดปิดหกข้อ

#### Scenario: rollback ไม่มีหลักฐาน

- **GIVEN** change impact high ที่มี rollout แต่ไม่มี rollbackProof
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ rollbackProof

### Requirement: Proposals record decisions, communication, and verification steps

ระบบ SHALL รับ ตรวจ และแสดง decisionLog, communication, releaseNote และ demo ใน proposal

#### Scenario: บันทึกคำตอบ

- **GIVEN** decisionLog สองแถว
- **WHEN** compile
- **THEN** proposal มีตารางคำถาม ตัวเลือก คำตอบ ผู้ตอบ และวันที่

#### Scenario: งานที่ผู้ใช้เห็นไม่มี release note

- **GIVEN** draft ประเภท api ที่ไม่มี releaseNote
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ releaseNote

### Requirement: Archived proposals carry review and compliance records

ระบบ SHALL เพิ่ม appendix ผล review และ compliance change record ใน proposal ที่ archive ตอน Land

- compliance change record เปิดด้วย compliance ใน openspec/config.yaml
- เมื่อเปิด compliance ผู้อนุมัติต้องไม่ใช่ผู้ทำและต้องมีการอนุมัติก่อน Build

#### Scenario: appendix review

- **GIVEN** change ที่ review มี finding สองข้อ
- **WHEN** Land และ archive
- **THEN** proposal ที่ archive มี appendix ผล review สองแถว

#### Scenario: compliance ปิดอยู่

- **GIVEN** config ไม่เปิด compliance
- **WHEN** archive
- **THEN** ไม่มี appendix compliance

#### Scenario: ผู้อนุมัติเป็นผู้ทำ

- **GIVEN** compliance เปิดและ approver เท่ากับ implementer
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ compliance.approver

### Requirement: Work-type sections carry their detail formats

ระบบ SHALL รับ ตรวจ และแสดง field รายละเอียดเฉพาะของแต่ละประเภทงานตามรูปแบบใน Work type catalog

- field: bugfix, refactor, libraryContract, migrationPlan, integrations, performanceAnalysis, dependencyChange, deprecationPlan, infraPlan, privacyAssessment, experimentDesign, releasePlan, modelCard
- bugfix.variant รับ security หรือ hotfix

#### Scenario: model card ครบ

- **GIVEN** draft ประเภท ml ที่มี modelCard ครบ
- **WHEN** compile
- **THEN** design มีหัวข้อ Model card พร้อม evaluation และ threshold

#### Scenario: bugfix แบบ security

- **GIVEN** bugfix variant security ที่มี disclosure
- **WHEN** compile
- **THEN** design มีหัวข้อ Disclosure ต่อจาก Bugfix analysis

#### Scenario: dependency ไม่มี provenance

- **GIVEN** draft ประเภท dependency ที่ไม่มี dependencyChange.provenance
- **WHEN** change start
- **THEN** ได้ EDIT ที่ระบุ dependencyChange.provenance

#### Scenario: bugfix เดิมยังผ่าน

- **GIVEN** bugfix แบบเดิมที่มี reproduction rootCause regression
- **WHEN** compile
- **THEN** ผ่านและแสดงเหมือนเดิม
