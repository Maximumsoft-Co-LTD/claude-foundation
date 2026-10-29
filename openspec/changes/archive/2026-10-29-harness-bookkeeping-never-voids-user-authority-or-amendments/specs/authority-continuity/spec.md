# authority-continuity

## Purpose

Harness bookkeeping never voids user authority or amendments.

## ADDED Requirements

### Requirement: budget-outside-fingerprint

ระบบ SHALL ไม่นับสิทธิ์ review wave เพิ่ม (grantedAiWaveCap) และ budget อื่นเป็นส่วนหนึ่งของ contract fingerprint

#### Scenario: grant หลัง final AI delta แล้วรัน wave ได้

- **GIVEN** final AI review delta ล้มเหลวและ receipt ผูกกับ contractFingerprint ปัจจุบัน
- **WHEN** user สั่ง authority extend-review แล้ว advance
- **THEN** deterministic review closure ไม่คืน CONTRACT_DECISION_REQUIRED
- **AND** contractFingerprint ก่อนและหลัง grant เท่ากัน
- **AND** wave ที่ได้สิทธิ์ถูก dispatch

#### Scenario: grant ไม่ทำให้ receipt provider อื่น stale

- **GIVEN** receipt test/lint ผ่านและผูก contractFingerprint ปัจจุบัน
- **WHEN** user สั่ง authority extend-review
- **THEN** receipt เหล่านั้นยัง valid และไม่ถูกรันซ้ำ

#### Scenario: ข้อตกลงเปลี่ยนจริงยังถูกจับได้

- **GIVEN** final AI review delta ล้มเหลว
- **WHEN** amendment เพิ่ม requirement ใหม่โดยไม่มี decision revision
- **THEN** review closure ยังคืน CONTRACT_DECISION_REQUIRED พร้อม command เดิม

### Requirement: amendment-survives-approval

ระบบ SHALL ถือว่า packet ใน sandbox ที่ตรงกับ amendment ที่ harness บันทึกไว้เป็นข้อตกลงที่ถูกต้อง ไม่ใช่ drift

#### Scenario: amend แล้ว reopen grounding แล้ว approve

- **GIVEN** change อยู่ใน Build/Prove, amendment แก้ verify ถูกบันทึกที่ revision N, reopen-grounding และ validate ขยับเป็น N+1
- **WHEN** advance --approve-spec --decision-ref <ref>
- **THEN** tasks.md ใน sandbox ยังเป็นเวอร์ชันหลัง amend
- **AND** ไม่มี snapshot ใหม่ใน .foundation/agreement-drift/<id>/
- **AND** approval ถูกบันทึกด้วย identity ของ packet ใน sandbox

#### Scenario: amendment หลายรอบคงรอบล่าสุด

- **GIVEN** มี amendment ที่ revision N และ N+2 และ bookkeeping bump ที่ N+1 และ N+3
- **WHEN** approve-spec หรือ advance ตรวจ approval
- **THEN** packet ใน sandbox ที่ตรงกับ amendment ล่าสุดถือว่าถูกต้อง

#### Scenario: แก้ packet นอก amendment ยังถูก restore

- **GIVEN** agent แก้ proposal.md ใน sandbox ด้วยมือหลัง amendment ล่าสุด
- **WHEN** advance --approve-spec
- **THEN** harness restore ข้อความที่ amend ไว้ล่าสุด (ไม่ใช่ root packet เก่า) และเก็บสำเนาที่แก้ไว้ใน .foundation/agreement-drift/<id>/

### Requirement: authority-binds-to-content

ระบบ SHALL ผูก spec approval, approval lane, waiver, Decision Sheet revision และ task lease กับเนื้อหาข้อตกลง ไม่ใช่ตัวนับ contractRevision

#### Scenario: reopen grounding คง spec approval

- **GIVEN** spec ถูก approve แล้วและ grounding ถูก lock
- **WHEN** change resolve --reopen-grounding แล้ว change validate โดย requirement, claim และ task ไม่เปลี่ยน
- **THEN** advance ไม่ขอ approve-spec ใหม่
- **AND** specApproval.revision ถูก carry ไปที่ revision ใหม่พร้อม audit row

#### Scenario: reopen grounding คง waiver และ lease

- **GIVEN** มี waiver ที่ผูก workspace ปัจจุบัน และ agent ถือ task lease อยู่
- **WHEN** reopen-grounding และ validate โดยเนื้อหาข้อตกลงเท่าเดิม
- **THEN** waiver ยังอยู่ใน currentWaivers และ lease ไม่ถูกรายงานว่า stale

#### Scenario: approval lane ตาม identity

- **GIVEN** approval.roles กำหนด 2 lane และทั้งสองอนุมัติแล้ว
- **WHEN** bookkeeping bump โดย packet identity เท่าเดิม
- **THEN** ทั้งสอง lane ยังนับว่าอนุมัติ

#### Scenario: เนื้อหาเปลี่ยนยังต้องขอใหม่

- **GIVEN** spec ถูก approve แล้ว
- **WHEN** reopen grounding ทำให้ grounding.yaml หรือ requirement เปลี่ยน identity
- **THEN** advance ขอ approve-spec ใหม่ และ waiver ที่ผูกเนื้อหาเดิมถูกรายงานว่าหมดอายุ

#### Scenario: state เดิมที่ไม่มี field ใหม่

- **GIVEN** runtime state ของ change ที่สร้างด้วย 3.6.8 ซึ่งผูกสิทธิ์ด้วย revision เท่านั้น
- **WHEN** โหลดและ advance ด้วย runtime ใหม่
- **THEN** สิทธิ์เดิมที่ revision ตรงกันยังใช้ได้ ไม่ถูกขอซ้ำ

### Requirement: restore-names-files

ระบบ SHALL แสดงรายชื่อไฟล์ที่จะถูก restore และตำแหน่งสำเนาก่อนทับ packet ใน sandbox

#### Scenario: notice ระบุไฟล์

- **GIVEN** packet ใน sandbox ถูกแก้นอก amendment ที่ tasks.md และ design.md
- **WHEN** harness restore
- **THEN** notice ระบุ tasks.md และ design.md และ path ของสำเนาใน .foundation/agreement-drift/<id>/

#### Scenario: ไม่มีไฟล์ต่างกัน

- **GIVEN** ต่างกันเฉพาะ whitespace
- **WHEN** harness ตรวจ drift
- **THEN** ซ่อม whitespace ในที่ โดยไม่มี notice restore
