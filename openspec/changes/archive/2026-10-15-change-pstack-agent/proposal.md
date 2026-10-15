# Change: เพิ่มเกณฑ์ผ่านที่ผูกกับหลักฐานและการเรียนรู้ข้าม change ตามแนวคิด pstack โดยไม่สร้างทางตันให้ agent หรือผู้ใช้

- **Change:** `change-pstack-agent` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-14 · **Status:** `claude-foundation changes`

## Why

ปัจจุบัน Change Loop เลือก assurance ตาม risk และผูกสถานะกับ receipt อยู่แล้ว แต่ยังมีช่องว่าง: performance ตรวจได้แค่ exit code ของคำสั่ง (ไม่มีการเทียบ base กับ head), access-control บังคับแค่ทาง deny ใน grounding v2 และไม่บังคับทาง allow, การเงินไม่มี riskSignal (จับได้แค่ regex เพื่อยก review), metrics วัดได้ทีละ change และไม่มีกลไกเปลี่ยนปัญหาที่เกิดซ้ำเป็น check ถาวร. Maintainer และ consumer agent ได้เกณฑ์ผ่านที่ตรวจได้จริงต่อประเภทงาน และ human owner เห็นแนวโน้มคุณภาพข้าม change โดยทุก gate ใหม่คืนทางทำต่อเสมอ

## User stories

- **P1** As consumer agent, I want Prove เทียบ performance ของ head กับ base ภายใต้ environment เดียวกัน so that การอ้างว่าเร็วขึ้นหรือไม่ช้าลงมีหลักฐาน ไม่ใช่แค่คำสั่งรันผ่าน. Requirements: benchmark-base-head-comparison.
- **P1** As maintainer, I want change ที่แตะสิทธิ์ต้องระบุทั้งกรณีที่อนุญาตและที่ต้องปฏิเสธ so that ไม่หลุดกรณีปฏิเสธเกินหรืออนุญาตเกิน. Requirements: access-control-allow-deny.
- **P1** As maintainer, I want งานการเงินประกาศ riskSignal financial แล้วได้ coverage และ review ระดับสูงอัตโนมัติ so that ไม่ต้องพึ่งคำใน prose. Requirements: financial-risk-signal, financial-review-tier.
- **P2** As human owner, I want เห็นอัตราผ่าน Prove ครั้งแรก rework การตัดสินใจของคน ต้นทุน และบั๊กที่หลุด ข้าม change so that รู้ว่าการปรับ workflow ดีขึ้นจริงหรือไม่. Requirements: outcomes-rollup, draft-fixes-link.
- **P2** As maintainer, I want เห็นปัญหาที่เกิดซ้ำข้าม change พร้อมข้อเสนอ check ถาวร so that เปลี่ยนบทเรียนเป็นระบบตรวจแทนการเพิ่ม prompt. Requirements: lessons-rollup, review-finding-code.
- **P3** As consumer agent, I want บอกได้ว่า hypothesis ใดจะถูกพิสูจน์ด้วย experiment ใด และเขียน constraints ใน draft ได้ตรง ๆ so that Investigation และ Change ส่งต่อเงื่อนไขได้ครบ. Requirements: hypothesis-next-check, draft-constraints.

## Success criteria

- ทุก requirement ใน change นี้มี test ที่ fail บน base (tests-not-discriminating ไม่เกิด) และ pass บน head
- ไม่มี gate ใหม่ใดคืน BLOCKED หรือทางตัน: ทุก failure คืน EDIT หรือ REPAIR ที่ระบุ field/finding และ resume route หรือเป็น advisory
- outcomes และ lessons ไม่เขียนไฟล์ใด ๆ ใต้ .foundation (ตรวจด้วย digest ของ store ก่อนและหลังรัน)
- full suite sh .claude/tests/run-all.sh ผ่าน และ public command golden fixture อัปเดตเป็น 75 คำสั่ง

## Capabilities

| Capability | Requirements | Tasks |
|---|---|---|
| evidence-quality | Benchmark evidence compares head with base under one environment | T001, T008 |
| change | Access-control drafts declare allowed and denied cases, Financial work declares a typed risk signal, Semantic drafts carry explicit constraints, Semantic drafts declare which archived changes they fix | T002, T003, T004, T008 |
| review-policy | Financial risk signal selects high review, Review findings may carry a stable code | T003, T005 |
| runtime-observability | Cross-change outcomes are a read-only rollup, Recurring problems become advisory check proposals | T006, T008 |
| investigation-intake | Hypotheses name the experiment that tests them | T007, T008 |

## Scope

- **In scope:** receipt ของ benchmark มี samples ของ base และ head, median แต่ละฝั่ง, regressionPercent, threshold และ environment descriptor เดียว; inspect คืน EDIT ที่ agent แก้ได้เองเมื่อขาดฝั่งใดฝั่งหนึ่ง และ harness derive coverage permission-rejection จาก scenario deny; draft ที่ประกาศ financial ต้องครอบ idempotency และการกู้คืน ไม่ว่าจะเขียน prose ภาษาใด; review ระดับสูงถูกเลือกจาก field typed โดยไม่ต้องมีคำว่า payment ใน intent; constraints ถูก render ใน proposal และใช้เป็นเป้า investigationCoverage แบบ constraint ได้; change ที่แก้บั๊กของ change ก่อนหน้าระบุได้ชัด และ outcomes ใช้นับ escaped defect; รายงานต่อ change และรวมตาม cohort: firstProofPass, proofRuns, reviewAttempts, reviewRepairRounds, amendments, reopenedTasks, userDecisions, cost, escapedDefects; แต่ละ lesson มี code, source (blocker หรือ review), changes ที่เกิด, จำนวนครั้ง, ชนิด check ที่เสนอ และ route /change; ไม่สร้าง check เอง; finding ใหม่จัดกลุ่มข้าม change ได้ โดย finding ที่ไม่มีหรือ code ผิดรูปแบบยังถูกรับและนับเป็น uncoded; รายงานส่วน Unknowns แสดง experiment key, คำถาม และสถานะต่อ hypothesis ที่เปิด หรือระบุว่ายังไม่มี next check
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/benchmark-runtime.mjs`, `.claude/harness/runtime/evidence/provider-catalog.mjs`, `.claude/harness/runtime/evidence/adapter-runtime.mjs`, `.claude/harness/runtime/evidence/test-discrimination.mjs`, `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, … +43 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| benchmark-base-head-comparison › prove-provider | happy | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › prove-provider-2 | failure | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › prove-provider-3 | edge | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › prove-provider-4 | edge | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › prove-provider-5 | failure | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › prove-provider-6 | failure | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| benchmark-base-head-comparison › change-start-inspect | failure | T001, T008 | .claude/harness/tests/benchmark-evidence.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| access-control-allow-deny › change-start-inspect | happy | T002, T008 | .claude/harness/tests/semantic-intake.test.mjs |
| access-control-allow-deny › change-start-inspect-2 | failure | T002, T008 | .claude/harness/tests/semantic-intake.test.mjs |
| access-control-allow-deny › change-start-inspect-3 | failure | T002, T008 | .claude/harness/tests/semantic-intake.test.mjs |
| access-control-allow-deny › change-start-inspect-4 | failure | T002, T008 | .claude/harness/tests/semantic-intake.test.mjs |
| access-control-allow-deny › change-start-inspect-5 | edge | T002, T008 | .claude/harness/tests/semantic-intake.test.mjs |
| financial-risk-signal › change-start-inspect | happy | T003, T008 | .claude/harness/tests/semantic-intake.test.mjs, .claude/harness/tests/review-policy.test.mjs |
| financial-risk-signal › change-start-inspect-2 | edge | T003, T008 | .claude/harness/tests/semantic-intake.test.mjs, .claude/harness/tests/review-policy.test.mjs |
| financial-risk-signal › change-start-inspect-3 | failure | T003, T008 | .claude/harness/tests/semantic-intake.test.mjs, .claude/harness/tests/review-policy.test.mjs |
| financial-review-tier › harness-review-tier | happy | T003 | .claude/harness/tests/semantic-intake.test.mjs, .claude/harness/tests/review-policy.test.mjs |
| financial-review-tier › harness-review-tier-2 | edge | T003 | .claude/harness/tests/semantic-intake.test.mjs, .claude/harness/tests/review-policy.test.mjs |
| draft-constraints › change-start | happy | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-constraints › change-start-2 | edge | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-constraints › change-start-inspect | failure | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-constraints › change-start-inspect-2 | happy | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-constraints › change-start-inspect-3 | failure | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-fixes-link › change-start-draft-fixes-a | happy | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-fixes-link › change-start-inspect-draft-fixes-zzz | failure | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| draft-fixes-link › change-start | edge | T004, T008 | .claude/harness/tests/semantic-draft.test.mjs |
| outcomes-rollup › outcomes | happy | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| outcomes-rollup › outcomes-2 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| outcomes-rollup › outcomes-3 | happy | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| outcomes-rollup › outcomes-4 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| outcomes-rollup › outcomes-5 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| outcomes-rollup › outcomes-6 | failure | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| lessons-rollup › lessons | happy | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| lessons-rollup › lessons-2 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| lessons-rollup › lessons-3 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| lessons-rollup › lessons-4 | edge | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| lessons-rollup › lessons-5 | failure | T006, T008 | .claude/harness/tests/outcomes-lessons.test.mjs, .claude/harness/tests/command-registry.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/run-all.sh, .claude/tests/harness/affected-suite-selector.mjs |
| review-finding-code › harness-review-attempt | happy | T005 | .claude/harness/tests/review-repair-attempt.test.mjs |
| review-finding-code › harness-review-attempt-2 | failure | T005 | .claude/harness/tests/review-repair-attempt.test.mjs |
| review-finding-code › harness-review-attempt-3 | edge | T005 | .claude/harness/tests/review-repair-attempt.test.mjs |
| hypothesis-next-check › investigate | happy | T007, T008 | .claude/harness/tests/investigation-runtime.test.mjs |
| hypothesis-next-check › investigate-2 | edge | T007, T008 | .claude/harness/tests/investigation-runtime.test.mjs |
| hypothesis-next-check › investigate-3 | failure | T007, T008 | .claude/harness/tests/investigation-runtime.test.mjs |
| hypothesis-next-check › investigate-4 | failure | T007, T008 | .claude/harness/tests/investigation-runtime.test.mjs |

## Definition of done

- Fresh evidence for every claim (43).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: จำนวน gate ใหม่ที่คืนทางตัน = 0 และ rollup แสดงค่า unknown เป็น null ไม่ใช่ 0.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Non-goals

- ไม่เพิ่ม role persona agents หรือ coordinator ที่ harness เรียก model เอง
- ไม่สร้างไฟล์ brief/plan/decisions/handoff แยกจาก packet และ tasks.md
- ไม่ผูก evidence กับ commit; identity ยังผูกกับ content
- ไม่ hard-stop เมื่อ budget หมด; คง auto-extend และ budget-no-progress เดิม
- lessons ไม่สร้าง check หรือแก้ config ของ consumer เอง; เป็นข้อเสนอที่ต้องผ่าน /change ปกติ
- ไม่ backfill code ให้ review finding เก่า และไม่เดา escaped defect ด้วย heuristic

## Derived by harness

- **Failure matrix:** read from the failure scenarios (16); recovery is "No separate step; the outcome is the handling" where unstated.

## Investigation handoff

- **ID:** pstack-workflow-gaps
- **Outcome:** ready-for-change
- **Summary:** Change Loop ครอบแนวคิด pstack ส่วนใหญ่แล้ว (risk-not-size, task contract, fact/hypothesis, evidence-bound gates, recovery ladder). Gap จริง: lessons→checks (ไม่มี), cross-change metrics, performance evidence contract, financial riskSignal, allow+deny pairing. ไม่ควรนำ role persona agents, artifact brief/plan/handoff แยก, evidence ผูก commit หรือ budget hard-stop เพราะขัดหลักเดิม. ผู้ใช้เลือกนำทั้ง 4 กลุ่มเข้า Change โดยห้าม block agent/user

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| core-principle@1 | การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; non-goal: ไม่เพิ่ม role persona agents หรือ coordinator ที่ harness เรียก model เอง |
| risk-not-size@1 | จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง | requirement: financial-risk-signal; requirement: financial-review-tier |
| status-bound-evidence@1 | สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent | requirement: benchmark-base-head-comparison; non-goal: ไม่ผูก evidence กับ commit; identity ยังผูกกับ content |
| lean-checks@1 | เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact | design: lessons-threshold; non-goal: ไม่สร้างไฟล์ brief/plan/decisions/handoff แยกจาก packet และ tasks.md |
| priority-order@1 | ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics | สมมติฐานที่ไม่กระทบข้อตกลง |
| scope-all-gaps@1 | นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; requirement: financial-risk-signal; requirement: lessons-rollup; requirement: outcomes-rollup; requirement: hypothesis-next-check; requirement: draft-constraints |
| never-block@1 | ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate) | scenario: benchmark-base-head-comparison / base ใช้ไม่ได้ไม่ block; design: finding-code-lenient; non-goal: lessons ไม่สร้าง check หรือแก้ config ของ consumer เอง; เป็นข้อเสนอที่ต้องผ่าน /change ปกติ; non-goal: ไม่ hard-stop เมื่อ budget หมด; คง auto-extend และ budget-no-progress เดิม |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

## Appendix: discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | covered | benchmark-base-head-comparison, outcomes-rollup, lessons-rollup |  | REPAIR ระบุ finding และตัวเลข; outcomes/lessons รายงาน skipped และ uncoded พร้อม reason |
| recoverability | covered | benchmark-base-head-comparison, access-control-allow-deny, hypothesis-next-check |  | ทุก failure scenario มี recovery เป็น EDIT/REPAIR ที่ agent ทำต่อได้ หรือไม่ block (base unavailable, finding code ผิดรูปแบบ) |
| current-behavior | covered (derived) |  |  | Derived from currentState |
| affected-actor | covered (derived) | 10: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, financial-review-tier, outcomes-rollup, draft-fixes-link, … +4 more |  | Derived from userStories |
| desired-behavior | covered (derived) | 10: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, financial-review-tier, draft-constraints, draft-fixes-link, … +4 more |  | Derived from requirements |
| success-path | covered (derived) | 10: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, financial-review-tier, draft-constraints, draft-fixes-link, … +4 more |  | Derived from requirements[].scenarios kind:success |
| failure-path | covered (derived) | 9: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, draft-constraints, draft-fixes-link, outcomes-rollup, … +3 more |  | Derived from requirements[].scenarios kind:failure |
| input-boundary | covered (derived) | 10: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, financial-review-tier, draft-constraints, draft-fixes-link, … +4 more |  | Derived from requirements[].scenarios kind:boundary |
| compatibility | covered (derived) |  |  | Derived from compatibility |
| non-goals | covered (derived) |  |  | Derived from nonGoals |
| verification | covered (derived) | 10: benchmark-base-head-comparison, access-control-allow-deny, financial-risk-signal, financial-review-tier, draft-constraints, draft-fixes-link, … +4 more |  | Derived from tasks[].verify, evidence |

## Appendix: investigation provenance

- **Change intent:** ปิด gap จากแนวคิด pstack ภายในหลักเดิมของ Change Loop โดยไม่สร้างทางตัน: (1) evidence gates: performance provider ที่ receipt เทียบ base vs head ภายใต้ environment เดียวกันหลายรอบ, access-control claim ต้องมีทั้ง allow และ deny path, riskSignal financial map ไป timeout-retry-idempotency/recoverability และ review high; gate ใหม่ต้องคืน REPAIR ที่ระบุ finding และทางทำต่อ; (2) lessons → checks: rollup finding/blocker codes ที่เกิดซ้ำข้าม archived changes เป็นข้อเสนอ check ถาวรแบบ advisory ที่ส่งผ่าน Change ปกติ ไม่สร้าง state คู่ขนาน; (3) cross-change metrics: read-only rollup first-proof pass rate, repair/amend count, decision count, cost per archived change, escaped defects; unknown ไม่รายงานเป็นศูนย์; (4) investigate record ให้ hypothesis อ้าง experiment ที่พิสูจน์ได้ และ change draft มี field constraints. ไม่รวม: role persona agents, artifact brief/plan/handoff แยก, evidence ผูก commit, budget hard-stop
- **State:** .foundation/investigations/pstack-workflow-gaps.json @ e6fb8fd1ef0aea0e946cf81bd0d16bfbef892549059e075115c0a7e666faa53a
- **Sources:** sha256:832595b10c9e36ef09a5d077f7c9c22047a806de294b801e5c948426a82af19e
## บริบทที่รับจาก Investigate

เป้าหมาย: ปรับ Change Loop ตามแนวคิด pstack: เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ

ผลลัพธ์ที่ต้องการ: gap analysis ต่อข้อเสนอแต่ละข้อเทียบ source ปัจจุบัน พร้อมลำดับปรับที่แนะนำ เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- routing
- task contract
- investigation output
- design contract
- agent roles
- handoff artifacts
- quality gates
- stuck handling
- lessons to checks
- metrics
- maintainer
- consumer agent
- human owner

### ข้อกำหนดและประวัติการแก้ไข

- **core-principle@1** [constraint / stated / user]: การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว
- **risk-not-size@1** [constraint / stated / user]: จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง
- **status-bound-evidence@1** [constraint / stated / user]: สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent
- **lean-checks@1** [constraint / stated / user]: เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact
- **priority-order@1** [example / stated / user]: ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics
- **gap-analysis@1** [success-criterion / superseded / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; เป็นงานวิเคราะห์ที่ agent ทำได้เอง ไม่ใช่ความหมายที่ต้องให้ผู้ใช้ยืนยัน; → gap-analysis@2
- **gap-analysis@2** [success-criterion / proposed / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด
- **scope-all-gaps@1** [behavior / stated / user]: นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft
- **never-block@1** [constraint / stated / user]: ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate)

### คำถามและการตัดสินใจ

- q-scope [answered]: เลือก gap ที่จะนำเข้า Change (หนึ่งหรือหลายข้อ) → ทั้งหมด 4 กลุ่ม โดยต้องอยู่ในหลักคิดเดิมและห้าม block agent/user

### สาระจากบทสนทนา

- u1 [user]: imporce follow สิ่งที่ควรนำจาก pstack ไปปรับ Workflow คือ เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ ... (ข้อเสนอ 10 ข้อ และลำดับเริ่มปรับ 6 ข้อ) (session message /investigate)
- u2 [user]: เลือกทั้งหมด: Evidence gates, Lessons → checks, Cross-change metrics, Small record/draft fixes. เพิ่มได้ทั้งนั้นแหละ แต่ต้องอยู่ในหลักคิด ห้าม block agent or user ทุกงานต้องมีทางออกจนถึงงานเสร็จ (AskUserQuestion answer (scope))

### ช่องว่างของประวัติ

- ไม่มี source ของ pstack เอง; ข้อเสนอเป็นสรุปของผู้ใช้ ไม่ได้ตรวจกับ repo pstack ต้นฉบับ



## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| core-principle@1 | การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; non-goal: ไม่เพิ่ม role persona agents หรือ coordinator ที่ harness เรียก model เอง |
| risk-not-size@1 | จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง | requirement: financial-risk-signal; requirement: financial-review-tier |
| status-bound-evidence@1 | สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent | requirement: benchmark-base-head-comparison; non-goal: ไม่ผูก evidence กับ commit; identity ยังผูกกับ content |
| lean-checks@1 | เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact | design: lessons-threshold; non-goal: ไม่สร้างไฟล์ brief/plan/decisions/handoff แยกจาก packet และ tasks.md |
| priority-order@1 | ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics | สมมติฐานที่ไม่กระทบข้อตกลง |
| scope-all-gaps@1 | นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; requirement: financial-risk-signal; requirement: lessons-rollup; requirement: outcomes-rollup; requirement: hypothesis-next-check; requirement: draft-constraints |
| never-block@1 | ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate) | scenario: benchmark-base-head-comparison / base ใช้ไม่ได้ไม่ block; design: finding-code-lenient; non-goal: lessons ไม่สร้าง check หรือแก้ config ของ consumer เอง; เป็นข้อเสนอที่ต้องผ่าน /change ปกติ; non-goal: ไม่ hard-stop เมื่อ budget หมด; คง auto-extend และ budget-no-progress เดิม |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: ปรับ Change Loop ตามแนวคิด pstack: เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ

ผลลัพธ์ที่ต้องการ: gap analysis ต่อข้อเสนอแต่ละข้อเทียบ source ปัจจุบัน พร้อมลำดับปรับที่แนะนำ เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- routing
- task contract
- investigation output
- design contract
- agent roles
- handoff artifacts
- quality gates
- stuck handling
- lessons to checks
- metrics
- maintainer
- consumer agent
- human owner

### ข้อกำหนดและประวัติการแก้ไข

- **core-principle@1** [constraint / stated / user]: การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว
- **risk-not-size@1** [constraint / stated / user]: จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง
- **status-bound-evidence@1** [constraint / stated / user]: สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent
- **lean-checks@1** [constraint / stated / user]: เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact
- **priority-order@1** [example / stated / user]: ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics
- **gap-analysis@1** [success-criterion / superseded / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; เป็นงานวิเคราะห์ที่ agent ทำได้เอง ไม่ใช่ความหมายที่ต้องให้ผู้ใช้ยืนยัน; → gap-analysis@2
- **gap-analysis@2** [success-criterion / proposed / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด
- **scope-all-gaps@1** [behavior / stated / user]: นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft
- **never-block@1** [constraint / stated / user]: ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate)

### คำถามและการตัดสินใจ

- q-scope [answered]: เลือก gap ที่จะนำเข้า Change (หนึ่งหรือหลายข้อ) → ทั้งหมด 4 กลุ่ม โดยต้องอยู่ในหลักคิดเดิมและห้าม block agent/user

### สาระจากบทสนทนา

- u1 [user]: imporce follow สิ่งที่ควรนำจาก pstack ไปปรับ Workflow คือ เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ ... (ข้อเสนอ 10 ข้อ และลำดับเริ่มปรับ 6 ข้อ) (session message /investigate)
- u2 [user]: เลือกทั้งหมด: Evidence gates, Lessons → checks, Cross-change metrics, Small record/draft fixes. เพิ่มได้ทั้งนั้นแหละ แต่ต้องอยู่ในหลักคิด ห้าม block agent or user ทุกงานต้องมีทางออกจนถึงงานเสร็จ (AskUserQuestion answer (scope))

### ช่องว่างของประวัติ

- ไม่มี source ของ pstack เอง; ข้อเสนอเป็นสรุปของผู้ใช้ ไม่ได้ตรวจกับ repo pstack ต้นฉบับ


## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| core-principle@1 | การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; non-goal: ไม่เพิ่ม role persona agents หรือ coordinator ที่ harness เรียก model เอง |
| risk-not-size@1 | จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง | requirement: financial-risk-signal; requirement: financial-review-tier |
| status-bound-evidence@1 | สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent | requirement: benchmark-base-head-comparison; non-goal: ไม่ผูก evidence กับ commit; identity ยังผูกกับ content |
| lean-checks@1 | เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact | design: lessons-threshold; non-goal: ไม่สร้างไฟล์ brief/plan/decisions/handoff แยกจาก packet และ tasks.md |
| priority-order@1 | ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics | สมมติฐานที่ไม่กระทบข้อตกลง |
| scope-all-gaps@1 | นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; requirement: financial-risk-signal; requirement: lessons-rollup; requirement: outcomes-rollup; requirement: hypothesis-next-check; requirement: draft-constraints |
| never-block@1 | ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate) | scenario: benchmark-base-head-comparison / base ใช้ไม่ได้ไม่ block; design: finding-code-lenient; non-goal: lessons ไม่สร้าง check หรือแก้ config ของ consumer เอง; เป็นข้อเสนอที่ต้องผ่าน /change ปกติ; non-goal: ไม่ hard-stop เมื่อ budget หมด; คง auto-extend และ budget-no-progress เดิม |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: ปรับ Change Loop ตามแนวคิด pstack: เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ

ผลลัพธ์ที่ต้องการ: gap analysis ต่อข้อเสนอแต่ละข้อเทียบ source ปัจจุบัน พร้อมลำดับปรับที่แนะนำ เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- routing
- task contract
- investigation output
- design contract
- agent roles
- handoff artifacts
- quality gates
- stuck handling
- lessons to checks
- metrics
- maintainer
- consumer agent
- human owner

### ข้อกำหนดและประวัติการแก้ไข

- **core-principle@1** [constraint / stated / user]: การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว
- **risk-not-size@1** [constraint / stated / user]: จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง
- **status-bound-evidence@1** [constraint / stated / user]: สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent
- **lean-checks@1** [constraint / stated / user]: เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact
- **priority-order@1** [example / stated / user]: ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics
- **gap-analysis@1** [success-criterion / superseded / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; เป็นงานวิเคราะห์ที่ agent ทำได้เอง ไม่ใช่ความหมายที่ต้องให้ผู้ใช้ยืนยัน; → gap-analysis@2
- **gap-analysis@2** [success-criterion / proposed / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด
- **scope-all-gaps@1** [behavior / stated / user]: นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft
- **never-block@1** [constraint / stated / user]: ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate)

### คำถามและการตัดสินใจ

- q-scope [answered]: เลือก gap ที่จะนำเข้า Change (หนึ่งหรือหลายข้อ) → ทั้งหมด 4 กลุ่ม โดยต้องอยู่ในหลักคิดเดิมและห้าม block agent/user

### สาระจากบทสนทนา

- u1 [user]: imporce follow สิ่งที่ควรนำจาก pstack ไปปรับ Workflow คือ เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ ... (ข้อเสนอ 10 ข้อ และลำดับเริ่มปรับ 6 ข้อ) (session message /investigate)
- u2 [user]: เลือกทั้งหมด: Evidence gates, Lessons → checks, Cross-change metrics, Small record/draft fixes. เพิ่มได้ทั้งนั้นแหละ แต่ต้องอยู่ในหลักคิด ห้าม block agent or user ทุกงานต้องมีทางออกจนถึงงานเสร็จ (AskUserQuestion answer (scope))

### ช่องว่างของประวัติ

- ไม่มี source ของ pstack เอง; ข้อเสนอเป็นสรุปของผู้ใช้ ไม่ได้ตรวจกับ repo pstack ต้นฉบับ


## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| core-principle@1 | การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; non-goal: ไม่เพิ่ม role persona agents หรือ coordinator ที่ harness เรียก model เอง |
| risk-not-size@1 | จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง | requirement: financial-risk-signal; requirement: financial-review-tier |
| status-bound-evidence@1 | สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent | requirement: benchmark-base-head-comparison; non-goal: ไม่ผูก evidence กับ commit; identity ยังผูกกับ content |
| lean-checks@1 | เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact | design: lessons-threshold; non-goal: ไม่สร้างไฟล์ brief/plan/decisions/handoff แยกจาก packet และ tasks.md |
| priority-order@1 | ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics | สมมติฐานที่ไม่กระทบข้อตกลง |
| scope-all-gaps@1 | นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft | requirement: benchmark-base-head-comparison; requirement: access-control-allow-deny; requirement: financial-risk-signal; requirement: lessons-rollup; requirement: outcomes-rollup; requirement: hypothesis-next-check; requirement: draft-constraints |
| never-block@1 | ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate) | scenario: benchmark-base-head-comparison / base ใช้ไม่ได้ไม่ block; design: finding-code-lenient; non-goal: lessons ไม่สร้าง check หรือแก้ config ของ consumer เอง; เป็นข้อเสนอที่ต้องผ่าน /change ปกติ; non-goal: ไม่ hard-stop เมื่อ budget หมด; คง auto-extend และ budget-no-progress เดิม |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: ปรับ Change Loop ตามแนวคิด pstack: เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ

ผลลัพธ์ที่ต้องการ: gap analysis ต่อข้อเสนอแต่ละข้อเทียบ source ปัจจุบัน พร้อมลำดับปรับที่แนะนำ เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- routing
- task contract
- investigation output
- design contract
- agent roles
- handoff artifacts
- quality gates
- stuck handling
- lessons to checks
- metrics
- maintainer
- consumer agent
- human owner

### ข้อกำหนดและประวัติการแก้ไข

- **core-principle@1** [constraint / stated / user]: การปรับต้องเน้นเงื่อนไขเลือกขั้นตอน เกณฑ์ผ่าน และหลักฐานส่งมอบ ไม่ใช่เพิ่มรายชื่อ agent หรือ prompt ยาว
- **risk-not-size@1** [constraint / stated / user]: จำนวนไฟล์ที่เปลี่ยนไม่ใช่ตัวแทนความเสี่ยง
- **status-bound-evidence@1** [constraint / stated / user]: สถานะผ่านต้องผูกกับ evidence ไม่ใช่คำบอกของ agent
- **lean-checks@1** [constraint / stated / user]: เพิ่ม check จากปัญหาจริงเท่านั้น ไม่เพิ่มจน workflow ช้า; งานเล็กไม่ต้องสร้างหลาย artifact
- **priority-order@1** [example / stated / user]: ลำดับที่เสนอ: 1 task contract+AC, 2 evidence+gate, 3 routing, 4 handoff artifact, 5 multi-agent เฉพาะจุด, 6 metrics
- **gap-analysis@1** [success-criterion / superseded / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด; เป็นงานวิเคราะห์ที่ agent ทำได้เอง ไม่ใช่ความหมายที่ต้องให้ผู้ใช้ยืนยัน; → gap-analysis@2
- **gap-analysis@2** [success-criterion / proposed / agent]: ระบุต่อข้อว่ามีแล้ว/บางส่วน/ขาด พร้อมอ้าง source และ gap ที่ชัด
- **scope-all-gaps@1** [behavior / stated / user]: นำเข้า Change ทั้ง 4 กลุ่ม: (1) evidence gates = performance receipt เทียบ base vs head ภายใต้เงื่อนไขเดียวกัน, access-control ต้องมี allow และ deny, riskSignal financial → idempotency/recoverability/review-high; (2) lessons → checks จาก finding/blocker ที่เกิดซ้ำข้าม archived changes เสนอเป็น check ถาวรผ่าน Change ปกติ; (3) cross-change metrics rollup แบบ read-only; (4) hypothesis→experiment link ใน investigate record และ field constraints ใน change draft
- **never-block@1** [constraint / stated / user]: ทุกส่วนที่เพิ่มต้องอยู่ในหลักคิดเดิมของ Change Loop และห้าม block agent หรือ user; ทุกงานต้องมีทางออกจนงานเสร็จ (gate ใหม่ต้องคืน REPAIR/route ที่ทำต่อได้ ไม่ใช่ทางตัน; lessons/metrics เป็น advisory ไม่ใช่ gate)

### คำถามและการตัดสินใจ

- q-scope [answered]: เลือก gap ที่จะนำเข้า Change (หนึ่งหรือหลายข้อ) → ทั้งหมด 4 กลุ่ม โดยต้องอยู่ในหลักคิดเดิมและห้าม block agent/user

### สาระจากบทสนทนา

- u1 [user]: imporce follow สิ่งที่ควรนำจาก pstack ไปปรับ Workflow คือ เงื่อนไขเลือกขั้นตอน + เกณฑ์ผ่านแต่ละขั้น + หลักฐานส่งมอบ ... (ข้อเสนอ 10 ข้อ และลำดับเริ่มปรับ 6 ข้อ) (session message /investigate)
- u2 [user]: เลือกทั้งหมด: Evidence gates, Lessons → checks, Cross-change metrics, Small record/draft fixes. เพิ่มได้ทั้งนั้นแหละ แต่ต้องอยู่ในหลักคิด ห้าม block agent or user ทุกงานต้องมีทางออกจนถึงงานเสร็จ (AskUserQuestion answer (scope))

### ช่องว่างของประวัติ

- ไม่มี source ของ pstack เอง; ข้อเสนอเป็นสรุปของผู้ใช้ ไม่ได้ตรวจกับ repo pstack ต้นฉบับ
