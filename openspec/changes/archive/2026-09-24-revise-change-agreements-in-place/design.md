# Design

## Current state

- `.claude/harness/runtime/workflow/semantic-amendment.mjs`: `compileSemanticAmendment` บังคับ `addRequirements` ไม่ว่าง ปฏิเสธ key ซ้ำ และเพิ่ม claim ต่อท้ายเท่านั้น
- `.claude/harness/runtime/workflow/validation/amendment-invalidation.mjs`: รองรับ `changedClaimIds` แล้ว แต่ `removedClaimIds` ถูก BLOCK (`REMOVED_CLAIM_HISTORY_REQUIRED`) เพราะไม่มี binding ของ claim เดิม
- `.claude/harness/runtime/workflow/change-lifecycle.mjs`: `startAtomic` คอมไพล์ draft ใหม่พร้อม rollback แต่ `assertChangeAvailable` ปฏิเสธ id เดิม; `amendChangeUnlocked` เป็น transaction แบบ stage/rename/rollback ที่นำมาใช้ซ้ำได้
- `.claude/harness/runtime/core/cli-router.mjs`, `cli.sh`, `.claude/harness/commands.json`, `.claude/harness/runtime/core/lifecycle-phase.mjs`: ทะเบียนคำสั่ง `change amend`/`abandon` ที่ต้องเพิ่ม `change revise` แบบ lockstep
- การ approve (`change resolve --approve-spec`) ผูก identity ของเนื้อหา agreement ทั้งหมด จึงหมดอายุเองเมื่อ packet เปลี่ยน

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| `none` | This change introduces no project-specific term. | `none` |

## Decisions

`none`

## Compatibility and migration

คำสั่งและ argument เดิมทั้งหมดคงเดิม amendment v1 ที่มีแค่ `addRequirements` ทำงานเหมือนเดิมทุกไบต์ของผลลัพธ์ `reviseRequirements`/`removeRequirements` เป็น field เสริมใน amendment version 1 `change revise` เป็นคำสั่งใหม่แบบ additive จึงไม่ต้องเปลี่ยน protocol.json หรือ runtime API pin agreement แบบ legacy (ไม่ใช่ semantic v3/v4) ยังใช้เส้นทางเดิม

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| none | none | none |
