# work-type-catalog Specification

## Purpose
ประเภทงานทั้งหมดพร้อมหัวข้อบังคับ skill และหลักฐาน
## Requirements
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

### Requirement: work-type-signals

ระบบ SHALL คืน EDIT ที่ระบุ workType ที่ขาด เมื่อ draft ประกาศ workType แต่ไม่มี type ที่สัญญาณ typed บังคับ ได้แก่ integrations หรือ riskSignals external-integration บังคับ integration และ performance-slo บังคับ performance

#### Scenario: integration ที่ประกาศเป็น feature

- **GIVEN** draft ประกาศ workType feature และ riskSignals external-integration
- **WHEN** agent รัน change start
- **THEN** harness คืน EDIT ให้เพิ่ม workType integration โดยไม่เริ่ม change

#### Scenario: ประกาศถูกแล้วผ่าน

- **GIVEN** draft ประกาศ workType integration พร้อม block integrations
- **WHEN** agent รัน change start
- **THEN** ไม่มี EDIT เรื่อง workType

#### Scenario: ไม่ประกาศ workType ใช้การเดาเดิม

- **GIVEN** draft ไม่มี workType
- **WHEN** agent รัน change start
- **THEN** harness เดา workType จาก path เหมือนเดิมและไม่คืน EDIT เรื่องนี้

### Requirement: new-work-types

ระบบ SHALL รับ work type data-fix, security และ cicd และรวมสามชนิดนี้ในรายชื่อที่ตอบกลับเมื่อประกาศประเภทที่ไม่รู้จัก

#### Scenario: ประกาศชนิดใหม่

- **GIVEN** draft ประกาศ workType data-fix หรือ security หรือ cicd พร้อม section บังคับของชนิดนั้น
- **WHEN** รัน change start
- **THEN** ผ่านการตรวจชนิดงาน และไม่ถูกมองเป็น code หรือ chore

#### Scenario: ชนิดไม่รู้จัก

- **GIVEN** draft ประกาศ workType hardening
- **WHEN** รัน change start
- **THEN** ได้ EDIT พร้อมรายชื่อประเภทที่รับซึ่งมี data-fix, security และ cicd

#### Scenario: ชนิดเดิมไม่เปลี่ยน

- **GIVEN** draft ประกาศ workType data หรือ migration
- **WHEN** รัน change start
- **THEN** ใช้ section บังคับเดิม ไม่ถูกจัดเป็น data-fix

### Requirement: data-fix-sections

draft ประเภท data-fix SHALL มี dataFix ที่ระบุ scope snapshot dryRun rerunSafe และ rollback และใช้ capability data-migration เป็นหลักฐาน

#### Scenario: ครบ

- **GIVEN** dataFix มี scope snapshot dryRun rerunSafe rollback
- **WHEN** รัน change start
- **THEN** ผ่าน และ evidence ต้องการ capability data-migration

#### Scenario: ขาด snapshot

- **GIVEN** dataFix ไม่มี snapshot
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ dataFix.snapshot ที่ขาด

#### Scenario: ไม่มี dataFix

- **GIVEN** workType data-fix แต่ไม่มี dataFix
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุว่าต้องมี dataFix พร้อมรูปแบบ

#### Scenario: ระบุไม่ทราบ

- **GIVEN** dataFix.scope เป็น unknown: นับแถวไม่ได้จนกว่าจะรัน dry run
- **WHEN** รัน change start
- **THEN** ผ่าน และการ์ดแสดง ไม่ทราบ พร้อมเหตุผล

### Requirement: security-sections

draft ประเภท security SHALL มี threatModel และ hardening ที่ระบุ weakness control และ verification และใช้ capability security-static เป็นหลักฐาน

#### Scenario: ครบ

- **GIVEN** มี threatModel และ hardening ครบสามฟิลด์
- **WHEN** รัน change start
- **THEN** ผ่าน และ evidence ต้องการ capability security-static

#### Scenario: ขาด verification

- **GIVEN** hardening ไม่มี verification
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ hardening.verification ที่ขาด

### Requirement: cicd-sections

draft ประเภท cicd SHALL มี pipelinePlan ที่ระบุ changes permissions blastRadius และ rollback และระบบ SHALL อนุมาน cicd จาก path ของ workflow และไฟล์ pipeline เมื่อไม่ประกาศ workType

#### Scenario: อนุมานจาก path

- **GIVEN** task แตะ .github/workflows/ci.yml อย่างเดียวและไม่ประกาศ workType
- **WHEN** compile
- **THEN** work type เป็น cicd และต้องมี pipelinePlan

#### Scenario: ขาดสิทธิ์

- **GIVEN** pipelinePlan ไม่มี permissions
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ pipelinePlan.permissions ที่ขาด

#### Scenario: ไม่เพิ่ม provider

- **GIVEN** change ประเภท cicd และโปรเจกต์ไม่มี provider เพิ่ม
- **WHEN** Prove
- **THEN** ไม่มี capability ที่ต้องตั้ง provider เพิ่มนอกเหนือจาก test

### Requirement: per-type-required-fields

draft ประเภท ml SHALL มี modelCard.evaluation ประเภท experiment SHALL มี guardrails และ stopRules และประเภท infra SHALL มี costDelta โดยแต่ละฟิลด์ระบุ ไม่มี หรือ ไม่ทราบ พร้อมเหตุผลได้ และการขาดทั้งหมดได้ EDIT ของ agent ที่ระบุฟิลด์นั้น

#### Scenario: ml ขาด evaluation

- **GIVEN** modelCard ไม่มี evaluation
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ modelCard.evaluation

#### Scenario: experiment ขาด stopRules

- **GIVEN** experimentDesign มี guardrails แต่ไม่มี stopRules
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ experimentDesign.stopRules

#### Scenario: infra ขาด costDelta

- **GIVEN** infraPlan ไม่มี costDelta
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุ infraPlan.costDelta

#### Scenario: change ที่เริ่มแล้ว

- **GIVEN** change ประเภท ml ที่เริ่มหรืออนุมัติแล้วโดยไม่มี evaluation
- **WHEN** รัน advance หรือ change amend
- **THEN** ไม่ถูกบล็อกด้วยกฎนี้

#### Scenario: ระบุไม่ทราบ

- **GIVEN** experimentDesign.stopRules เป็น unknown: ยังไม่กำหนด รอผลการทดลองรอบแรก
- **WHEN** รัน change start
- **THEN** ผ่าน และการ์ดแสดง ไม่ทราบ พร้อมเหตุผล

### Requirement: undo-required-high

draft ที่ระดับความเสี่ยง High หรือ Critical SHALL ระบุวิธีย้อนกลับด้วย scratch.undo หรือฟิลด์ rollback ที่มีอยู่ หรือระบุชัดว่าไม่มีพร้อมเหตุผล และการขาดทั้งหมดได้ EDIT ของ agent

#### Scenario: high ไม่มี undo

- **GIVEN** draft impact high และไม่มี scratch.undo หรือ rollback ใดเลย
- **WHEN** รัน change start
- **THEN** ได้ EDIT ระบุว่าต้องมี scratch.undo หรือ rollback field

#### Scenario: มี rollback เดิม

- **GIVEN** draft high ที่มี rollout.rollback
- **WHEN** รัน change start
- **THEN** ผ่านโดยไม่ต้องมี scratch.undo

#### Scenario: ระดับ medium

- **GIVEN** draft impact medium ที่ไม่มีสัญญาณหนัก และไม่มี undo
- **WHEN** รัน change start
- **THEN** ผ่าน ไม่ถูกบังคับ undo

#### Scenario: amend ไม่ถูกบล็อก

- **GIVEN** change ที่เริ่มแล้วและ amendment ระบุ impact high
- **WHEN** รัน change amend
- **THEN** ไม่ถูกบล็อกด้วยกฎ undo

#### Scenario: ระบุว่าย้อนกลับไม่ได้

- **GIVEN** draft high ที่ scratch.undo เป็น none: ย้อนกลับไม่ได้เพราะส่งอีเมลออกไปแล้ว
- **WHEN** รัน change start
- **THEN** ผ่าน ไม่ถูกบังคับให้แต่งวิธีย้อนกลับ

### Requirement: path-risk-note

change start SHALL พิมพ์ NOTE เมื่อ path ที่ task แตะบ่งชี้สัญญาณเสี่ยงที่ draft ไม่ประกาศและไม่มี discovery coverage ที่ตรงกัน และ NOTE SHALL ไม่บล็อกการ start

#### Scenario: path เสี่ยงไม่มี coverage

- **GIVEN** task แตะ db/migrations/0042.sql และ draft ไม่มีสัญญาณ persisted-data-change
- **WHEN** รัน change start
- **THEN** พิมพ์ NOTE ระบุ path และหัวข้อ coverage ที่ขาด และ start สำเร็จ

#### Scenario: มี coverage แล้ว

- **GIVEN** draft ประกาศสัญญาณและมี coverage ครบ
- **WHEN** รัน change start
- **THEN** ไม่พิมพ์ NOTE

#### Scenario: ไม่มี path เสี่ยง

- **GIVEN** task แตะ src/util.mjs
- **WHEN** รัน change start
- **THEN** ไม่พิมพ์ NOTE

### Requirement: never-blocks-land

ทุก gate ใหม่ของ change นี้ SHALL เป็นของ agent ยอมรับค่า ไม่มี หรือ ไม่ทราบ ที่ระบุเหตุผลเป็นคำตอบที่ถูกต้อง และไม่ถามผู้ใช้หรือกั้น advance และ Land หลัง start

#### Scenario: ระบุไม่ทราบพร้อมเหตุผล

- **GIVEN** infraPlan.costDelta เป็น unknown: ผู้ให้บริการยังไม่เผยแพร่ราคา
- **WHEN** รัน change start
- **THEN** ผ่านการตรวจ และหน้า package แสดง ไม่ทราบ พร้อมเหตุผลนั้น

#### Scenario: ระบุไม่มีวิธีย้อนกลับ

- **GIVEN** draft high ที่ scratch.undo เป็น none: ลบข้อมูลถาวรย้อนกลับไม่ได้
- **WHEN** รัน change start
- **THEN** ผ่านการตรวจ และการ์ดแสดงข้อความนั้นในช่อง ย้อนกลับได้ไหม

#### Scenario: ไม่มีเหตุผล

- **GIVEN** ค่าเป็น unknown: โดยไม่มีเหตุผลต่อท้าย
- **WHEN** รัน change start
- **THEN** ได้ EDIT ของ agent ที่ระบุฟิลด์นั้นและบอกรูปแบบ unknown: เหตุผล

#### Scenario: ไม่ถามผู้ใช้

- **GIVEN** draft ขาดส่วนบังคับใดๆ ของ change นี้
- **WHEN** รัน change start
- **THEN** action เป็น EDIT owner agent พร้อม resume route และไม่เป็น ASK_USER

#### Scenario: หลัง start ไม่ขวาง Land

- **GIVEN** change ที่ start แล้วและมีส่วนบังคับใหม่ขาด หรือ path เสี่ยงที่ไม่มี coverage
- **WHEN** รัน advance ถึง archived
- **THEN** กฎใหม่ไม่ทำให้ Prove หรือ Land หยุด
