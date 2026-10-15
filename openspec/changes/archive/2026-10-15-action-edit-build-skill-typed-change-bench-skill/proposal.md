# Change: ให้ action EDIT ของ Build ระบุ skill ที่ต้องโหลดจากข้อมูล typed ของ change และให้ bench วัดว่า skill ถูกโหลดจริง

- **Change:** `action-edit-build-skill-typed-change-bench-skill` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

paid e2e 24 runs หลังเพิ่มขั้นตอนจาก pstack ลงใน skill พบว่าไม่มี run ใดเรียก skill ด้านเทคนิคหรืออ่าน reference ใหม่เลย ทั้งที่ host มองเห็น skill ทั้งหมด agent ทำตาม command และ action ของ harness จนจบโดยไม่โหลด skill ที่ router ใน fundamentals.md ระบุ และข้ามไฟล์ใน contextFiles ด้วย เนื้อหา skill จึงไม่มีผลกับงานจริงและวัดไม่ได้ ผู้ใช้เลือกให้ action EDIT มีคำสั่งโหลด skill ตามชื่อ ซึ่ง agent ทำตาม instructions ของ advance อยู่แล้ว

## User stories

- **P1** As consumer agent, I want Build บอกชื่อ skill ที่ต้องโหลดสำหรับงานนี้ so that ใช้ขั้นตอนที่ตรวจได้ใน skill แทนการเดา. Requirements: edit-action-skills.
- **P1** As maintainer, I want bench บันทึกว่า skill ใดถูกโหลดและ reference ใดถูกอ่าน so that วัดได้ว่า skill ถูกใช้และช่วยจริง. Requirements: bench-skill-usage.

## Success criteria

- advance-runtime tests ครอบทุกแถวของ mapping, กรณีไม่มี skill, cap 4 และยืนยันว่าข้อความ intent ไม่เปลี่ยนผล
- bench tests ยืนยัน skillUsage จาก stream และ null เมื่อไม่มี stream
- paid e2e หลัง Land แสดง skillToolCalls มากกว่า 0 ใน scenario ที่ mapping ตรง

## Scope

- **In scope (`build-skill-routing`):** agent ได้รายชื่อ skill ไม่เกิน 4 ตัวพร้อมคำสั่ง Before implementing, load these skills by name ก่อนแก้ task; maintainer เห็นว่า run ใดโหลด skill ใดและอ่าน reference ใด หรือเห็นว่าวัดไม่ได้เมื่อไม่มี stream
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/skill-routing.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/skill-routing.test.mjs`, `.claude/tests/run-all.sh`, … +8 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| edit-action-skills › advance-edit | happy | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-2 | happy | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-3 | happy | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-4 | edge | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-5 | edge | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-6 | edge | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| edit-action-skills › advance-edit-bugfix | failure | T001 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/skill-routing.test.mjs, .claude/tests/run-all.sh, .claude/tests/affected-suite-selector.mjs |
| bench-skill-usage › runner-scorecard | happy | T002 | .claude/tests/bench/openspec-native/run.mjs, .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/config/openspec-native-scorecard.schema.json, .claude/tests/bench/tests/openspec-native-runner.test.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs |
| bench-skill-usage › runner-scorecard-2 | edge | T002 | .claude/tests/bench/openspec-native/run.mjs, .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/config/openspec-native-scorecard.schema.json, .claude/tests/bench/tests/openspec-native-runner.test.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs |
| bench-skill-usage › validate-schema | edge | T002 | .claude/tests/bench/openspec-native/run.mjs, .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/config/openspec-native-scorecard.schema.json, .claude/tests/bench/tests/openspec-native-runner.test.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs |

## Definition of done

- Fresh evidence for every claim (10).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: จำนวน run ที่โหลด skill ที่ action ระบุ / จำนวน run ที่ action ระบุ skill.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Constraints

- เลือก skill จาก workType, riskSignals, securityTriggers และ task kind เท่านั้น ไม่อ่าน prose
- ไม่เกิน 4 skill ต่อ action เรียงตามลำดับคงที่ และใส่เฉพาะ skill ที่มี SKILL.md อยู่จริงในโปรเจกต์
- คำสั่งเป็นกลางต่อ host: โหลด skill ตามชื่อ ไม่อ้างชื่อ tool ของ host ใด
- ไม่แก้ AGENT.md, build.md, build-policy.md หรือ /dev bundle และไม่เปลี่ยน advanceProtocol

## Non-goals

- ไม่ใส่ skill ลงใน task packet ของ parallel worker หรือ EDIT ของ proof preflight ใน change นี้
- ไม่อ่าน requirement prose หรือ intent เพื่อเลือก skill
- ไม่บังคับหรือตรวจว่า agent โหลด skill จริงใน runtime; การวัดอยู่ใน bench

## Derived by harness

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
