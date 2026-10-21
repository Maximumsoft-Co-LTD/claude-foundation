# Change: หน้า approval package อ่านข้อมูลเข้าใจเร็วขึ้นสำหรับคนไม่เขียนโค้ด

- **Change:** `approval-package-risk-meter` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-21

## เหตุผล

หน้า approval package ยังให้ผู้อนุมัติแปลข้อมูลเอง: ความเสี่ยงเป็นป้ายเดียว คำถามที่ค้างแสดงแค่จำนวน กรณีพลาดเป็นตาราง และบนมือถือแถบตัดสินใจที่ติดขอบล่างบังเนื้อหาเกินครึ่งจอ change นี้จัดข้อมูลเดิมให้อ่านเร็วขึ้นโดยไม่เพิ่มฟิลด์ใหม่ใน draft

## User story

- **P1** ในฐานะ ผู้อนุมัติที่ไม่เขียนโค้ด ฉันต้องการ เห็นระดับความเสี่ยง ก่อน-หลัง และคำถามที่ต้องตอบเป็นภาพที่อ่านเร็ว เพื่อ ตัดสินใจอนุมัติได้อย่างมั่นใจโดยไม่ต้องตีความตัวเลขหรือตาราง Requirement: risk-meter, before-after-and-questions, failure-cards.
- **P2** ในฐานะ ผู้อนุมัติที่ใช้มือถือ ฉันต้องการ อ่านเนื้อหาได้เต็มจอก่อนถึงแถบตัดสินใจ เพื่อ ไม่ถูกแถบที่ติดขอบล่างบังเนื้อหา Requirement: mobile-decision-bar.

## เกณฑ์ความสำเร็จ

- หน้าที่เรนเดอร์มีแถบความเสี่ยง 4 ระดับ การ์ดก่อน-หลัง รายการคำถามที่ค้างตามข้อความจริง และการ์ดกรณีพลาดตามที่ test ตรวจทั้ง th และ en
- ที่ความกว้าง 360px แถบตัดสินใจไม่ติดขอบล่าง และไม่มี script เพิ่มนอกจาก mermaid

## ขอบเขต

- **In scope (`approval-package`):** ผู้อนุมัติรู้ระดับความเสี่ยงและสาเหตุโดยไม่ต้องกางรายละเอียด; ผู้อนุมัติเห็นว่าอะไรเปลี่ยนและต้องตอบอะไรก่อนอนุมัติ; ผู้อนุมัติเห็นว่าถ้าพลาดผู้ใช้เจออะไรและกู้คืนได้อย่างไร; แถบตัดสินใจไม่บังเนื้อหาบนมือถือ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/runtime/workflow/scratch-blocks.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `WORKFLOW.md`, … +2 more; the authored Non-goals below

## Non-goals

- ไม่เพิ่มฟิลด์ใหม่ใน draft schema
- ไม่เปลี่ยน protocol.json หรือการ route ความเสี่ยง
- ไม่เพิ่มปุ่ม ฟอร์ม หรือ script

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้า approval package แสดงความเสี่ยงเป็นแถบ 4 ระดับ คำถามที่ค้างเป็นรายการ และกรณีพลาดเป็นการ์ด

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| risk-meter | ระดับสูงสุด | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ระดับต่ำ | boundary | T001, T002 |  |  |
|  | ไม่มีเหตุผล | failure | T001, T002 |  |  |
| before-after-and-questions | มีคำถามค้าง | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มีคำถามค้าง | boundary | T001, T002 |  |  |
|  | คำถามเป็นข้อความอันตราย | failure | T001, T002 |  |  |
|  | ไม่มีสรุปก่อน-หลัง | failure | T001, T002 |  |  |
| failure-cards | มี failure scenario | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี recovery | boundary | T001, T002 |  |  |
|  | ไม่มี failure scenario | failure | T001, T002 |  |  |
| mobile-decision-bar | มือถือ | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี script | boundary | T001, T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (12).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | risk-meter, before-after-and-questions |  |  |
| input-boundary | covered | before-after-and-questions |  |  |
| compatibility | not-applicable |  |  | หน้า HTML เป็นผลลัพธ์อ่านอย่างเดียว ไม่มี consumer ที่อ่านโครงของหน้า และไม่เปลี่ยน protocol.json |
| non-goals | covered | mobile-decision-bar |  |  |

## Amendment discovery coverage

Reason: ผู้ใช้สั่งเพิ่มการ์ดตามชนิดงาน A-G รายการตรวจส่วนบังคับ scratch.undo/who แบบเสริม และฟอนต์ไทยในเครื่อง ก่อนเริ่มแก้โค้ด

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | type-cards, required-checklist | none | none |
| input-boundary | covered | scratch-undo-who | none | none |
| compatibility | covered | scratch-undo-who, required-checklist | none | none |
| non-goals | covered | required-checklist, thai-readable | none | none |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (4); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 2 (2026-10-21): ผู้ใช้สั่งเพิ่มการ์ดตามชนิดงาน A-G รายการตรวจส่วนบังคับ scratch.undo/who แบบเสริม และฟอนต์ไทยในเครื่อง ก่อนเริ่มแก้โค้ด
- Revision 3 (2026-10-21): รีวิวพบว่ารายการตรวจต้องบอกฟิลด์ย่อยที่ขาดของ bugfix และ refactor จึงต้อง export OBJECT_FIELDS เดิมจาก design-blueprints.mjs แทนการคัดลอกกฎ งานนี้เป็น task ใหม่เพราะ task เดิมเสร็จแล้ว

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-checklist-partial-bugfix: devDocumentChecklist sets present via present(sectionValue(draft, key)), which is true for any non-empty object. A bugfix with { reproduction, rootCause } but no regression therefore renders as ✓ 'Bug analysis'. The scenario requires ✕ and a note saying what is missing (regression). renderChecklist (approval-cards.mjs:195-197) also only prints the generic 'missing' word and never names a missing sub-field. The test at approval-package.test.mjs:487 only covers a bugfix that is absent entirely; the partial case has no test. (root/.claude/harness/runtime/workflow/validation/dev-document.mjs:397) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-hero-warning-partial-scratch: heroSection shows the missing-summary warning only when none of get/asIs/toBe/ifFail is set. When scratch has get or ifFail but no asIs/toBe, the before/after cards are correctly left out, but the warning (t.scratchMissing) is not shown. The scenario 'scratch ไม่มี asIs และ toBe' requires the warning to still appear. Low-impact drafts can legitimately carry partial scratch, because scratchFieldIssues skips undefined keys. The test at line 360 only covers scratch being absent entirely. (root/.claude/harness/runtime/workflow/approval-package.mjs:378) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F3-scratch-required-breaks-old-drafts: The new scratchRequiredIssues, applied through semanticDraftIssues({ requireScratch }) at semantic-draft.mjs:378 and enabled in loadDraft for start and revise, rejects any medium or high draft without all four scratch lines. Before this change those drafts passed. The scratch-undo-who requirement says the new fields are optional and must not make old drafts fail ('โดยไม่ทำให้ draft เดิมตก'). The proposal's non-goals and the amendment reason list no new required-field rule. Revising an existing medium change whose draft has no scratch now fails with an EDIT. (root/.claude/harness/runtime/workflow/scratch-fields.mjs:86) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F4-question-count-mismatch: scopeCounts uses the raw openQuestions.length, while questionsBox filters out blank or text-less rows. With ['Partial refunds?', {question:'Who signs off?'}, '  '] the scope strip says 3 open questions but the box header says (2). An all-blank list shows N in the strip and hides the box. (root/.claude/harness/runtime/workflow/approval-package.mjs:287) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F5-failure-matrix-fallback: failureRows falls back to draft.failureMatrix when there are no failure scenarios. The spec and DEC-FAILURE-CARD-FIELDS say the failure section comes only from failure scenarios and is hidden when there are none. With this fallback the section shows while the scope strip reports 0 failure cases. (root/.claude/harness/runtime/workflow/approval-package.mjs:361) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F6-no-reasons-untested: The empty-reasons branch (no #risk-why list) is implemented, but no test renders a route with zero reasons and asserts that the list is absent. (root/.claude/harness/runtime/workflow/approval-package.mjs:339) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | F7-checklist-present-divergence: devDocumentChecklist checks the OBJECT_FIELDS sub-fields with dev-document's present() (lines 26-30), which returns false for booleans and numbers. design-blueprints' present() (lines 74-79), used for the compiler's 'bugfix is missing …' warning, returns true for them. A draft with, for example, bugfix.regression: true or refactor.characterization: 1 gets no compiler warning but shows ✕ 'missing: …' on the page. The commit says the checklist names 'the same missing fields' as the compiler, so the two checks should match. Reusing one predicate would fix it. This does not block. (root/.claude/harness/runtime/workflow/validation/dev-document.mjs:401) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | M1-scope-counts-unguarded-rows: scopeCounts reads row.scenarios and row.kind without optional chaining. failureRows (line 360-361) guards both with requirement?.scenarios and scenario?.kind. A null requirement or null scenario entry in a stored draft makes scopeCounts throw. scopeStrip is not wrapped in safely(), so the whole page fails to write (tryWritePackage reports an error) when it should only degrade. Validated drafts should not contain such rows, so this does not block. Using the same guards in both places would keep the strip count and the card count consistent. (root/.claude/harness/runtime/workflow/approval-package.mjs:288) | minor | ยังเปิดอยู่ | claude-opus |
| 3 | M2-monospace-thai-labels: Several new labels that hold Thai text use `font: 700 … ui-monospace, Menlo, monospace` instead of var(--sans): .ba .tag (ก่อน/หลัง), .fail .row > div > span (ผลที่เห็น/กู้คืน), .badge, .tag and .src. None of these monospace fonts has Thai glyphs, so the browser picks a fallback outside the required Sukhumvit Set → Tahoma order. Nothing here is serif, so the test passes, but these labels do not follow the declared stack. Prepending var(--sans) after the monospace families, or using the sans stack for these labels, would fix it. (root/.claude/harness/runtime/workflow/approval-package.mjs:540) | minor | ยังเปิดอยู่ | claude-opus |
| 3 | M3-design-md-stale-scope: The design file map, component table and test map still describe only T001/T002 and the first 12 scenarios. They omit approval-cards.mjs, scratch-fields.mjs, semantic-draft.mjs, the dev-document and design-blueprints validators, and the type-cards, required-checklist, scratch-undo-who and thai-readable scenarios, all of which tasks.md T003–T005 and the spec now cover. This is documentation drift only. (contract/design.md:76) | minor | ยังเปิดอยู่ | claude-opus |
| 3 | M4-scratch-object-message: When scratch is not an object, the error still reads 'must be an object of { get, asIs, toBe, ifFail }'. It does not mention the newly accepted optional undo and who keys, so an author fixing the EDIT is not told those keys exist. (root/.claude/harness/runtime/workflow/scratch-fields.mjs:98) | minor | ยังเปิดอยู่ | claude-opus |
