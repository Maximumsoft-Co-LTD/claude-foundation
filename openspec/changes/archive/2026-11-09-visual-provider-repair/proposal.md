# Change: visual provider หลายตัวที่ไม่ผ่านพร้อมกันได้ repair รอบเดียวกัน

- **Change:** `visual-provider-repair` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

change ที่มี visual provider หลายตัว (เช่น desktop และ mobile) และไม่ผ่านพร้อมกัน provider ตัวที่สองจะถูกบันทึกเป็น drift ทันทีโดยยังไม่ได้ซ่อม เพราะตีความ hash ที่ตัวแรกเพิ่งบันทึกว่าเป็นการปฏิเสธ ผู้ใช้จึงถูกถามเร็วเกินไป การแก้นี้ให้หนึ่งรอบซ่อมครอบคลุมทุก provider ที่ไม่ผ่านใน Prove ครั้งเดียวกัน

## User story

- **P1** ในฐานะ ผู้อนุมัติงาน UI หลายหน้าจอ ฉันต้องการ ให้ทุกหน้าจอได้ซ่อมก่อนถูกถาม เพื่อ ไม่ต้องตัดสินใจเรื่องที่ agent ยังไม่ได้ลองแก้ Requirement: visual-multi-provider-one-round.

## เกณฑ์ความสำเร็จ

- provider สองตัวที่ fail พร้อมกันได้ repair batch เดียวและไม่มี drift ในรอบแรก

## ขอบเขต

- **In scope (`visual-verification`):** provider ที่ไม่ผ่านพร้อมกันได้ซ่อมก่อน drift
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/repair-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/runtime/workflow/change-validation.mjs`, `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs`, … +3 more; the authored Non-goals below

## Non-goals

- waiver ราย provider
- งบซ่อมแยกต่อ provider

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** visual-verification-visual-declined-repair-escalates

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| visual-multi-provider-one-round | สอง provider fail พร้อมกัน | success | T001 | test: `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs` | — |
|  | ครบงบ | boundary | T001 |  |  |
|  | provider เดียว | boundary | T001 |  |  |
|  | state แบบเดิม | boundary | T001 |  |  |
|  | agent ไม่แก้ทั้งรอบ | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (5).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | visual-multi-provider-one-round |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-minor-id-collision: Finding ids come from each provider's reviewer (visual-review.mjs:286) and are only unique within one receipt. Merging two providers into one batch can produce duplicate `visual:<id>` entries in `result.findings`, in the graph nodes' `findingIds`, and in `totalFindingIds` (repair-runtime.mjs:96-120). The new tests use distinct ids (S1 and M1), so the collision is untested. I did not check how downstream consumers handle duplicates. Consider prefixing the id with the provider when more than one provider is merged. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs:832) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | f-minor-budget-test-gap: The shared-budget test ends with only one provider (mobile) still differing, so it never shows drift holding the findings of several providers once the budget is spent. The code handles that case, because findings are tagged and merged before the plan, but no test asserts it. (root/.claude/harness/tests/visual-repair.test.mjs:262) | minor | ยังเปิดอยู่ | claude-opus |
