# Change: แก้ปัญหา harness ที่พบใน paid e2e ก่อน release

- **Change:** `harness-paid-e2e-release` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-16

## เหตุผล

paid e2e วันที่ 2026-10-16 และ review ของสอง change ก่อนหน้าพบปัญหาของ harness ที่ควรแก้ก่อน release ได้แก่ test provider ที่ timeout โดยไม่บอกสาเหตุ ตัวแปรของ session ที่รั่วเข้า test, work type ที่ประกาศผิดประเภท และ spec gap ที่ reviewer ระบุไว้ ผู้ใช้ตัดสินคำตอบของทุกข้อแล้ว

## ขอบเขต

- timeout เริ่มต้นของ provider เป็น 10 นาที และผลลัพธ์บอกว่า timeout พร้อมวิธีแก้
- ถอดตัวแปรสถานะ session ออกจาก environment ของ provider
- EDIT เมื่อ work type ขัดกับสัญญาณ typed
- gate ที่ waive, proof เก่าที่ไม่มี rolloutGates, การอ่านผล evaluation, heading ไทย, การ amend หัวข้อของ harness และ merge revision ของ v5

- **In scope:** provider ที่ไม่ตั้ง timeoutMs มีเวลา 10 นาที และ provider ที่ timeout บอกสาเหตุและวิธีแก้; provider ไม่ได้รับตัวแปรสถานะของ session จาก harness; work type ที่ขัดกับสัญญาณ typed ได้ EDIT ที่ระบุ type ที่ขาด; rollout gate ที่ถูก waive ไม่ค้าง และ proof เก่าที่ไม่มี rolloutGates ถือว่าไม่มี gate; evaluation อ่านผลจาก JSON บรรทัดสุดท้ายและ protocol ที่ผิดล้มพร้อมเหตุผล; heading ไทยของหัวข้อที่แสดงเป็นอังกฤษใช้ได้ และ amend หัวข้อของ harness ได้ EDIT; merge revision ของ minimal v5 ได้ key ที่ derive ให้ และเปลี่ยน version ไม่ได้
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/adapter-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/tests/proof-execution-boundaries.test.mjs`, `.claude/harness/tests/process-runtime.test.mjs`, `.claude/harness/EVIDENCE.md`, `website/docs/src/content/docs/evidence/adapters.md`, … +23 more

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| evidence-capabilities | provider-timeout, provider-env-isolation, rollout-gate-rules, evaluation-output | T001, T002, T004, T005 |
| work-type-catalog | work-type-signals | T003 |
| change-outline-contract | outline-heading-rules | T006 |
| hybrid-change-drafts | v5-merge-revision | T007 |

## ผลกระทบและความเสี่ยง

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## วิธีตรวจด้วยตัวเอง

- รัน proof ของ change นี้ที่มี `run-all.sh --affected` ใน test provider แล้วดูว่าผ่าน
- รัน paid checkpoint 23 lane บน candidate ที่สะอาด แล้วดูว่า webhook-integration ประกาศ work type integration

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| provider-timeout | ค่าเริ่มต้น 10 นาที | success | T001 | test: `.claude/harness/tests/proof-execution-boundaries.test.mjs`, `.claude/harness/tests/process-runtime.test.mjs` | — |
|  | ตั้งเองยังใช้ค่าที่ตั้ง | boundary | T001 |  |  |
|  | timeout บอกสาเหตุ | failure | T001 |  |  |
| provider-env-isolation | ตัวแปร session ถูกถอด | success | T002 | test: `.claude/harness/tests/evidence-bootstrap.test.mjs` | — |
|  | suite ที่เรียก harness ซ้อนผ่านใน proof | success | T002 |  |  |
|  | ตัวแปร contract ยังอยู่ | boundary | T002 |  |  |
| work-type-signals | ประกาศถูกแล้วผ่าน | success | T003 | test: `.claude/harness/tests/work-type-fields.test.mjs` | — |
|  | ไม่ประกาศ workType ใช้การเดาเดิม | boundary | T003 |  |  |
|  | integration ที่ประกาศเป็น feature | failure | T003 |  |  |
| rollout-gate-rules | release-health ที่ถูก waive | success | T004 | test: `.claude/harness/tests/required-providers.test.mjs`, `.claude/harness/tests/archive-appendices.test.mjs` | — |
|  | proof เก่าไม่มี rolloutGates | boundary | T004 |  |  |
|  | gate ตาม work type ไม่มี provider | boundary | T004 |  |  |
| evaluation-output | stdout มี log ปน | success | T005 | test: `.claude/harness/tests/new-capabilities.test.mjs` | — |
|  | protocol ผิด | failure | T005 |  |  |
| outline-heading-rules | heading ไทยของ Decisions | success | T006 | test: `.claude/harness/tests/draft-folder.test.mjs`, `.claude/harness/tests/amendment-invalidation.test.mjs` | — |
|  | amend หัวข้อที่ harness สร้าง | failure | T006 |  |  |
| v5-merge-revision | merge เพิ่ม requirement ใน minimal v5 | success | T007 | test: `.claude/harness/tests/change-revise.test.mjs` | — |
|  | merge เปลี่ยน version | failure | T007 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (18).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered |  | .claude/harness/runtime/evidence/adapter-runtime.mjs, .claude/harness/EVIDENCE.md | timeoutMs เริ่มต้น 120000 และ providerExecutionEnvironment ถอดแค่ CLAUDE_FOUNDATION_PROJECT |
| affected-actor | covered |  | .claude/harness/EVIDENCE.md | agent ที่รัน advance และผู้ดูแล consumer ที่มี test ยาวหรือเรียก claude-foundation ซ้อน |
| compatibility | covered |  | .claude/harness/runtime/evidence/adapter-runtime.mjs, .claude/harness/EVIDENCE.md | provider ที่ตั้ง timeoutMs เองและตัวแปร FOUNDATION_CHANGE_ID, FOUNDATION_REPOSITORIES_FILE ตาม contract ไม่เปลี่ยน; draft v4 ไม่เปลี่ยน |
| non-goals | covered |  | .claude/harness/EVIDENCE.md | ไม่เปลี่ยน contract ของ provider ที่เอกสารสัญญาไว้ ไม่เดา work type จาก prose และไม่เปลี่ยนนโยบาย review |
| operability | covered |  | .claude/harness/runtime/evidence/proof-execution-runtime.mjs | ผลลัพธ์ timeout บอก provider เวลาที่จำกัดและวิธีตั้ง timeoutMs เพื่อให้แก้ได้โดยไม่ต้องไล่ log |
| recoverability | covered |  | .claude/harness/runtime/evidence/proof-execution-runtime.mjs | provider ที่ timeout ยังคืน REPAIR พร้อม resume route เดิม และ gate ที่ waive ถอนได้ด้วย change waive --revoke |

Harness derive จากเนื้อหา draft (5): desired-behavior, success-path, failure-path, input-boundary, verification.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (5); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-risk-signal-case: riskSignalsOf compares signals case-sensitively, but semantic-intake.mjs:257 accepts riskSignals case-insensitively (RISK_SIGNAL_DIMENSIONS[signal.toLowerCase()]), and draftWorkTypes lowercases workType. As a result, a draft with workType ["feature"] and riskSignals ["External-Integration"] or ["PERFORMANCE-SLO"] passes validation and gets no EDIT about the missing work type. Lowercasing in riskSignalsOf would close this. (root/.claude/harness/runtime/workflow/validation/dev-document.mjs:446) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F2-merge-version-representation: The version guard compares patch.version !== base.version strictly. After a first merge on a minimal v4 draft, line 2788 deletes merged.version, so the recorded base has no version. A later merge patch that restates version 4 is then refused as '(unversioned to 4)' even though the version does not change. A string "5" against a numeric 5 is refused the same way. Normalizing the implicit v4 (and the type) before comparing would avoid these false refusals. (root/.claude/harness/runtime/workflow/change-lifecycle.mjs:2778) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-evaluation-report-shadowing: parseLastJsonLine runs only when parsedAdapterReport returns null, and parsedAdapterReport also tries the TAP, node-spec, assertion and runner-summary parsers on stdout. If an evaluation command's log lines match one of those (for example a line starting with 'ok' under reportFormat auto), that non-JSON report wins. The result then fails with 'missing score' instead of using the trailing JSON line. For the evaluation capability, the last-JSON-line result should probably take precedence over those other parsers. (root/.claude/harness/runtime/evidence/adapter-runtime.mjs:926) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-timeout-detail-untested-path: Two steps of the timeout detail have no tests: executeAdapter attaching `detail` when result.timedOut, and provider-scheduler.mjs:206 forwarding it. The new test only feeds a hand-built outcome to assertProofCollectionOutcomes. Also, the benchmark adapter returns at line 1034 before this point, so a benchmark that times out still shows only '<provider>:<status>' without the limit or the timeoutMs repair hint. (root/.claude/harness/runtime/evidence/adapter-runtime.mjs:1058) | minor | แก้แล้วในรอบ 2 | claude-opus |
