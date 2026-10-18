# Change: หน้าอนุมัติแสดงตัวอย่างจริง สรุปภาษาคน และผลจริงหลัง Build

- **Change:** `approval-package-scratch-summary` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-18

## สรุป

หน้า approval package แสดงสรุปภาษาคน 3 ข้อบนสุด ตัวอย่างจริงตามประเภทงาน diagram เป็นรูปแบบออฟไลน์ และแท็บผลจริงหลัง Build ข้างตัวอย่างที่ตกลงไว้

## เหตุผล

ตอนนี้ package แสดงชื่อ artifact และตารางจาก draft ที่เขียนให้วิศวกรอ่าน ผู้อนุมัติจึงไม่รู้ว่าจะได้งานแบบไหน การทดลองกับ change จริง 10 ตัวพบว่าตัวอย่างจริง เช่น ตารางสิทธิ์ ตัวเลข repro และ latency ช่วยตัดสินใจได้จริง แต่ change ส่วนใหญ่ไม่มีช่องให้เก็บตัวอย่าง เป้า และตัวเลขผลกระทบ

## User story

- **P1** ในฐานะ ผู้อนุมัติที่ไม่ได้อ่านโค้ด ฉันต้องการ เห็นว่าจะได้อะไร ของเดิมเปลี่ยนอะไร และถ้าพลาดเป็นยังไง ในภาษาคนบนสุดของหน้า เพื่อ ตัดสินใจได้โดยไม่ต้องอ่านเอกสารเทคนิค Requirement: scratch-summary, package-language.
- **P1** ในฐานะ ผู้อนุมัติ ฉันต้องการ เห็นตัวอย่างจริงตามประเภทงาน เช่น payload API ตัวเลขกฎ แถวข้อมูลก่อนหลัง เพื่อ เจอความเข้าใจผิดก่อน Build Requirement: scratch-examples.
- **P2** ในฐานะ ผู้อนุมัติ Land ฉันต้องการ เทียบผลจริงหลัง Build กับตัวอย่างที่ตกลงไว้ในหน้าเดียวกัน เพื่อ รู้ว่าได้งานตามที่ตกลงจริง Requirement: example-actual.
- **P2** ในฐานะ agent ที่เขียน draft ฉันต้องการ ได้คำเตือนเมื่อขาดเป้า ตัวเลขผลกระทบ หรือตัวอย่างจริง เพื่อ เติมข้อมูลที่ผู้อนุมัติต้องใช้ได้ทันโดยไม่ถูกบล็อก Requirement: scratch-nudges.

## เกณฑ์ความสำเร็จ

- change จริง 10 ตัวที่ทดลองไว้ render เป็น package ที่มี 3 คำถามบนสุดและตัวอย่างอย่างน้อย 1 บล็อกเมื่อ draft มี examples
- package ที่ไม่มี examples หรือ scratch ยังสร้างได้เหมือนเดิมและไม่ล้มคำสั่งใด

## ขอบเขต

- **In scope:** ช่อง scratch และ examples ใน draft, renderer ใหม่ที่ยังมีส่วนตามบทบาทเดิม, แท็บผลจริงจาก receipt และ preview, ภาษาไทยและอังกฤษ, Mermaid ในเครื่อง, NOTE: scratch ตอน change start, router 3 จุด
- **Non-goals:** ไม่บังคับให้มี scratch หรือ examples, ไม่สร้าง prototype ให้อัตโนมัติ, ไม่เปลี่ยนสัญญา receipt หรือ proof, ไม่เปลี่ยน runtime API

- **In scope (`approval-package`):** แสดงสรุป จะได้อะไร ของเดิม ของใหม่ และถ้าพลาด จาก draft.scratch บนสุดของ package; Render draft.examples เป็นบล็อกตามชนิดที่รองรับทั้ง 29 ชนิด; แสดงผลจริงหลัง Build ของแต่ละตัวอย่างจาก receipt หรือ preview ที่ capability ตรงกัน; แสดงหัวข้อและป้ายของ package เป็นภาษาไทยเมื่อ draft.language เป็น th และภาษาอังกฤษในกรณีอื่น; Render diagram ด้วย Mermaid ในเครื่องโดยไม่โหลดอะไรจากภายนอก; package อ่านอย่างเดียวที่ไม่โหลดอะไรผ่านเครือข่าย; เนื้อหา agreement ถูก escape และมี script ของ harness เพียงตัวเดียว; เตือนแบบไม่บล็อกตอน change start เมื่อ draft ขาดตัวอย่าง เป้า หรือตัวเลขผลกระทบ; เลือก domain ตามที่เก็บข้อมูล ชนิดตัวอย่าง และสิทธิ์อย่างแม่นยำ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/runtime/workflow/scratch-fields.mjs`, `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/runtime/contracts/scratch-router.mjs`, `.claude/harness/tests/scratch-router.test.mjs`, … +20 more

## ผลกระทบและความเสี่ยง

หน้า package มี script ของ harness หนึ่งตัวเป็นครั้งแรก ข้อความจาก draft ทุกช่องยังถูก escape และไม่มีช่องใดรับ HTML ดิบ harness ใหญ่ขึ้นราว 3MB จากไฟล์ Mermaid ถ้าไฟล์หาย diagram กลับเป็นข้อความเหมือนเดิม

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้าอนุมัติแสดงสรุปภาษาคน ตัวอย่างจริงตามประเภทงาน diagram เป็นรูปแบบออฟไลน์ และแท็บผลจริงหลัง Build

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| scratch-summary | มี scratch ครบ | success | T001, T003, T005 | test: `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ไม่มี scratch | boundary | T001, T003, T005 |  |  |
|  | ข้อความยาวเกิน | failure | T001, T003, T005 |  |  |
|  | scratch ไม่ใช่ object | failure | T001, T003, T005 |  |  |
| scratch-examples | ตัวอย่าง API สองกรณี | success | T001, T003, T005 | test: `.claude/harness/tests/scratch-draft-fields.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ค่าที่มี HTML | boundary | T001, T003, T005 |  |  |
|  | ครบ 29 ชนิด | boundary | T001, T003, T005 |  |  |
|  | ชนิดไม่รู้จัก | failure | T001, T003, T005 |  |  |
|  | ขาดช่องบังคับ | failure | T001, T003, T005 |  |  |
|  | prototype ชี้นอก previews | failure | T001, T003, T005 |  |  |
| example-actual | มี receipt ผ่าน | success | T003, T005 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | มีแค่ preview | boundary | T003, T005 |  |  |
|  | preview เก่า | boundary | T003, T005 |  |  |
|  | ยังไม่มีผล | boundary | T003, T005 |  |  |
|  | receipt ล้ม | failure | T003, T005 |  |  |
| package-language | ภาษาไทย | success | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ภาษาอื่น | boundary | T003 |  |  |
| package-offline-diagrams | มีไฟล์ vendor | success | T003, T005 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ไม่มีไฟล์ vendor | boundary | T003, T005 |  |  |
|  | ไม่มี script อื่น | failure | T003, T005 |  |  |
| package-render | สร้าง package | success | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | ไม่แก้ state | unclassified | T003 |  |  |
|  | draft v3 ไม่มี draftSource | unclassified | T003 |  |  |
|  | ไม่พบ change | unclassified | T003 |  |  |
| package-content | ค่าที่มี HTML | boundary | T003 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | API contract | failure | T003 |  |  |
|  | permission matrix | failure | T003 |  |  |
|  | test matrix | unclassified | T003 |  |  |
|  | ไม่ได้ประกาศ | unclassified | T003 |  |  |
| scratch-nudges | ไม่มีตัวอย่าง | success | T004, T005 | test: `.claude/harness/tests/scratch-nudges.test.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs` | — |
|  | performance ไม่มีเป้า | success | T004, T005 |  |  |
|  | bugfix ไม่มีตัวเลขผลกระทบ | success | T004, T005 |  |  |
|  | impact low | boundary | T004, T005 |  |  |
|  | ครบแล้ว | boundary | T004, T005 |  |  |
| router-domain-precision | kanban ใน localStorage | success | T002 | test: `.claude/harness/tests/scratch-router.test.mjs` | — |
|  | app CRUD ไม่ใช่รายงาน | success | T002 |  |  |
|  | สิทธิ์ได้ threat model | success | T002 |  |  |
|  | migration ฝั่ง server | boundary | T002 |  |  |
|  | รายงานจริง | boundary | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (39).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: 0 change ถูกบล็อกเพราะไม่มี scratch หรือ examples และทุกตัวอย่าง 29 ชนิด render ได้ใน test.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| accessibility | covered | scratch-examples, package-offline-diagrams |  |  |
| input-boundary | covered | scratch-summary, scratch-examples |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (7); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for scratch-summary, scratch-examples, example-actual, package-language, package-offline-diagrams, package-render, package-content, scratch-nudges, router-domain-precision.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-package-language-hardcoded-english: package-language requires Thai headings and labels when draft.language is th, but renderApprovalPackage still hard-codes English text. The suggestions h2 is the literal 'Suggested previews' even though packageText defines t.suggestions ('Preview ที่แนะนำ') and never uses it (line 305). The role-table evidence labels come from the English-only LABEL_TEXT, so the role table shows 'no evidence yet' and 'preview (stale)' where the Thai 'ยังไม่มีผล' and 'preview เก่า' are expected (line 287). The headers 'Artifact/Domains/Evidence', 'No approval needed from this role…', 'No specific domain.', 'Packet:' and the suggestion text are also English (lines 285, 289, 305-310, 401, 403). The Thai test (scratch-blocks.test.mjs:188-192) passes only because 'ยังไม่มีผล' appears in the example tab, so it does not prove that the package's headings and labels follow the language. Fix: route these strings through t (use t.suggestions and t.none/t.preview/t.stale for the role labels) and add assertions that a Thai High-risk page has no English 'Suggested previews' or 'no evidence yet'. (root/.claude/harness/runtime/workflow/approval-package.mjs:305) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-html-lang-mismatch: When draft.language is not Thai (for example ja), the page text falls back to English, but <html lang> is still set to the draft language ('ja'). Screen readers and hyphenation then treat English text as Japanese. Use 'en' whenever the English text table is chosen. (root/.claude/harness/runtime/workflow/approval-package.mjs:317) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-browser-storage-object-form: routeForState treats data as browser-only only when every entity row has store === 'browser'. The validated object form of dataModel puts store at the model level (contract-fields.mjs:503, rendered from model.store at :585), and its entities usually carry no store. A draft like { dataModel: { store: 'browser', entities: [...] } } therefore still routes to Data Migration (domain 15), High risk and the devops role. Consider also accepting a model-level store. (root/.claude/harness/runtime/workflow/approval-package.mjs:46) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-first-provider-only: exampleActual uses results.find(...), so it reads only the first provider receipt with the matching capability. If an earlier provider's receipt is invalid, inconclusive or failed and a later provider has a valid pass, the tab shows none, preview or failed. Meanwhile the role table labels the same capability 'proof' through the `proven` set. Prefer a valid pass, then a failure, over other receipts. (root/.claude/harness/runtime/workflow/approval-package.mjs:233) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F5-list-rule-shape: report.kpis uses the bare 'list' rule, so ['38M'] passes validation. The renderer, however, reads row.value and row.label (scratch-blocks.mjs:163), so it draws an empty KPI box. A key rule such as ['label','value'] would keep the validator and the renderer in agreement. (root/.claude/harness/runtime/workflow/scratch-fields.mjs:40) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1-suggestion-artifact-and-stale-suffix-english: Two small English leftovers on a Thai page. (1) In the suggestion list, row.artifact comes from previewSuggestions (line 128, `artifact: row.label`), which is the English router label. The role table, by contrast, uses t.artifactNames[row.id], so the same artifact gets a Thai name in the role view and an English name in the suggestions. (2) previewOutput still adds a hard-coded ', stale' after the status of a stale preview. The test misses both: 'ลองเรียก API (mock)' already appears in the role table, and the forbidden-string list leaves out ', stale' and the English artifact labels. Suggested fix: carry the artifact id into each suggestion and render t.artifactNames[id] \|\| label, and use a t entry for the stale suffix. (root/.claude/harness/runtime/workflow/approval-package.mjs:313) | minor | ยังเปิดอยู่ | claude-opus |
