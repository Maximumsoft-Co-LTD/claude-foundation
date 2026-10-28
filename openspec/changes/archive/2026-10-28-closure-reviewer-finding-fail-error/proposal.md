# Change: รอบ closure ที่ reviewer ปิด finding ได้ไม่ครบเป็น fail ไม่ใช่ error

- **Change:** `closure-reviewer-finding-fail-error` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-28

## เหตุผล

รอบ closure ของ AI review ถูกกำหนดให้ตอบ verifiedFindingIds เท่ากับ ID ของ finding รอบแรกครบทุกตัวพอดี เมื่อ reviewer ปิดได้ไม่ครบและเห็นปัญหาค้าง ไม่มีรูปแบบคำตอบที่ถูกต้องให้ส่ง harness จึงบันทึกเป็น error แบบไม่ retry และทางออกเดียวคือ reset-infra ซึ่งใช้ decision ref เดิมซ้ำไม่ได้ ใน lane ทดสอบจริงหลาย agent ติดตันที่จุดนี้ทั้งที่ reviewer ตอบถูกและชี้ปัญหาจริง

## ขอบเขต

- **In scope (`review-closure`):** reviewer ที่ปิด finding ได้ไม่ครบได้คำตัดสิน fail ที่บันทึกไว้ ไม่ใช่ error ที่ต้อง reset; reviewer มีวิธีตอบที่ถูกต้องเมื่อไม่เห็นด้วยกับการซ่อม
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/configured-reviewer.mjs`, `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/tests/authority-response-validation.test.mjs`, `.claude/harness/tests/workflow-policy.test.mjs`, `.claude/harness/EVIDENCE.md`, … +1 more; the authored Non-goals below

## Non-goals

- เปลี่ยนจำนวนรอบ AI review ที่ risk tier อนุญาต
- ทำให้ pass ผ่านได้เมื่อ finding รอบแรกยังไม่ถูกปิดครบ
- เปลี่ยนวิธีที่ finding ถูกผูกกับ claim และ critical case หรือการปิดแบบ deterministic repair-closure

## ผลกระทบและความเสี่ยง

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

รอบ closure ของ AI review ที่ปิด finding ได้ไม่ครบถูกบันทึกเป็น review ที่ fail พร้อมส่วนที่ยังค้าง ไม่ใช่ error ที่ต้อง reset

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| partial-closure-is-a-verdict | ปิดได้สามจากสี่แล้วยังเห็นปัญหาค้าง | success | T001, T002, T003 | test: `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/tests/authority-response-validation.test.mjs`, `.claude/harness/tests/workflow-policy.test.mjs` | — |
|  | ผลที่บันทึกด้วยมือผ่านกติกาเดียวกัน | success | T001, T002, T003 |  |  |
|  | ปิดครบทุกตัวคงเดิม | boundary | T001, T002, T003 |  |  |
|  | pass ที่ปิดไม่ครบถูกปฏิเสธ | failure | T001, T002, T003 |  |  |
|  | fail ที่ขาด ID โดยไม่มี finding อธิบายถูกปฏิเสธ | failure | T001, T002, T003 |  |  |
|  | verified ที่มี ID นอกรอบแรกถูกปฏิเสธ | failure | T001, T002, T003 |  |  |
| reviewer-told-how-to-report-open-findings | คำสั่งของ reviewer อธิบายวิธีตอบเมื่อปิดไม่ครบ | success | T001 | test: `.claude/harness/tests/configured-reviewer.test.mjs` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (7).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | partial-closure-is-a-verdict |  |  |
| affected-actor | covered | partial-closure-is-a-verdict, reviewer-told-how-to-report-open-findings |  |  |
| compatibility | covered | partial-closure-is-a-verdict |  |  |
| verification | covered | partial-closure-is-a-verdict, reviewer-told-how-to-report-open-findings |  |  |
| operability | covered | partial-closure-is-a-verdict |  |  |
| recoverability | covered | partial-closure-is-a-verdict |  |  |
| security-privacy | not-applicable |  |  | ไม่มี input ใหม่ข้ามขอบเขต trust การเปลี่ยนนี้ตัดสินผลที่ reviewer ที่ตั้งค่าไว้ส่งกลับมาเท่านั้น |
| permission-rejection | not-applicable |  |  | ไม่มี role หรือสิทธิ์ที่เกี่ยวข้อง เงื่อนไขอำนาจของ review เดิมไม่เปลี่ยน |
| data-migration | not-applicable |  |  | ไม่เปลี่ยนรูปแบบข้อมูลที่เก็บ ผลย่อยเก็บใน verifiedFindingIds เดิม |
| rollout-rollback | covered | partial-closure-is-a-verdict |  |  |

Harness derive จากเนื้อหา draft (5): desired-behavior, success-path, failure-path, input-boundary, non-goals.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for partial-closure-is-a-verdict, reviewer-told-how-to-report-open-findings.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | R1: The new delta instruction says: "when a problem remains leave out the IDs it did not close, set status fail, and report what remains as a finding". It never says the finding must be a blocker or major. The next sentence even says "keep minor findings non-blocking". But `deltaClosureIssue` (configured-reviewer.mjs:154-155) accepts a partial closure only when some finding is a blocker or major. So a reviewer can follow the prompt word for word: leave F2 out, set status fail, report the remainder as a minor finding. The harness then refuses that result as a closure binding error, which stops the automatic retry chain (WORKFLOW.md:1840-1844). That is the stall this change was meant to remove, and the reviewer has no instruction that would let it avoid it. Fix: say "report what remains as a blocker or major finding" in the prompt, and add that phrase to the prompt assertions at configured-reviewer.test.mjs:293-295. (root/.claude/harness/runtime/evidence/configured-reviewer.mjs:406) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | R2: Severity case is handled two different ways in the manual-record path. `validateReviewFindingClosure` lowercases severity when it counts unresolved blockers (line 2017), and `normalizedReviewFinding` (receipt-runtime.mjs:156) lowercases severity before storing. But `deltaClosureIssue`, called at line 2025 (and by the preflight at line 395), compares severity case-sensitively. Example: a manual fail response whose finding has severity "Major" and a subset of verified IDs. It passes the unresolved-blockers count check, then the partial-closure rule refuses it. That breaks the promise that manual results follow the same rule as the configured reviewer. It errs on the side of refusing, so it is minor. Fix: lowercase severity inside `deltaClosureIssue`. (root/.claude/harness/runtime/workflow/authority-runtime.mjs:2025) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | R3: The new text says "the IDs it leaves out stay open". The unchanged sentence just before it in the same paragraph (line 641) still says "A delta review that no longer reports an earlier finding closes it". The archive review record follows that older rule: `renderReviewRecord` (process-fields.mjs:328-330) marks a first-round finding as resolved in the first later round that doesn't report it. So for the partial-closure case, the unverified F2 is shown as "resolved" in the closure round, not "open". Also, no recorded state tracks F2 as open after that round; only D1 is in unresolvedIds. Either align the docs (the leftover problem is carried by the reported blocker/major finding) or make the record show unverified closure IDs as open. (root/.claude/harness/EVIDENCE.md:645) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | R4: The `inconclusive` check is `assert.match(closureIssues(...)[0] \|\| "", /delta closure must verify exactly\|^$/)`, which passes whether the result is accepted or refused, so it asserts nothing. The code accepts a partial closure with status `inconclusive` (anything that isn't a pass). That matches EVIDENCE.md ("A result that is not a pass") but not the prompt ("set status fail") or the spec requirement, which only talks about fail. Pick the intended behaviour and assert it. (root/.claude/harness/tests/configured-reviewer.test.mjs:289) | minor | แก้แล้วในรอบ 2 | claude-opus |
