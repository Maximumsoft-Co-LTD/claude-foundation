# Change: Land ของ change ที่เลือกเฉพาะ repository ลูก (ไม่มี root) archive tasks.md ที่ติ๊กแล้วจาก Build แทน ledger เดิมที่ยังไม่ติ๊ก

- **Change:** `land-change-repository-root-archive-tasks-md-build-ledger` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-17

## เหตุผล

ใน checkpoint 2026-10-18 lane order-inventory ไปถึง archived และ oracle ผ่าน 19/19 แต่
`tasks.md` ใน archive ยังเป็น `[ ]` ครบทั้ง T001–T003 ปัญหาเดียวกันนี้พบมาตั้งแต่ 2026-10-12

สาเหตุ:
- Build ติ๊ก task ใน packet ของ sandbox
- change ที่เลือกเฉพาะ repository ลูกจะ Land ผ่าน repository delivery saga ซึ่งไม่มี node ของ root
- ไม่มีขั้นไหน copy ความคืบหน้าของ task กลับมาที่ root packet
- `openspec archive` จึงย้าย ledger ที่ยังไม่ติ๊กไปเก็บ

## ขอบเขต

- หลัง saga apply ถ้า root ไม่ได้เป็น repository ที่เขียนได้ Land จะ merge task ที่ติ๊กใน sandbox
  เข้า `tasks.md` ของ root ก่อน `landCheck` และ archive
- ใช้กฎ `mergeTaskProgress` ชุดเดียวกับที่ sync ใช้ในทางกลับกัน

- **In scope (`sandbox-apply`):** archived tasks.md ของ change ที่เลือกเฉพาะ repository ลูกแสดงทุก task ที่ Build ทำเสร็จเป็น [x]
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/child-only-ledger.test.mjs`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `WORKFLOW.md`; the authored Non-goals below

## Non-goals

- ไม่ copy ไฟล์อื่นของ packet จาก sandbox กลับ root
- ไม่เปลี่ยน Land ของ change ที่มี root

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| child-only-ledger | ทุก task เสร็จ | unclassified | T001 | test: `.claude/harness/tests/child-only-ledger.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | บรรทัดอื่นไม่เปลี่ยน | unclassified | T001 |  |  |
|  | มี root | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for child-only-ledger.

## Appendix: Amendment history

- Revision 1 (2026-10-17): unit test ตรวจแค่ helper; contract multi-repository.sh เป็น Land แบบเลือกเฉพาะ repository ลูกที่ archived อยู่แล้วแต่ไม่เคยตรวจ archived tasks.md จึงเพิ่มเข้า paths เพื่อเป็น regression ระดับ Land จริง

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
