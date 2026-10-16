# review-authority Specification

## Purpose
TBD - created by archiving change fix-review-authority-guards-and-land-recovery-defects. Update Purpose after archive.
## Requirements
### Requirement: Receipt reconciliation compares latest attempt to latest receipt

The review-authority guard SHALL treat a completed AI response as unrecorded
only when the latest delivered AI attempt (excluding errored completions) is
newer in the attempt chain than the newest recorded receipt of any reviewer
type, and SHALL NOT block dispatch, record, or run merely because an earlier
receipt was overwritten by a later one or superseded by a human receipt.

#### Scenario: Delta receipt overwrote the full receipt

- **WHEN** two AI reviews were delivered and the recorded receipt's attempt
  digest names the later delta attempt
- **THEN** authority dispatch, record, and run proceed without the
  "no matching recorded receipt" refusal

#### Scenario: Human receipt superseded the AI receipt

- **WHEN** a delivered AI review was followed by a recorded human review whose
  receipt replaced the AI attempt digest
- **THEN** authority commands proceed without the "no matching recorded
  receipt" refusal

#### Scenario: Errored completion is not a delivered response

- **WHEN** an AI attempt completed with result status "error" and no receipt
- **THEN** the guard does not count it as a delivered response awaiting a
  receipt

#### Scenario: Genuinely unrecorded response still blocks

- **WHEN** the latest delivered AI attempt has no recorded receipt and no
  later attempt of any type has been recorded
- **THEN** authority dispatch, record, and run refuse with the
  "no matching recorded receipt" error

### Requirement: Reviewer request schema is portable to structured-output providers

The configured reviewer request schema SHALL NOT contain the `uniqueItems`
keyword, and the response validator SHALL reject duplicate finding IDs,
duplicate `claimIds`, duplicate `verificationCaseIds`, and duplicate
`verifiedFindingIds` after parsing.

#### Scenario: Schema accepted by structured output

- **WHEN** the reviewer request schema is serialized for a structured-output
  provider
- **THEN** it contains no `uniqueItems` keyword

#### Scenario: Duplicates still refused

- **WHEN** a reviewer response carries duplicate IDs in any of its ID lists
- **THEN** the response is rejected as invalid

### Requirement: Bounded reset of the reviewer infrastructure retry

The system SHALL provide `authority reset-infra <change> --decision-ref <ref>`
which, when the prove-stage provider diagnosis passes and the decision
reference has not been used before, acknowledges the consumed reviewer
infrastructure attempts so they no longer count against the infrastructure
retry bound, without mutating the recorded attempt chain.

#### Scenario: Harness resets once per review wave and reviewer configuration

- **WHEN** a review dispatch finds the infrastructure retry exhausted and the
  configured reviewer diagnosis passes
- **THEN** the harness acknowledges the consumed attempts under the reference
  `harness:infra:wave-<n>:<reviewer-configuration>` without a user decision
- **AND** a second exhaustion in the same wave under the same configuration
  keeps the bound consumed and names the reviewer's owner, not the user
- **AND** a repaired, changed reviewer configuration earns its own reset

The `authority reset-infra` primitive remains an operator override.

#### Scenario: Harness releases a base-move expiry

- **WHEN** a review dispatch finds a recorded sandbox base move that changed
  the diff and expired a delivered passing verdict, and no AI review is live
- **THEN** the harness releases exactly that attempt under the reference
  `harness:base-move:<movement>` without a user decision

#### Scenario: Reset after provider repair

- **WHEN** the infrastructure retry is exhausted, the provider diagnosis
  passes, and a fresh decision reference is supplied
- **THEN** a subsequent AI review dispatch is permitted and the acknowledged
  attempt digests are recorded in the review history

#### Scenario: Failing diagnosis refuses

- **WHEN** the provider diagnosis fails
- **THEN** the reset is refused and the retry bound stays consumed

#### Scenario: Reused decision reference refuses

- **WHEN** the supplied decision reference was already used for a reset on the
  change
- **THEN** the reset is refused

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
