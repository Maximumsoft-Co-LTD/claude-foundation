# Change: ให้ Prove แสดงความคืบหน้าและไม่รัน test เต็มชุดบนโค้ดเดิมซ้ำ

- **Change:** `prove-proof-progress` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-16

## เหตุผล

Prove ของ change ล่าสุดใช้เวลา 45.6 นาที ซึ่งเป็นงานของ harness และ test จริงเพียง 7.9 นาที ส่วนที่เหลือเป็นการรอที่มองไม่เห็นความคืบหน้า และทุกการ Prove รัน test ทั้ง chain ซ้ำบนโค้ดเดิมเพื่อพิสูจน์ว่า test ล้มก่อนแก้ change นี้ทำให้เห็นความคืบหน้าและตัดการรันซ้ำนั้น

## ขอบเขต

- advance ระหว่าง proof รันอยู่แสดง provider ที่กำลังรัน ที่จบแล้ว และเวลาที่ผ่านไป
- การตรวจ test บนโค้ดเดิมรันเฉพาะ segment ที่ test เปลี่ยน และรันทั้งหมดเมื่อจับคู่ไม่ชัด

- **In scope (`prove`):** advance ระหว่าง proof รันอยู่แสดง progress ของ proof; การตรวจ test บนโค้ดเดิมรันเฉพาะ segment ที่มี test เปลี่ยน
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/provider-scheduler.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/proof-advance.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, … +7 more

## ผลกระทบและความเสี่ยง

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

advance ระหว่าง proof รันอยู่แสดง provider ที่กำลังรัน ที่จบแล้ว และเวลาที่ผ่านไป และการตรวจ test บนโค้ดเดิมรันเฉพาะ task ที่ test เปลี่ยน

## วิธีตรวจด้วยตัวเอง

- ระหว่าง proof รัน ให้รัน `claude-foundation advance <change>` อีกครั้ง แล้วดู `wait.progress`
- เทียบเวลาของ Prove ใน `claude-foundation feedback <change>` กับ change ก่อนหน้า

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| proof-progress | progress ระหว่างรัน | success | T001 | test: `.claude/harness/tests/proof-advance.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs` | — |
|  | provider ที่จบแล้ว | success | T001 |  |  |
|  | สถานะเดิมไม่เปลี่ยน | boundary | T001 |  |  |
| narrow-discrimination | รันเฉพาะ segment ที่ test เปลี่ยน | success | T002 | test: `.claude/harness/tests/test-discrimination.test.mjs`, `.claude/harness/tests/semantic-draft.test.mjs` | — |
|  | ไม่มี segment ใช้แบบเดิม | boundary | T002 |  |  |
|  | จับคู่ไม่ได้รันทั้งหมด | failure | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered |  | .claude/harness/runtime/evidence/proof-execution-runtime.mjs, .claude/harness/runtime/evidence/test-discrimination.mjs | advance ปิด console.log ระหว่างรัน (foundation.mjs) และ mutationInProgress คืนแค่ pid; scopedTestCommand ยอมแพ้เมื่อคำสั่งมี shell syntax จึงรันทั้ง chain บนโค้ดเดิม |
| affected-actor | covered |  | .claude/harness/runtime/workflow/advance-runtime.mjs | agent และผู้ใช้ที่รอ proof และ consumer ที่มี change หลาย task |
| compatibility | covered |  | .claude/harness/runtime/workflow/semantic-draft.mjs | field command ของ provider ไม่เปลี่ยน segment เป็น field เพิ่ม receipt identity เดิมคงอยู่ และ provider ที่ไม่มี segment ใช้วิธีเดิม |
| non-goals | covered |  | .claude/harness/EVIDENCE.md | ไม่ reuse task check ของ Build ไม่เปลี่ยนนโยบาย review และไม่ลดหลักฐานที่ Prove ต้องรัน |
| operability | covered |  | .claude/harness/runtime/evidence/provider-scheduler.mjs | progress ทำให้เห็นว่า proof อยู่ขั้นไหนและใช้เวลาเท่าไร ลดการรันซ้อน |
| recoverability | covered |  | .claude/harness/runtime/evidence/proof-execution-runtime.mjs | status, stage และ workspaceHash ของ RUNNING record ไม่เปลี่ยน การตรวจ INDETERMINATE หลัง process ตายทำงานเหมือนเดิม |

Harness derive จากเนื้อหา draft (5): desired-behavior, success-path, failure-path, input-boundary, verification.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-16): Review advisory: dropping an earlier segment can drop a setup step (build, codegen), so a base run fails for an unrelated reason and a weak test passes discrimination. Keep every segment up to the last one that names a changed test.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-partial-segment-match: When a change touches several test files and only some of them appear in a segment, segmentTestCommand keeps just the matching segments and drops the rest. The spec and design say that case should run the whole provider command ('run the whole command when matching is not clear'; design: 'not sure → run the whole chain'). Two ways it goes wrong: (a) If the one matched segment can't be narrowed (e.g. `npx vitest run tests/b.test.ts`), only that segment runs on the old code. A changed test that only another segment runs (e.g. a generic `npm test`) is never checked, and if b passes on the old code the change gets a false 'tests pass on base' repair. (b) If the matched segment can be narrowed (node --test, pytest), scopedTestCommand(sh -c segment, files) appends every changed test file, including ones from other segments or other runners. A wrong-runner failure then counts as 'fails-on-base' and lets a weak test through. Before this change a multi-segment `(a) && (b)` chain was never narrowed (taskCheckArgv rejects it), so this is new behavior. Fix: use segments only when every changed test file matches at least one segment, otherwise return null; narrow a single segment only to the files it names. (root/.claude/harness/runtime/evidence/test-discrimination.mjs:70) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-scheduler-events-untested: The new proof-advance test replaces runExecutionDag with a fake that sends the wave and provider events itself. Nothing tests the scheduler code that actually sends them, or the durationMs it measures around executeAdapter. The progress status and durationMs scenarios are only shown for merging events that are given in. (root/.claude/harness/runtime/evidence/provider-scheduler.mjs:201) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-stale-progress-view: mutationInProgress shows the record's progress whatever the record's status. A RUNNING record left by a crashed run still holds its progress, so when the lock is held by an unrelated operation (proof finalize, an evidence receipt) the caller sees that dead run's wave, running providers and a growing elapsedMs. Show progress only when the record is RUNNING. Also, elapsedMs uses Date.now() while startedAt comes from the injected now() clock. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs:1487) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-amendment-segments-untested: No test covers withChain replacing or removing segments when a change is amended (lines 1266 and 1304). A test provider newly added by an amendment (line 1293) gets the combined command but no segments; that safely falls back to the whole command. The design's file map lists semantic-draft.test.mjs as changed, but it is not in the diff, and only the verifyChain unit test covers derivedExecution producing segments. (root/.claude/harness/runtime/workflow/semantic-amendment.mjs:1293) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F5-substring-match: Segments are matched with `segment.includes(file)`, so a short repository-relative path (e.g. root `a.test.mjs`) also matches a segment that names `pkg/a.test.mjs` or `a.test.mjs.snap`, and the wrong segment can be chosen. Match on token or path boundaries instead. (root/.claude/harness/runtime/evidence/test-discrimination.mjs:70) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1-substring-coverage-guard: The new all-files-covered guard (line 74) uses the same `segment.includes(file)` substring match as before (F5). So a changed test can count as covered by a segment that names a different file. Example: changed root `src/utils.test.ts` with segments ["npm test", "npx vitest run packages/web/src/utils.test.ts"]. Only the vitest segment is chosen and `npm test`, the segment that would run the root file, is dropped. That segment can't be narrowed, so it runs as-is and the changed test never runs on base. That can produce a false 'passes-on-base' repair, the F1(a) outcome on a nearby input. The same thing happens when a segment changes directory first (e.g. `cd web && node --test test/a.test.mjs` against a changed root `test/a.test.mjs`). Match on whitespace-delimited path tokens, with no cwd-changing prefix, instead of substrings. This is non-blocking because it needs a path that is a suffix of another path named in a segment. (root/.claude/harness/runtime/evidence/test-discrimination.mjs:72) | minor | แก้แล้วในรอบ 3 | claude-opus |
