# Change: Session lease stale after amend is discarded, not a deadlock

- **Change:** `session-lease-stale-after-amend-is-discarded-not-a-deadlock` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

run paid lifecycle บ่าย 29 ต.ค. บนรุ่น e0b0f0985 หยุดก่อน Prove: advance ออก session lease ให้ task sdk แล้ว amend reopen task backend ที่ sdk รอ จากนั้น backend ชน resource ที่ lease ของ sdk ถือ (WAIT) ขณะ sdk ถูก block โดย backend (REPAIR) วน 27 คำสั่งจน no-progress ทั้งที่ code และ test ของทุก repo ผ่าน settle ปล่อยเฉพาะ lease ของ task ที่ผ่าน check จึงไม่ปล่อย lease ที่ authority stale แล้ว การเปลี่ยนนี้ให้ settle discard session lease ที่ graph หรือ contract เปลี่ยนไป เพื่อให้ dispatch ออก lease ใหม่ตาม graph ปัจจุบัน

## ขอบเขต

สิ่งที่เปลี่ยน:

- settle ใน session-lease discard session lease ที่ leaseAuthorityIsStale ต่อ plan ปัจจุบัน ก่อน dispatch
- test และ docs

ไม่ทำ:

- ไม่แตะ lease ของ agent ภายนอก (owner ไม่ใช่ session) ซึ่งยังได้ข้อความ stale เดิม
- ไม่เปลี่ยนกติกา resource conflict ระหว่าง change

- **In scope (`graph-execution`):** amend ที่ reopen task ไม่ทิ้ง lease ค้างให้ task อื่นชน และ advance dispatch ตาม graph ปัจจุบันได้
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/session-lease.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/session-lease.test.mjs`, `WORKFLOW.md`, `CHANGELOG.md`

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| stale-session-lease-discarded | lease stale หลัง amend ถูก discard | success | T001, T002 | test: `.claude/harness/tests/session-lease.test.mjs` | — |
|  | deadlock หลัง reopen หายไป | success | T001, T002 |  |  |
|  | lease ที่ยังตรง plan ไม่ถูกแตะ | boundary | T001, T002 |  |  |
|  | lease ของ agent ภายนอกไม่ถูก discard | failure | T001, T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | stale-session-lease-discarded |  |  |
| compatibility | covered | stale-session-lease-discarded |  |  |
| non-goals | covered | stale-session-lease-discarded |  |  |
| input-boundary | not-applicable |  |  | input คือ lease state ที่ harness เขียนเอง |

## Amendment discovery coverage

Reason: AI review พบว่า discard ทิ้ง baselineSurface ของ lease ทำให้ write ที่เกิดก่อน amend ไม่ถูกรายงานตอน release ขัดกับ contract เดิม จึงเปลี่ยนเป็น park (ปล่อย resource แต่เก็บ index + baseline) สำหรับ task ที่รอ dependency และ renew in place สำหรับ task ที่รันได้

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | stale-session-lease-discarded | none | none |
| compatibility | covered | stale-session-lease-discarded | none | none |
| non-goals | covered | stale-session-lease-discarded | none | none |
| input-boundary | not-applicable | none | none | input คือ lease state ที่ harness เขียนเอง |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-29): AI review พบว่า discard ทิ้ง baselineSurface ของ lease ทำให้ write ที่เกิดก่อน amend ไม่ถูกรายงานตอน release ขัดกับ contract เดิม จึงเปลี่ยนเป็น park (ปล่อย resource แต่เก็บ index + baseline) สำหรับ task ที่รอ dependency และ renew in place สำหรับ task ที่รันได้

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1: settle discards every stale session lease before completeByCheck/release, including a lease whose task the agent already implemented (or ticked) before an amendment changed the contract fingerprint or graph. discard (lease-runtime.mjs:482-493) deletes the task lease index, including its baselineSurface. The previous path went through release, which renews a stale lease via acquire with ownPrior and keeps prior.baselineSurface (lease-runtime.mjs:195-196, 451-462). After the discard, the re-issued lease, or reverify's acquire-then-release for a self-ticked task, takes a fresh baseline from observedTaskSurface that already includes the pre-amendment writes. Out-of-scope writes made before the amendment are then never reported. This contradicts WORKFLOW.md:1064-1067 ('keeps its original write baseline, so earlier writes are still judged against the widened scope') and leaves the settle comment at session-lease.mjs:146 ('Release itself renews authority a moved graph made stale') dead for session leases. The existing guard test (session-lease.test.mjs:435-452) does not catch this: realLeases builds the runtime without agentPlanValue, and the test re-issues before settle, which is not the advance order (advance-runtime.mjs:1478 settles first). A narrower fix: discard only a stale lease whose task is not complete (or whose task now depends on a reopened dependency), and route complete ones through the renewing release. Also add a realLeases-based test with agentPlanValue wired that amends between issue and settle and asserts the pre-amend out-of-scope write is still reported. (root/.claude/harness/runtime/workflow/session-lease.mjs:160) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2: The deadlock scenario (T002 dependsOn T001, a session lease on T002 still held, an amendment reopens T001, then advance --through build dispatches T001 with no same-change WAIT lease-resource) is exercised only by code ordering (advance-runtime.mjs:1478-1479 settles before dispatch). No advance-runtime test was added, although design.md lists advance-runtime.test.mjs as the check for this scenario. (root/.claude/harness/tests/session-lease.test.mjs:735) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | F3: The stale branch runs `!completeByCheck(id, lease.taskId)` before blockedByPending. Take T002 with a stale session lease that dependsOn the reopened T001, where the agent already implemented T002 before the amendment, so T002's verify passes. Step 1: completeByCheck runs T002's check and ticks T002 in tasks.md. The branch is skipped, and line 181-182 calls releaseOwned. Step 2: release (lease-runtime.mjs:453-459) sees stale authority. T002 is still in plan.tasks: a ticked task holding a lease is reset to done:false by recoverCompletedTasksForExecution (agent-planning.mjs:428-446 via task-execution-authority.mjs:162). Step 3: release therefore calls acquire, and leaseAcquisitionRequest fails with `task 'T002' is blocked by pending task(s): T001` (lease-runtime.mjs:95-98). Step 4: releaseOwned rethrows the non-scope error (session-lease.mjs:248) and settle aborts inside advance's capture (advance-runtime.mjs:1479). The stale T002 lease keeps its resources and the shared workspace key, T002 stays ticked while its dependency is reopened, and every later advance repeats the same failure. That is the deadlock this change exists to remove, now surfaced as a repeating error. It contradicts the spec scenario 'lease stale ของ task ที่รอ dependency ถูก park', which says resources are released, the index is parked, and settle does not count T002 as done. Round 1 handled this input by discarding before completeByCheck, so this repair reintroduced it. The new settle test misses it because its runtime has no runCheck and no ledger, so completeByCheck is always false. Fix: when the plan is present and the lease is stale, check blockedByPending first. Park a blocked lease without running or ticking its check. Run completeByCheck, then release or renew, only for non-blocked stale leases. Add a settle test with a runCheck that passes for the blocked stale task, and assert park is called, the ledger stays unticked, and release is not called. (root/.claude/harness/runtime/workflow/session-lease.mjs:174) | major | ยืนยันการแก้ในรอบ 3 | claude-opus |
| 2 | F4: The new test's leading comment still says settle 'discards it', but the behavior under test (and the assertions) is park-or-renew. Update the comment to match. (root/.claude/harness/tests/session-lease.test.mjs:733) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | F5: design.md still describes the old behavior. It says 'settle discard session lease…' (line 13), its failure table talks about discard (line 19), and its test map scenarios say stale leases are discarded (lines 48-49). The spec and code now park a blocked stale lease and renew a runnable one. The file map (lines 23-41) also leaves out .claude/harness/runtime/workflow/lease-runtime.mjs, where park/includeParked live. Update the wording and the file map so they match the park-or-renew design. (contract/design.md:13) | minor | ยังเปิดอยู่ | claude-opus |
