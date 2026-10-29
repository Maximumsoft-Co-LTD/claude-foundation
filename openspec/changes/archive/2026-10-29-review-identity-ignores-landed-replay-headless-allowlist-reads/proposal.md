# Change: Review identity ignores landed replay; headless allowlist reads

- **Change:** `review-identity-ignores-landed-replay-headless-allowlist-reads` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

ใน run 29 ต.ค. change B ที่ซ้อนบน A เสีย AI review wave จนหมด 4/4 แล้วต้องใช้ human verdict เพราะทุกครั้งที่ sync เอาโค้ดของ A มา merge ให้ diff identity ของ B เปลี่ยน (ไฟล์ที่ merge ถูกเทียบกับ base จึงนับ hunk ของ A เป็นของ B) ทั้งที่ review diff เทียบกับไฟล์ที่ land แล้วอยู่แล้ว และใน run เดียวกัน agent ถูกปฏิเสธคำสั่งอ่าน 10 ครั้งเพราะ allowlist ที่ ship มีแค่ CLI กับ Edit ผู้ใช้ตัดสินใจแล้วให้ไม่นับ wave เมื่อส่วนของ change เท่าเดิม และเพิ่มกฎอ่านอย่างเดียวใน allowlist

## ขอบเขต

สิ่งที่เปลี่ยน:

- diff identity เทียบไฟล์ที่ landedSynced บันทึกว่า merge แล้ว (และ target ยังตรง) กับไฟล์ที่ land แล้ว เหมือน review diff ทั้ง root และ repository
- shipped permissions.allow เพิ่ม Bash(find *), Bash(grep *), Bash(cat *), Bash(ls *), Bash(head *), Bash(wc *), Bash(rtk read *), Bash(rtk ls *), Bash(rtk grep *), Bash(git status*), Bash(git diff*), Bash(git log*), Bash(git show*)
- installer hint, docs install EN/TH, installer test และ CHANGELOG ตาม

ไม่ทำ:

- ไม่เปลี่ยน cap ของ AI wave ต่อ tier และไม่ reset cap
- ไม่เพิ่มกฎเขียนหรือ git ที่เปลี่ยน state
- ไม่เปลี่ยน review diff ที่เทียบ landed อยู่แล้ว

- **In scope:** review receipt ที่ผูก diff identity rebind ได้หลัง sync ที่เปลี่ยนเฉพาะส่วนที่ land แล้ว จึงไม่กิน AI review wave เพิ่ม; agent ใน headless อ่านโค้ดได้โดยไม่ต้องขออนุมัติ และ installer ต่อท้ายกฎเหล่านี้หลังกฎของผู้ใช้โดยไม่ซ้ำ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/sandbox-diff-identity.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs`, `.claude/settings.json`, `install.sh`, … +5 more

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| review-closure | landed-aware-diff-identity | T001, T003 |
| host-adapter | headless-read-allowlist | T002, T003 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| landed-aware-diff-identity | identity ไม่เปลี่ยนเมื่อ sync เพิ่มเฉพาะงานที่ land แล้ว | success | T001, T003 | test: `.claude/harness/tests/sandbox-diff-identity.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs` | — |
|  | repository sandbox | success | T001, T003 |  |  |
|  | target เปลี่ยนหลัง sync | boundary | T001, T003 |  |  |
|  | identity เปลี่ยนเมื่อ B แก้ส่วนของตัวเองเพิ่ม | failure | T001, T003 |  |  |
|  | diff เทียบ landed อ่านไม่ได้ | failure | T001, T003 |  |  |
| headless-read-allowlist | installer ต่อท้ายกฎอ่าน | success | T002, T003 | test: `.claude/tests/harness/run-installer-tests.sh` | — |
|  | opt-out | boundary | T002, T003 |  |  |
|  | ไม่มีกฎเขียนหรือ git ที่เปลี่ยน state | failure | T002, T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | landed-aware-diff-identity, headless-read-allowlist |  |  |
| compatibility | covered | landed-aware-diff-identity, headless-read-allowlist |  |  |
| non-goals | covered | landed-aware-diff-identity |  |  |
| input-boundary | not-applicable |  |  | input คือ state และไฟล์ที่ harness เขียนเอง |

## Amendment discovery coverage

Reason: base-move rebind suite ยืนยัน contract เดิมว่า base move ที่ reshape diff ต้องทำให้ verdict หมดอายุ (และปล่อย attempt) จึงจำกัด bridge ไว้เฉพาะ replay ของงานที่ยังไม่ commit (landed replay, carried target edit) และไม่บันทึกเมื่อ sync เดียวกันมี base move

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | landed-aware-diff-identity | none | none |
| compatibility | covered | landed-aware-diff-identity | none | none |
| non-goals | covered | landed-aware-diff-identity | none | none |
| input-boundary | not-applicable | none | none | input คือ state ที่ harness เขียนเอง |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-29): Build พบว่า rule แบบ prefix ของ cat (และ rtk read) จะปล่อย cat > file ซึ่งเป็น shell write route ที่ harness ปฏิเสธ จึงตัดออก และ rule ของ git ต้องเป็นคู่ exact + prefix ตามรูปแบบที่ bench และ test ของ repo ใช้
- Revision 2 (2026-10-29): AI review พบว่า identity ก่อน sync ไม่มีทางรู้จักงานที่ land แล้ว การเทียบรายไฟล์กับ landed bytes จึงทำให้ identity เปลี่ยนข้าม sync แรกเสมอ และ landedReplay หายใน sync ถัดไป จึงเปลี่ยนกลไกเป็น identity bridge: sync บันทึก identity ก่อน/หลัง rewrite ของตัวเอง และ receipt rebind ข้าม bridge
- Revision 3 (2026-10-29): base-move rebind suite ยืนยัน contract เดิมว่า base move ที่ reshape diff ต้องทำให้ verdict หมดอายุ (และปล่อย attempt) จึงจำกัด bridge ไว้เฉพาะ replay ของงานที่ยังไม่ commit (landed replay, carried target edit) และไม่บันทึกเมื่อ sync เดียวกันมี base move

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-landed-rows-include-untouched-paths: landedIdentityFiles iterates every record.landedSynced entry. replayLandedWithin (sandbox-runtime.mjs:2315-2318) writes a landedSynced row for every path in landedBy, i.e. every path another change landed whose target bytes still match, not only the paths it merged. That includes paths this change never edited. Each of these now adds a `landed:<path>:<digest>` row to the identity. Root sandbox: a carried path (sandbox equals target) used to be left out via carriedExcludes and now adds an empty-diff row. Repository sandbox: nothing is carried there, so an untouched path (sandbox at base) adds a row holding the reverse of the landed edit. These rows also bypass codePathspec, so .foundation/ and other non-code landed paths get in too. Result: whenever an earlier change lands on any file and B syncs, B's identity changes and the receipt goes stale with review-contribution-changed. Before this change those landings rebound cleanly; the identity is now looser than before, not stricter. Fix: restrict the landed set to paths this change actually merged or resolved (landedReplay or landedResolved, or sandbox bytes that differ from base), and skip carried paths and paths outside codePathspec, as landedBaseFiles does by only looking at surface paths. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1393) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-identity-differs-across-first-sync: The scenario requires B's identity after the sync that merges A's work to equal the identity before that sync. Before the sync, landedSynced has no entry for the file, so the row is `<repo>\0digest(base diff including the file)`. After the sync, the file is left out by `:(exclude,literal)` and the row becomes `<repo>\0digest(base diff without the file)\0landed:<path>:digest(diff against target)`. These are different strings, so combinedDiffIdentity differs and receipt-validity.mjs:188 reports review-contribution-changed for a receipt bound before the sync, which is the reported repro. The change only keeps the identity stable across later replays once a landedSynced entry already exists. No test compares the identity across a real sync. The 'again' case in sandbox-diff-identity.test.mjs feeds the same mocked stdout twice, and the concurrent-same-file and receipt-validity tests that design.md assigns to T001 were not changed. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1466) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 1 | F3-missing-sandbox-file-fails-open: Only the target file is checked with pathExists; the sandbox copy is not. landedSynced can record `sandbox: null`, for example when a repository sandbox never received a file an earlier change added. If the sandbox file is missing, git diff --no-index reports 'Could not access' and, as far as I can tell from git's source, exits with status 1 rather than an error status. The row then gets the digest of empty output, the same as when the sandbox copy equals the landed bytes. This is a silent collision instead of the null identity scenario 3 calls for. Fix: check that the sandbox file exists (or encode its absence), or treat empty stdout with status 1 as unavailable. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1395) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-path-normalization-fixture: The fixture header `a//api/src/shared.txt` is not what git produces: git strips one leading '/' from --no-index paths, giving `a/api/src/shared.txt`. Against real output the split/join produces `asrc/shared.txt`. That is still independent of where the target and sandbox live, but the test is not checking the real format. Separately, the output is decoded as latin1 while the path is a normal JS string, so for a non-ASCII path the substitution never matches and the absolute path stays in the digest. (root/.claude/harness/tests/sandbox-diff-identity.test.mjs:258) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F5-docs-overclaim-no-write: The docs (EN and TH), CHANGELOG, and the installer-test comment say no shipped rule grants a write or a delete. That is not quite true: the required `Bash(find *)` rule also matches `find . -delete` and `find . -exec rm {} +`, and `Bash(git diff *)`, `git log *`, and `git show *` match `--output=<file>`, which writes a file. This is the same prefix-rule reasoning the change uses to exclude cat. The spec mandates these rules, so this is a documentation accuracy issue, not an implementation defect. (root/website/docs/src/content/docs/install.md:115) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | F2-identity-differs-across-first-sync: Still open. This repair didn't touch the transition across the sync that first merges A's landed work. sync() takes preDiffIdentity (sandbox-runtime.mjs:2469) before replayLandedWithin writes landedReplay and landedSynced. At that point landedIdentityFiles returns {}, so the row is `<repo>\0digest(base diff including F)`. After the sync, F is excluded from the base diff and the row becomes `<repo>\0digest(base diff without F)\0landed:F:digest(sandbox vs target)`. The two strings differ in structure, so the identity changes across the very sync the scenario says must leave it unchanged, and B's receipt still goes stale with review-contribution-changed. The new tests only check the plan and row on mocked state after the sync. Neither one compares the identity before and after a real replay. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1471) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 2 | F6-landed-replay-dropped-on-next-sync: The F1 fix gates the landed base on Object.hasOwn(record.landedReplay, path). replayLandedWithin rebuilds landedReplay on every sync from result.merged only (sandbox-runtime.mjs:2310), and deletes the field when that set is empty. On the next sync, with no new landing, F already holds A's bytes merged with B's. replayLandedEdit's merge-file of base→target into that sandbox is then a clean no-op, so it returns {status:'carried'} (target-edits.mjs:399). F is not in result.merged, landedReplay loses F, and landedIdentityFiles drops it. F goes back into the base diff with A's and B's hunks, and the landed row disappears. So a no-op re-sync changes the identity again: a verdict re-bound after the merging sync goes stale, which is the problem this change exists to prevent. Fix: base the gate on something that survives later syncs, for example landedSynced together with sandbox bytes that differ from base, or carry earlier landedReplay entries forward while the landedSynced target still matches. Then add a test that runs the replay twice. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1397) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 2 | F7-landed-rows-bypass-code-pathspec: Landed rows are still added without checking codePathspec. If the replay merged a path the base diff leaves out (for example under .foundation/ or the change's own packet), that path now adds a landed row it never contributed before. The narrower merged/resolved gate makes this rare, but the plan should still drop landed paths that the code pathspec excludes. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1459) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | F8-bridge-comments-claim-base-move: The comment above IDENTITY_BRIDGE_LIMIT says a sync that "replayed onto a moved base" records a bridge. receipt-validity.mjs:204-208 likewise lists "moved base" among the bridged rewrites. The code does the opposite: it excludes movement?.rebased from cleanRewrite (sandbox-runtime.mjs:2505), as do the inline comment at 2496 and the spec scenario 'base move ที่ reshape diff ยังทำให้ verdict หมดอายุ'. Fix both comments so a future maintainer does not 'fix' the code to bridge base moves. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:1379) | minor | ยังเปิดอยู่ | claude-opus |
