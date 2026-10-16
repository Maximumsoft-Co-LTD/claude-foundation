# ประเภทงาน

## Purpose

ประเภทงานทั้งหมดพร้อมหัวข้อบังคับ skill และหลักฐาน

## ADDED Requirements

### Requirement: Every catalog work type is accepted and inferred

ระบบ SHALL รับประเภทงานทั้งหมดใน catalog รวม test และรูปแบบย่อย security และ hotfix ของ bugfix และใช้ชุดงานเบาชุดเดียวในทุกจุด

- อนุมานจาก path: terraform, helm, Dockerfile, k8s เป็น infra; manifest และ lockfile เป็น dependency; dashboards และ alerts เป็น observability; prompts และ evals เป็น ml
- ชุดงานเบาชุดเดียว: docs, test, chore; ชุดที่ไม่เปลี่ยนพฤติกรรม: refactor, config, docs, test, chore

#### Scenario: ประกาศ test

- **GIVEN** draft workType test
- **WHEN** change start
- **THEN** ผ่านและไม่ต้องมี design

#### Scenario: อนุมาน infra

- **GIVEN** task แตะ terraform/main.tf อย่างเดียว
- **WHEN** compile
- **THEN** work type เป็น infra

#### Scenario: ประเภทไม่รู้จัก

- **GIVEN** workType infrastructure
- **WHEN** change start
- **THEN** ได้ EDIT พร้อมรายชื่อประเภทที่รับ

### Requirement: Each work type routes to its skills

ระบบ SHALL route ประเภทงานใหม่ไป skill ตาม catalog

#### Scenario: route infra

- **GIVEN** change ประเภท infra
- **WHEN** advance ถึง Build
- **THEN** action แนะนำ delivery-engineering และ architecture-fundamentals

#### Scenario: งานเบาไม่ route

- **GIVEN** change ประเภท docs
- **WHEN** advance
- **THEN** ไม่มีคำแนะนำ skill ด้านพฤติกรรม

### Requirement: Each work type requires its evidence

ระบบ SHALL เพิ่ม capability ของหลักฐานตามประเภทงานใน catalog นอกเหนือจากที่ได้จาก path และ NFR

#### Scenario: ml ต้อง evaluation

- **GIVEN** change ประเภท ml
- **WHEN** compile
- **THEN** evidence ต้องการ capability evaluation

#### Scenario: ไม่มี provider

- **GIVEN** change ประเภท infra ที่ไม่มี provider plan-check
- **WHEN** Prove
- **THEN** advance คืน action ของ agent ให้ตั้ง provider พร้อม resume route โดยไม่ส่งงานนี้ให้ผู้ใช้

### Requirement: New gates always name an owner and a resume route

ระบบ SHALL ให้ทุก gate ใหม่ของ change นี้คืน action ที่ระบุเจ้าของและ resume route เสมอ โดยงานที่ agent แก้ได้เป็นของ agent และไม่มี gate ใดทำให้ change ไปไม่ถึง Land เพราะรอเหตุการณ์หลังปล่อยงาน

- gate ใหม่: หัวข้อบังคับ, field รายละเอียด, capability ตามประเภทงาน, โฟลเดอร์ v5, compliance และ budget
- หลักฐานหลังปล่อยงาน (release-health, experiment-guardrail) เป็น gate ของ rollout ใน handoff ไม่ใช่เงื่อนไขของ proof หรือ Land
- budget และคำเตือนเอกสารไม่ block

#### Scenario: ขาด field ได้ action ของ agent

- **GIVEN** draft ที่ขาด field บังคับ
- **WHEN** change start
- **THEN** action เป็น EDIT owner agent พร้อม resume route

#### Scenario: หลักฐานหลังปล่อยไม่ขวาง Land

- **GIVEN** change ประเภท client-release ที่ต้องการ release-health
- **WHEN** Prove และ Land
- **THEN** Land สำเร็จและ handoff มี gate release-health สำหรับ rollout

#### Scenario: compliance ขาดผู้อนุมัติ

- **GIVEN** compliance เปิดและ draft ไม่มี approver
- **WHEN** change start
- **THEN** ได้ ASK_USER หนึ่งข้อที่ระบุ compliance.approver และทำต่อได้ทันทีหลังได้คำตอบ

#### Scenario: ไม่มี gate ที่ไม่มีเจ้าของ

- **GIVEN** gate ใหม่ใดคืนผลที่ไม่มี owner หรือ resume
- **WHEN** รัน test ของ gate
- **THEN** test fail และระบุ gate นั้น
