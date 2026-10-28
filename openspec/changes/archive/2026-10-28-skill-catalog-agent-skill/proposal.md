# Change: ย่อ skill catalog ให้ agent เลือกและโหลด skill ได้ง่าย

- **Change:** `skill-catalog-agent-skill` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

skill ใน catalog ตอนนี้มี description ยาวเป็นศัพท์เฉพาะ SKILL.md ยาว และ references รวม 14,048 บรรทัด agent จึงไม่ค่อยเลือกโหลด skill ตอนทำงานจริง change นี้ย่อ description ให้เป็นคำที่ agent ใช้ ตัด SKILL.md ให้เหลือขั้นตอนหลัก และตัด references ให้เหลือเฉพาะที่ขั้นตอนต้องใช้ โดยคง guardrail เรื่อง harness, Git และ sandbox ไว้ครบและวัดผลด้วย trigger evaluation ก่อนและหลัง

## ขอบเขต

- **In scope (`skill-guidance`):** agent อ่าน description แล้วตัดสินได้ทันทีว่าควรโหลด skill นั้นสำหรับงานตรงหน้าหรือไม่; agent โหลด skill แล้วได้ขั้นตอนที่ทำตามได้ทันทีโดยไม่ต้องอ่าน reference ก่อน; reference ที่เหลือทุกไฟล์มีเส้นทางจาก SKILL.md และไม่มีเนื้อหาซ้ำข้าม bundle; router always-on และ description ของ skill บอกสัญญาณเดียวกัน agent จึงไม่เจอคำสองชุด; ผู้ดูแลเห็นจากรายงานว่า skill ถูกโหลดถูกตัวบ่อยขึ้นหรือไม่ โดยไม่ต้องเชื่อคำอ้าง
- **Out of scope:** edits outside `docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md`, `docs/reports/README.md`, `.claude/skills/*/SKILL.md`, `.claude/rules/fundamentals.md`, `.claude/harness/tests/skill-routing.test.mjs`, `.claude/tests/docs/skill-catalog.test.mjs`, … +32 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| trigger-descriptions | description ตรงตามข้อความที่กำหนด | success | T002 | test: `.claude/harness/tests/skill-routing.test.mjs`, `.claude/tests/harness/run-context-budget-tests.sh` | — |
|  | spec-vocabulary ยังอยู่ | boundary | T002 |  |  |
|  | lifecycle skill ไม่ถูกแตะ | boundary | T002 |  |  |
|  | description ยาวเกิน | failure | T002 |  |  |
| minimal-skill-bodies | ทุก body อยู่ใน budget และใช้โครงเดียวกัน | success | T003 | test: `.claude/tests/harness/run-context-budget-tests.sh` | — |
|  | guardrail ยังถูกจับ | boundary | T003 |  |  |
|  | จำนวน assertion ห้ามคำไม่ลดลง | boundary | T003 |  |  |
| pruned-references | ขนาดรวมลดและ governance ผ่าน | success | T004, T005, T006 | test | — |
|  | เนื้อหาที่ pin ยังครบ | boundary | T004, T005, T006 |  |  |
|  | ไฟล์ที่แผนบอกว่าลบหรือรวมหายไปจริง | boundary | T004, T005, T006 |  |  |
|  | ลบไฟล์ที่ยังถูกอ้าง | failure | T004, T005, T006 |  |  |
| router-in-sync | แถว router ตรงกับ description | success | T002 | test: `.claude/harness/tests/skill-routing.test.mjs`, `.claude/tests/harness/run-context-budget-tests.sh` | — |
| trigger-evaluation-report | รายงานมีสอง arm | success | T001, T007 | test | — |
|  | run ไม่สำเร็จ | failure | T001, T007 |  |  |
|  | catalog ใหม่แย่ลง | failure | T001, T007 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (15).
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for trigger-descriptions, minimal-skill-bodies, pruned-references, router-in-sync, trigger-evaluation-report.

## Appendix: Amendment history

- Revision 3 (2026-10-27): Correct the verify command of task 'T007'
- Revision 4 (2026-10-27): Correct the verify command of task 'T007'
- Revision 5 (2026-10-27): T005 ลบ programming-fundamentals/references/testing.md ตามแผน แต่ spec เดิม skill-guidance ยังมี scenario ที่เทียบ test-design.md กับไฟล์นั้น หลัง archive scenario จะชี้ไฟล์ที่ไม่มีและไม่มีวัน fail จึงแก้ scenario ให้เทียบกับ reference ของ programming-fundamentals ทุกไฟล์แทน
- Revision 6 (2026-10-27): review F2: requirement ที่ MODIFIED ยังมี scenario เดิม 'ไม่ซ้ำกับ programming-fundamentals testing' ที่เทียบกับไฟล์ที่ถูกลบ จึงเขียน scenario ชื่อเดิมใหม่ให้ยืนยันว่าไฟล์นั้นไม่มีอยู่และ test-design.md ไม่ซ้ำกับ reference ใดของ programming-fundamentals และตัด scenario ซ้ำที่เพิ่มในรอบก่อนออก

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 2 | F1-open-a-pr-guardrail-not-enforced: Scenario 'guardrail ยังถูกจับ' requires skill-catalog.test.mjs to fail and name the file and phrase when 'commit when green' OR 'open a PR' is inserted into a shortened SKILL.md or reference. The catalog-wide scan at line 423 only forbids 'Open a PR as **Draft**', not a plain 'open a PR'. Plain 'open a PR' is checked only in the 10 adopted pstack texts (line 392) and not in refactoring sources (line 229). Adding 'open a PR' to e.g. testing-fundamentals/SKILL.md or database-fundamentals/references/migrations.md passes every test. Repair must scope the ban, because git-workflow's description and git-workflow/references/pull-requests.md ('Land and /dev do not commit, push, open a PR') legitimately contain the phrase: e.g. exempt git-workflow (and negated forms), or match instruction-form wording, and keep the file+phrase message. (root/.claude/tests/docs/skill-catalog.test.mjs:423) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 2 | F2-stale-scenario-on-deleted-testing-md: The MODIFIED requirement 'Tests are judged against behavior and internal edits' says programming-fundamentals/references/testing.md no longer exists, and Revision 5 (proposal.md:59) says the old scenario was replaced so the canonical spec would not point at a missing file after archive. But the scenario 'ไม่ซ้ำกับ programming-fundamentals testing' (lines 210-213) is still in the MODIFIED block next to the new one (215-219). Because MODIFIED replaces the whole requirement, archive will carry a scenario that compares test-design.md with a deleted file. It can never fail, and its claim test-design-not-duplicated-programming-fundamentals-testing is satisfied trivially. The report's statement (line 272-274) that the scenario 'was amended' therefore overstates the fix. Remove the stale scenario and its claim, or make it assert the file's absence. (contract/specs/skill-guidance/spec.md:210) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 2 | F3-suite-pass-string-from-pre-review-tree: T007's check passes on the text 'ALL SUITES PASS (254 suites', but the report says that result came from the tree before the reviewer-driven edits. The final tree ran 253/254 (openspec native benchmark timed out under parallel load; it passed when run alone). The disclosure is honest, but the check is satisfied by stale text and does not show that the final tree passes in full. (root/docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md:254) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 2 | F4-dangling-principle-pointers: The rewritten SKILL.md bodies no longer have numbered principles, yet references still point at them: testing-fundamentals/references/coverage.md:3,5 ('Moved from SKILL.md — principle 7', 'Principle 7 (from SKILL.md)'), debug-fundamentals/references/reproduction.md:58 ('principle 7'), coding-discipline/references/details.md:18,78-82 ('principle 1..4'). delivery-engineering/references/pipeline-and-deploy.md:76 ('principle 1') may also be stale unless that file numbers its own principles. These are now dangling cross-references for an agent reading a single file. (root/.claude/skills/testing-fundamentals/SKILL.md:39) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | F5-negation-heuristic-exempts-unrelated-negations: The PR-instruction guard skips any sentence that contains the bare words no, not, never, without, or cannot anywhere, or 'only via/with/when'. So 'open a PR' is missed when it is inserted into a sentence that already holds an unrelated negation. Example: appending '; then open a PR' to testing-fundamentals/SKILL.md step 5, which says 'no sleeps or order dependence'. It is also missed in a conditional instruction such as 'Open a PR only when the suite is green.' Plain insertion is caught as the scenario requires, so this does not block. Tightening the exemption would close the gap: for example, require the negator to come right before the PR phrase or its verb list (e.g. /\b(?:not\|never\|no)\b[^.]{0,40}open(?:s\|ing)? a (?:PR\|pull request)/), and drop 'only when', since git-workflow is already exempt. (root/.claude/tests/docs/skill-catalog.test.mjs:429) | minor | ยังเปิดอยู่ | claude-opus |
