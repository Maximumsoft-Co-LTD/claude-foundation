# Change: draft ที่ประกาศ fixes ต้องมี discovery coverage ด้าน input-boundary เพื่อให้งานแก้ regression ครอบคลุม boundary ข้างเคียง ไม่ใช่แค่ boundary ที่ถูกรายงาน

- **Change:** `draft-fixes-discovery-coverage-input-boundary-regression-boundar` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-17

## เหตุผล

checkpoint บน `078e10ba8` หลังทำคำแนะนำ `input-domain` ให้แคบ พบว่า lane regression-fix-with-fixes
ไม่ประกาศ risk signal จึงไม่มี coverage ด้าน input-boundary agent แก้แค่ boundary ที่ 1000 และพลาด
boundary ที่ 5000 (oracle 9/10) ส่วน v3.6.4 ที่ประกาศ `input-domain` ผ่าน 10/10

## ขอบเขต

- draft ที่ประกาศ `fixes` ต้องมี coverage ด้าน `input-boundary`
- template บอกเรื่องนี้ใน `minimalDraftFixes` และ `minimalDraftRiskCoverage`
- ไม่มี review เพิ่ม

- **In scope (`change`):** งานแก้ regression ที่ไม่ได้ประกาศ input-domain ยังต้องระบุ boundary ข้างเคียงใน agreement; agent เขียน coverage ของงานแก้ regression ได้ถูกตั้งแต่ draft แรก
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/validation/semantic-intake.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/semantic-intake.test.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs`; the authored Non-goals below

## Non-goals

- ไม่ยกเลิกการทำคำแนะนำ input-domain ให้แคบ
- ไม่เพิ่ม review เพราะ fixes

## Work type

bugfix

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## Decisions

- **fixes-forcing:** ใช้ fixes เป็นตัวบังคับ input-boundary — checkpoint 078e10ba8 พบว่า regression-fix-with-fixes ไม่ประกาศ input-domain หลังคำแนะนำแคบลง จึงพลาด boundary 5000 (oracle 9/10) ขณะที่ v3.6.4 ที่ประกาศ input-domain ผ่าน 10/10 งานแก้ regression ต้องคิดถึง boundary ข้างเคียงเสมอ (decided by agent)

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| fixes-input-boundary | fixes บังคับ input-boundary | unclassified | T001 | test: `.claude/harness/tests/semantic-intake.test.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs` | — |
|  | ไม่มี fixes | unclassified | T001 |  |  |
|  | review tier คงเดิม | unclassified | T001 |  |  |
| fixes-template | template บอก fixes | unclassified | T001 | test: `.claude/harness/tests/semantic-intake.test.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Amendment history

- Revision 1 (2026-10-17): full suite พบว่า fixture ใน semantic-draft.test.mjs ประกาศ fixes แต่ไม่มี coverage ของ input-boundary ซึ่งตอนนี้บังคับตาม requirement fixes-input-boundary จึงเพิ่มไฟล์นี้เข้า paths เพื่อให้ fixture ตามกฎใหม่
