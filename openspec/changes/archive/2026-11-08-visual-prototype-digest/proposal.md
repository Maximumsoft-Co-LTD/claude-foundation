# Change: การตรวจ visual ไม่หายเมื่อสำเนา prototype ไม่ตรง digest

- **Change:** `visual-prototype-digest` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-07

## เหตุผล

ถ้าสำเนา prototype ใน packet ถูกแก้หรือหายไป ระบบจะตัดการตรวจ visual ทิ้งเงียบ ๆ ทำให้ UI ผ่านไปได้โดยไม่มีการเทียบกับ prototype เลย การแก้นี้ทำให้การตรวจยังอยู่และแจ้ง error พร้อมบอกวิธีกู้คืน เพื่อไม่ให้หลักฐานอ่อนลงโดยไม่มีใครรู้

## User story

- **P1** ในฐานะ ผู้อนุมัติงาน UI ฉันต้องการ ให้การตรวจภาพไม่หายไปเมื่อสำเนา prototype ถูกแก้หรือหาย เพื่อ UI ที่ไม่ได้เทียบกับ prototype จะไม่ผ่านไปถึง Land โดยไม่มีใครรู้ Requirement: visual-binding-fail-closed.

## เกณฑ์ความสำเร็จ

- ทุกกรณีที่สำเนาไม่ตรงหรือหาย (strict 2 กรณี และ advisory 1 กรณี) ได้ receipt visual เป็น error และ reviewer ถูกเรียก 0 ครั้ง

## ขอบเขต

- **In scope (`visual-verification`):** สำเนา prototype ที่ถูกแก้หรือหายไม่ทำให้การตรวจภาพหายไปโดยไม่มีใครรู้
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/tests/visual-binding-drift.test.mjs`, `.claude/harness/tests/visual-review.test.mjs`, `.claude/harness/tests/visual-advisory.test.mjs`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, … +3 more; the authored Non-goals below

## Non-goals

- ให้ amendment รับ prototypeSelection เพื่อเปลี่ยน prototype ระหว่าง Build
- reset สถานะ repair และ drift เมื่อเปลี่ยน mode
- ข้อความของ waiver visual ที่บันทึกโดยไม่มี drift

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** ui-build-prototype-change

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| visual-binding-fail-closed | สำเนาตรง digest | success | T001 | test: `.claude/harness/tests/visual-binding-drift.test.mjs`, `.claude/harness/tests/visual-review.test.mjs`, `.claude/harness/tests/visual-advisory.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | สำเนา advisory ถูกแก้ | boundary | T001 |  |  |
|  | สำเนา strict ถูกแก้ | failure | T001 |  |  |
|  | สำเนา strict หายไป | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | visual-binding-fail-closed |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 2 (2026-11-07): Prove review advisories: an unreadable binding.json still drops the visual check, and a binding without a digest skips the digest check. The user asked to close both before Land.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | minor-corrupt-binding-fails-open: `readVisualBinding` returns null when `binding.json` is unparseable or has the wrong `version` or `file`. `withVisualRequirement` then returns the contract unchanged and the visual check silently disappears. This is a different failure from the scenarios (copy edited or missing), and spec approval binds the packet bytes, so it is unlikely. It is still fail-open where the change is meant to fail closed, and no test covers it. (root/.claude/harness/runtime/evidence/visual-review.mjs:36) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | minor-orphan-comment: The comment "One review. `runner(...)` returns..." now sits above `prototypeRecovery` instead of above `runVisualReview`, because the drift helpers were inserted between them. This is cosmetic. (root/.claude/harness/runtime/evidence/visual-review.mjs:274) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | minor-directory-copy-throws-in-contract-load: In `readVisualBinding`, the `intact` check calls `readFileSync(file)` outside any try. If `binding.file` points to a directory, or to a file that can't be read, the exception escapes. It then escapes `evidence()` in `evidence-contract.mjs:1049`, so Prove crashes instead of writing a visual `error` receipt with the recovery. This still fails closed, because nothing gets proved, but the error doesn't name the copy or the recovery. `prototypeDriftIssue` has the same unguarded read, but there the CLI's try/catch catches it. Wrapping the digest read and treating a failure as `intact: false` would keep this case consistent with the other drift cases. (root/.claude/harness/runtime/evidence/visual-review.mjs:57) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 2 | minor-orphan-comment-persists: The comment "One review. `runner(...)` returns..." still sits above `prototypeRecovery` and `prototypeDriftIssue` instead of above `runVisualReview`. This is cosmetic. (root/.claude/harness/runtime/evidence/visual-review.mjs:293) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | minor-design-omits-binding-record-scenarios: design.md lists only the edited-copy and missing-copy failures. The spec has two more scenarios, each covered by `visual-binding-record.test.mjs`: an unreadable or unsupported `binding.json` (which binds every claim to `visual`), and a binding with no valid `sha256`. design.md has no failure-table row for either one. Its file map and test map also leave out `visual-binding-record.test.mjs`, which run-all.sh and the tests README both list. The code and tests do cover both scenarios, so only the design record is incomplete. (contract/design.md:24) | minor | ยังเปิดอยู่ | claude-opus |
