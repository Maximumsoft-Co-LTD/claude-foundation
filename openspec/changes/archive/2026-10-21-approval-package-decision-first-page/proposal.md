# Change: หน้า approval package ให้คนไม่เขียนโค้ดตัดสินใจได้ในหน้าเดียว

- **Change:** `approval-package-decision-first-page` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-21

## เหตุผล

หน้า approval package ปัจจุบันเป็นตารางเทคนิคตาม role ที่เปิดค้างไว้ ไม่บอกว่าผู้อนุมัติต้องตัดสินใจอะไรหรือพิมพ์ตอบอะไร ทำให้คนที่ไม่เขียนโค้ดอนุมัติได้ยาก change นี้จัดหน้าใหม่ให้สรุปและผลของการอนุมัติมาก่อน พับรายละเอียดผู้ตรวจ และบังคับให้ change ระดับ medium ขึ้นไปมีสรุป scratch ก่อนขออนุมัติ

## User story

- **P1** ในฐานะ ผู้อนุมัติที่ไม่เขียนโค้ด ฉันต้องการ เห็นสรุปและผลของการอนุมัติก่อนรายละเอียดเทคนิค เพื่อ ตัดสินใจและตอบในแชทได้โดยไม่ต้องอ่านตารางเทคนิค Requirement: decision-first-page, copyable-decision-bar, chat-approval-card.
- **P2** ในฐานะ ผู้ตรวจ (tech-lead, qa) ฉันต้องการ เข้าถึงรายละเอียดเทคนิคครบจากส่วนที่พับ เพื่อ ตรวจได้เหมือนเดิมโดยไม่สูญเสียข้อมูล Requirement: reviewer-details-collapsed.
- **P2** ในฐานะ ผู้ใช้ที่ขออนุมัติ change ระดับ medium ขึ้นไป ฉันต้องการ ให้ระบบบังคับให้มีสรุป scratch เพื่อ หน้าอนุมัติไม่เคยไม่มีสรุป Requirement: scratch-required-medium.

## เกณฑ์ความสำเร็จ

- หน้า package ที่มี scratch ครบมีลำดับ หัว ความเสี่ยง สรุป แถบขอบเขต ตัวอย่าง รายละเอียดที่พับ แถบตัดสินใจ ตามที่ test ตรวจทั้ง th และ en
- draft ระดับ medium ที่ไม่มี scratch ถูกคืน EDIT 100% ของเคสที่ทดสอบ และ change ที่เริ่มแล้วไม่ถูกบล็อก

## ขอบเขต

- **In scope (`approval-package`):** ผู้อนุมัติเห็นสิ่งที่ต้องตัดสินใจโดยไม่ต้องเลื่อนผ่านตารางเทคนิค; รายละเอียดผู้ตรวจยังเข้าถึงได้แต่ไม่บังการตัดสินใจ; ผู้ใช้รู้ว่าต้องพิมพ์อะไรในแชทและรู้ผลก่อนตอบ; หน้าอนุมัติของ change เสี่ยงปานกลางขึ้นไปไม่เคยไม่มีสรุป; ผู้ใช้ตอบอนุมัติได้ในแชทโดยไม่ต้องเปิดไฟล์
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/runtime/workflow/scratch-blocks.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, … +9 more; the authored Non-goals below

## Non-goals

- ไม่เปลี่ยน protocol.json หรือชื่อคำสั่งสาธารณะ
- ไม่ทำปุ่มส่งกลับ session จากหน้า HTML
- ไม่ลดทอน router โดเมน หรือ role lanes

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้า approval package อ่านง่ายขึ้นและ medium ขึ้นไปต้องมีสรุป scratch ก่อนขออนุมัติ

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| decision-first-page | สรุปมาก่อน | success | T001, T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่ทราบตัวเลขขอบเขต | boundary | T001, T003 |  |  |
|  | ไม่มี scratch | failure | T001, T003 |  |  |
| reviewer-details-collapsed | พับรายละเอียด | success | T001 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มีไฟล์ mermaid | failure | T001 |  |  |
| copyable-decision-bar | ยังไม่อนุมัติ | success | T001 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | อนุมัติแล้ว | boundary | T001 |  |  |
|  | ไม่มี script เพิ่ม | boundary | T001 |  |  |
|  | lane ยังไม่ครบ | failure | T001 |  |  |
| scratch-required-medium | low ไม่มี scratch | boundary | T002, T003 | test: `.claude/harness/tests/**` | — |
|  | change เดิมที่อนุมัติแล้ว | boundary | T002, T003 |  |  |
|  | medium ไม่มี scratch | failure | T002, T003 |  |  |
| chat-approval-card | ถามด้วยการ์ด | success | T003 | test | — |
|  | ใช้ถ้อยคำเดิม | boundary | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (14).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | decision-first-page, scratch-required-medium |  |  |
| input-boundary | not-applicable |  |  | ไม่มีค่าจากภายนอกโปรแกรม ข้อมูลมาจาก draft ที่ผ่าน esc() เดิม |
| compatibility | covered | scratch-required-medium, chat-approval-card |  |  |
| non-goals | covered | copyable-decision-bar |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (4); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 2 | f-skill-card-wording: The chat-approval-card requirement names both the `change` command and the `change` skill, but only `.claude/commands/change.md` carries the new four-line card and four-option wording. `.claude/skills/change/SKILL.md` and its `references/workflow.md` are not in the changed surface, so an agent that enters through the skill does not get the card instruction. WORKFLOW.md already carries the "ลุยเลย"/"approve" rule. This is non-blocking. (root/.claude/commands/change.md:35) | minor | ยังเปิดอยู่ | claude-opus |
| 2 | f-approved-banner-identity: `approvalStatus` calls a spec approved when `specApproval.identity` exists and its revision equals `contractRevision`. It does not check that the identity still matches the packet content (`approvalMatches`) or that `specApproval.required` is set. A packet edited in place after approval at the same revision would show "Already approved" and hide the reply lines, while `assertSpecApproval` would still reject it. The spec only says "approved and revision unchanged", so this is advisory. (root/.claude/harness/runtime/workflow/approval-package.mjs:273) | minor | ยังเปิดอยู่ | claude-opus |
| 2 | f-scope-null-row: `scopeCounts` calls `list(row.scenarios)` on each requirement row without guarding null or non-object rows, so a malformed `draft.requirements` entry would throw and stop the whole package render. The `kind === "failure"` match is also case-sensitive, while `outline-contract.mjs` lowercases it. The input is normally validated, so this is non-blocking. (root/.claude/harness/runtime/workflow/approval-package.mjs:287) | minor | ยังเปิดอยู่ | claude-opus |
