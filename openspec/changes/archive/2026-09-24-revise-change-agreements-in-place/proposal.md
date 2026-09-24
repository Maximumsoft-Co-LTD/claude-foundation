# Change: แก้ไข change ที่มีอยู่ได้โดยไม่ต้อง abandon แล้วเขียน draft ใหม่ทั้งหมด

## Why

ปัจจุบัน `change amend` รับได้แค่ `addRequirements` (semantic-amendment.mjs ปฏิเสธ key ที่มีอยู่แล้ว และห้ามเปลี่ยน outcome/verify ของ task) ส่วน `change start` ปฏิเสธ id ที่มีอยู่แล้ว เมื่อ agent พบข้อเท็จจริงใหม่ที่ต้องเปลี่ยน requirement เดิม (เช่น throughput 50 msg/s, ack ผ่าน Mongo outbox, On-Demand) ทางเดียวคือ `change abandon` แล้วเขียน draft v4 ใหม่ทั้งหมด ทำ discovery ใหม่ และขอ approve ทั้ง packet ใหม่ ผู้ใช้และ agent เสียเวลาและบริบท ผลที่ต้องการคือแก้ requirement เดิมได้ในที่เดิม ทั้งก่อน Build และระหว่าง Build และขอ approve ใหม่เฉพาะส่วนที่เปลี่ยน

## What changes

- ก่อน: แก้ requirement ของ change ที่ AGREED แล้วต้อง abandon + เขียน draft ใหม่ + approve ใหม่ทั้งหมด; หลัง: `change revise <change> <draft.json>` คอมไพล์ทับใน id เดิมแบบ atomic และรายงาน delta
- ก่อน: amendment ระหว่าง Build เพิ่มได้อย่างเดียว; หลัง: amendment รองรับ `reviseRequirements` และ `removeRequirements` โดย invalidate เฉพาะ claim/task/provider ที่ได้รับผลกระทบ
- ก่อน: หลังแก้ agreement ไม่มีรายการว่าอะไรเปลี่ยน; หลัง: runtime บันทึกและแสดง delta (added/revised/removed) ที่ต้องขอ approve ใหม่

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- ไม่แก้ agreement ที่ proven, landing หรือ archived (ยังต้องเปิด successor change)
- ไม่เปลี่ยนความหมายของ task ที่ทำเสร็จแล้วแบบเงียบ (ยังต้องเพิ่ม task ใหม่เมื่อ outcome/verify เปลี่ยน)
- ไม่ migrate change แบบ legacy และไม่เปลี่ยน protocol หรือ runtime API version
- ไม่ยกเลิก `change abandon`; ยังใช้สำหรับเลิกทำ change จริง

## Requirement discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | pre-build-revision, amendment-revises-and-removes | .claude/harness/runtime/workflow/semantic-amendment.mjs, .claude/harness/runtime/workflow/change-lifecycle.mjs, .claude/harness/runtime/workflow/validation/amendment-invalidation.mjs, .claude/harness/tests/semantic-draft.test.mjs | none |
| affected-actor | covered | pre-build-revision, amendment-revises-and-removes, delta-approval | WORKFLOW.md | none |
| desired-behavior | covered | pre-build-revision, amendment-revises-and-removes, delta-approval | none | none |
| success-path | covered | pre-build-revision, amendment-revises-and-removes, delta-approval | none | none |
| failure-path | covered | pre-build-revision, amendment-revises-and-removes | none | none |
| input-boundary | covered | pre-build-revision, amendment-revises-and-removes, delta-approval | none | none |
| compatibility | covered | amendment-revises-and-removes | .claude/harness/commands.json, cli.sh | none |
| non-goals | covered | pre-build-revision | none | none |
| verification | covered | pre-build-revision, amendment-revises-and-removes, delta-approval | .claude/tests/harness/run-proof-loop-tests.sh | none |
| data-migration | covered | pre-build-revision, amendment-revises-and-removes | .claude/harness/runtime/workflow/change-lifecycle.mjs | none |
| rollout-rollback | covered | pre-build-revision, amendment-revises-and-removes | none | none |
| recoverability | covered | pre-build-revision, amendment-revises-and-removes | none | none |
| performance-capacity-availability | not-applicable | none | .claude/harness/runtime/workflow/change-lifecycle.mjs | การ revise เป็นคำสั่ง local ครั้งเดียวต่อ change ขนาด packet เท่ากับ start/amend เดิม ไม่มี throughput หรือ availability target ใหม่ |

## Amendment discovery coverage

Reason: การเพิ่มคำสั่ง public `change revise` เปลี่ยน golden public command contract ที่ถูก freeze ไว้ จึงต้องอัปเดต fixture ของ contract ภายใต้ task ที่ครอบคลุม

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | revise-public-contract | .claude/harness/tests/public-command-golden.test.mjs | none |
| affected-actor | covered | revise-public-contract | none | none |
| desired-behavior | covered | revise-public-contract | none | none |
| success-path | covered | revise-public-contract | none | none |
| failure-path | covered | revise-public-contract | none | none |
| input-boundary | covered | revise-public-contract | none | none |
| compatibility | covered | revise-public-contract | .claude/harness/commands.json | none |
| non-goals | covered | revise-public-contract | none | none |
| verification | covered | revise-public-contract | none | none |
