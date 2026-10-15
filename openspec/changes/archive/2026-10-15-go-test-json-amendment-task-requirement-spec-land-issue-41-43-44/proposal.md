# Change: นับผล go test -json เป็นหลักฐานเทสต์, ให้ amendment เพิ่ม task ให้ requirement เดิมได้ และไม่ทิ้งบรรทัดว่างท้าย spec หลัง Land (issue #41, #43, #44)

- **Change:** `go-test-json-amendment-task-requirement-spec-land-issue-41-43-44` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

provider ที่รัน go test -json ได้ผลว่าไม่มีจำนวนเทสต์ จึงต้องใช้ TAP shim (#41). amendment ที่ต้องการเพิ่ม task ตรวจให้ requirement เดิมถูกปฏิเสธเพราะต้องมี requirement change และข้อความปฏิเสธเรื่อง task ที่เสร็จแล้วไม่บอกว่าใช้สถานะจากไหน (#43, ผู้ใช้ตัดสินให้อนุญาต addTasks ที่ covers requirement เดิม). openspec archive ทิ้งบรรทัดว่างท้าย spec ที่ merge ทำให้ git diff --check fail หลัง Land (#44)

## Capabilities

| Capability | Requirements | Tasks |
|---|---|---|
| evidence-quality | go test -json results are counted test evidence | T001, T004 |
| change | Amendments add tasks for existing requirements, Completed-task refusals name the state they used | T002, T004 |
| land | Landed specs end with one newline | T003 |

## Scope

- **In scope:** provider test-discovery ที่รัน go test -json ได้จำนวนเทสต์โดยไม่ต้องใช้ TAP shim; เพิ่ม task ตรวจให้ requirement เดิมได้และ claim ที่ task ใหม่ครอบถูก invalidate; agent รู้ว่าสถานะ task มาจากไหนและใช้ addTasks หรือ reopen ได้ถูก; git diff --check ผ่านหลัง Land
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/evidence-results.mjs`, `.claude/harness/runtime/evidence/adapter-runtime.mjs`, `.claude/harness/tests/evidence-results.test.mjs`, `.claude/harness/runtime/workflow/semantic-amendment.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/runtime/workflow/apply-runtime.mjs`, … +4 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| go-test-json-count › parse-auto | happy | T001, T004 | .claude/harness/tests/evidence-results.test.mjs |
| go-test-json-count › parse | edge | T001, T004 | .claude/harness/tests/evidence-results.test.mjs |
| go-test-json-count › parse-2 | failure | T001, T004 | .claude/harness/tests/evidence-results.test.mjs |
| go-test-json-count › parse-3 | failure | T001, T004 | .claude/harness/tests/evidence-results.test.mjs |
| go-test-json-count › parse-4 | edge | T001, T004 | .claude/harness/tests/evidence-results.test.mjs |
| amend-add-task-existing-requirement › amend-addtasks-key-covers-r1 | happy | T002, T004 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-add-task-existing-requirement › addtasks-covers-r-missing | failure | T002, T004 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-add-task-existing-requirement › addtasks-covers | failure | T002, T004 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-refusal-names-task-state › updatetasks-verify-t001-reopen | failure | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-refusal-names-task-state › updatetasks-verify-reopen | failure | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| land-spec-single-trailing-newline › land-archive | happy | T003 | .claude/harness/tests/apply-runtime-archive.test.mjs |
| land-spec-single-trailing-newline › land | edge | T003 | .claude/harness/tests/apply-runtime-archive.test.mjs |
| land-spec-single-trailing-newline › resume-land | edge | T003 | .claude/harness/tests/apply-runtime-archive.test.mjs |

## Definition of done

- Fresh evidence for every claim (13).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Non-goals

- ไม่แก้ #42 (advance ซ้อนกัน) ใน change นี้ เพราะยังไม่ได้ repro
- ไม่ normalize spec เดิมใน openspec/specs ที่ไม่ได้ถูก change นี้เขียน
- ไม่เปลี่ยน OpenSpec CLI
- ไม่อนุญาต addTasks ที่ไม่มี covers หรือ covers requirement ที่ไม่มีอยู่

## Derived by harness

- **Failure matrix:** read from the failure scenarios (6); recovery is "No separate step; the outcome is the handling" where unstated.
