# Change: ให้ template ของ change start พา agent ไปเขียน draft v5

- **Change:** `template-change-start-agent-draft-v5` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-16

## เหตุผล

paid e2e วันที่ 2026-10-16 พบว่าทุก lane ยังได้ draft v4 และส่วนใหญ่ไม่ประกาศ workType เพราะ `change start --template` นำด้วย minimal draft แบบ JSON ที่ไม่มี workType ความสามารถ v5 และหัวข้อตามประเภทงานจึงไม่ถูกใช้ในงานปกติ เช่น งาน REST API ได้ work type `code` และไม่มีหัวข้อ API contract

## ขอบเขต

- คำสั่ง save และ minimal draft ใน template ชี้ไปที่โฟลเดอร์ v5 และมี workType
- คำสั่ง /change, skill change, harness README และหน้า loop/change ของ website ทั้งสองภาษาสอนทางเดียวกัน
- draft v4 แบบ JSON ยังเริ่ม change ได้เหมือนเดิม

- **In scope (`change`):** template ของ change start นำด้วยโฟลเดอร์ v5 ที่มี workType และ v4 ยังใช้ได้; prose หัวข้อ Summary, Why, User stories และ Success criteria ของ v5 นับเป็นข้อมูลที่ผู้เขียนเขียนเอง; คำสั่ง skill และเอกสารสองภาษาสอนโฟลเดอร์ v5 พร้อม workType เป็นทางหลัก
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/reader-guide.mjs`, `.claude/harness/runtime/workflow/draft-folder.mjs`, `.claude/harness/tests/reader-guide.test.mjs`, `.claude/harness/tests/draft-folder.test.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, … +11 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

change start --template เริ่มที่ draft v5 แบบโฟลเดอร์และให้ประกาศ workType ตั้งแต่แรก draft v4 แบบ JSON ยังใช้ได้

## วิธีตรวจด้วยตัวเอง

- รัน `claude-foundation change start --template` แล้วดูว่า `save` และ `minimalDraft` เป็นโฟลเดอร์ v5 ที่มี workType
- รัน paid lane เดิมอีกครั้งแล้วดูว่า packet บันทึก `semanticDraftVersion` 5 และ work type ที่ประกาศ

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| template-leads-with-v5 | template นำด้วย v5 | success | T002 | test: `.claude/harness/tests/change-atomic-start.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/tests/draft-folder.test.mjs`, `.claude/harness/tests/public-command-golden.test.mjs` | — |
|  | minimal draft ที่กรอกแล้วเริ่มได้ | success | T002 |  |  |
|  | draft v4 แบบ JSON ยังใช้ได้ | boundary | T002 |  |  |
|  | work type ที่ประกาศบังคับหัวข้อของตัวเอง | failure | T002 |  |  |
| v5-prose-counts-as-authored | prose เหตุผลนับเป็น why | success | T001 | test: `.claude/harness/tests/reader-guide.test.mjs`, `.claude/harness/tests/draft-folder.test.mjs` | — |
|  | prose user story และเกณฑ์นับเป็นของผู้เขียน | success | T001 |  |  |
|  | ไม่มีทั้ง field และ prose ยังเตือน | failure | T001 |  |  |
| instructions-teach-v5 | คำสั่ง /change สอนโฟลเดอร์ v5 | success | T003 | test: `.claude/harness/tests/permission-allowlist.test.mjs` | — |
|  | ทางเขียน draft ได้รับอนุญาตล่วงหน้า | boundary | T003 |  |  |
|  | เอกสารสองภาษาตรงกัน | boundary | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (10).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Why:** not authored separately; the intent above states it.
- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for template-leads-with-v5, v5-prose-counts-as-authored, instructions-teach-v5.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-v5-full-drafts-expanded-as-minimal: isMinimalSemanticDraft now accepts version 5. A full v5 folder draft written to the typed-field reference (semanticDraftTemplate, line ~1592) has requirements and tasks but no claims or specs, so it passes this check too. Every v5 folder therefore goes through expandMinimalSemanticDraft, which sets _minimalDraft and, at line 1014, rewrites each top-level decision that lacks decidedBy to decidedBy: "agent". Before this change, a v5 draft's unmarked decisions counted as non-agent, which is still how the same content behaves as a version-4 JSON draft. Two effects follow. (1) A decision the author did not mark as the agent's now renders as decided by the agent / 'Decisions to ratify'. (2) semanticDraftKeepsDesign (change-lifecycle.mjs:959) drops it, so a rapid v5 draft that authored a design decision can lose design.md. This breaks draft-version.mjs's stated rule that v5 is v4 semantics plus folder prose. No test covers a full v5 draft with decisions. Fix: limit the v5 branch to genuinely minimal drafts, for example by requiring no keyed requirements/tasks, or by keeping v4's decidedBy default for v5 drafts. Then add a draft-folder test where a full v5 draft's unmarked decision stays non-agent. (root/.claude/harness/runtime/workflow/semantic-draft.mjs:636) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-minimal-folder-test-adds-extra-fields-and-vacuous-version-assert: The comment says the filled minimal folder 'starts without extra fields', yet the test adds userFlow and releaseNote. So the scenario as written — only replacing the example values — is not exercised. It would pass on the rapid lane, since devDocumentIssues returns [] when the draft is not standard. Separately, `JSON.parse(...).draftSource?.version ?? 5` is always 5: the runtime stores the draft under draftSource.draft (change-lifecycle.mjs:2768), so draftSource.version is undefined. Drop the extra fields and assert draftSource.draft.version === 5. (root/.claude/harness/tests/draft-folder.test.mjs:432) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-why-note-assert-vacuous-on-rapid-lane: The integration test asserts the proposal has no '**Why:** not authored separately' line, but its change is rapid. derivedByHarness returns [] when the draft is not standard (dev-document.mjs:342), and readerGuideWarnings runs only for foundation-standard (change-lifecycle.mjs:1617), so this assertion cannot fail. The v5-prose behavior is proven only by the reader-guide unit test, which hand-builds the prose object. No folder-based test checks it on a standard-lane draft, including a Thai 'เหตุผล' heading. (root/.claude/harness/tests/draft-folder.test.mjs:441) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | F4-minimal-v5-revise-merge-no-longer-reexpands: The F1 fix accepts a v5 draft as minimal only when every requirement and task has no `key`. This breaks `change revise --merge` for a change started from the template's minimal v5 folder. startAtomic records the expanded draft (`compiledDraftSource(pending, source)`, change-lifecycle.mjs:2583). That draft already carries derived keys, `version: 5` and `_minimalDraft: true`. `mergedRevisionSource` (change-lifecycle.mjs:2779-2786) keeps version 5 for a minimal v5 draft, removes `_minimalDraft`, and calls `expandMinimalSemanticDraft` so that patch-added rows get derived keys, titles, inferred covers and agent decisions 'exactly as at start'. Because the base rows are keyed, `unkeyed(...)` is false, so the merged draft is no longer minimal and is returned unchanged. Take a patch that adds a requirement without a key and widens a task's covers, the same patch as the v4 test at change-revise.test.mjs:223. It now fails full normalization with `semantic draft requirements[1].key is required` (semantic-draft.mjs:456). It also loses the minimal-only covers hints, and new unmarked decisions are no longer treated as the agent's. Before this delta, v5 skipped the keyed-row check and the merge worked. Fix: also treat a v5 draft as minimal when it is explicitly marked, for example by passing a flag from mergedRevisionSource or by keeping `_minimalDraft` until expansion and accepting `source._minimalDraft === true` in the v5 branch. Then add a revise --merge test that starts from the template's minimal v5 folder and adds a requirement without a key. (root/.claude/harness/runtime/workflow/semantic-draft.mjs:639) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
