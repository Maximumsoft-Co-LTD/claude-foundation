# Change: แก้จุดที่ทำให้ Prove และ Land ติดหรือขัดกันก่อน release

- **Change:** `prove-land-release` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-16

## เหตุผล

ระหว่างใช้ Change Loop ทำหลาย change ต่อกัน ผู้ใช้ต้องอนุมัติและให้ verdict ซ้ำหลายรอบ และ agent ต้อง commit ระหว่าง Land เพื่อทำต่อ audit ยืนยันกับโค้ดว่ามีบั๊ก ข้อขัดแย้งกับเอกสาร และทางตันที่ทำให้ Prove และ Land ติด change นี้แก้ทั้งหมดก่อน release

## ขอบเขต

- sandbox ของ change ใหม่มีงานที่ Land แล้วแต่ยังไม่ commit
- verdict ของคนคงอยู่เมื่อ base ขยับแต่ส่วนของ change ไม่เปลี่ยน
- AI review ที่ครบแล้วได้ ASK_USER ที่มีทางต่อ
- authority record รายงานทุกปัญหาพร้อมกัน และ template ของ delta ใช้ได้ตามที่ให้มา
- task ที่ติ๊กไม่ได้บอกเหตุผล
- แก้ config ของ provider ไม่ต้องอนุมัติ spec ใหม่
- ข้อความของ Land ไม่ชี้ไปที่คำสั่งที่ไม่มี และเอกสารบอกว่า Prove รันเฉพาะ verify ของ task

- **In scope:** sandbox ของ change ใหม่มีงานที่ Land แล้วแต่ยังไม่ commit; verdict ของคนคงอยู่เมื่อ base ขยับแต่ส่วนของ change ไม่เปลี่ยน; AI review ที่ครบแล้วคืน ASK_USER ที่มีทางต่อชัดเจน; authority record รายงานทุกปัญหาพร้อมกันและ template ของ delta บันทึกได้; task ที่ติ๊กไม่ได้เพราะไม่มีการเปลี่ยนใน path บอกเหตุผลและทางต่อ; แก้ config ของ provider โดยไม่ต้องอนุมัติ spec ใหม่; ข้อความของ Land ที่เจอทางตันระบุคำสั่งที่มีอยู่จริง
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/runtime/core/state-runtime.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/sandbox-create-phases.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs`, … +21 more

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| sandbox | carry-landed-work | T001 |
| review-authority | human-verdict-rebind, review-exhausted-decision, authority-record-issues | T002, T003, T004 |
| change | amended-task-tick | T005 |
| change-validation | provider-config-approval | T006 |
| land | land-dead-end-route | T007 |

## ผลกระทบและความเสี่ยง

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## วิธีตรวจด้วยตัวเอง

- Land change หนึ่งโดยไม่ commit แล้วเริ่ม change ถัดไป ดูว่า sandbox มีไฟล์ของ change แรก
- รัน paid checkpoint 23 lane หลัง Land แล้วดูว่าไม่มีการขออนุมัติซ้ำโดยไม่จำเป็น

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| carry-landed-work | change ที่ต่อกัน | success | T001 | test: `.claude/harness/tests/sandbox-create-phases.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs` | — |
|  | ไฟล์ที่ผู้ใช้แก้เองไม่ถูกนำเข้า | boundary | T001 |  |  |
|  | Land ของ B ไม่ทับงาน A | boundary | T001 |  |  |
| human-verdict-rebind | upstream แก้ไฟล์อื่น | success | T002 | test: `.claude/harness/tests/receipt-validity.test.mjs` | — |
|  | upstream แก้ไฟล์ของ change | failure | T002 |  |  |
| review-exhausted-decision | AI review ครบ | success | T003 | test: `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/authority-request-operation.test.mjs` | — |
|  | AI เพิ่มหนึ่งครั้ง | success | T003 |  |  |
|  | ไม่มี reviewer | boundary | T003 |  |  |
| authority-record-issues | template ของ delta ใช้ได้ | success | T004 | test: `.claude/harness/tests/authority-response-validation.test.mjs`, `.claude/harness/tests/authority-request-operation.test.mjs` | — |
|  | request ยังไม่ dispatch | boundary | T004 |  |  |
|  | หลายปัญหาพร้อมกัน | failure | T004 |  |  |
| amended-task-tick | task ที่โค้ดอยู่นอก path | failure | T005 | test: `.claude/harness/tests/task-change.test.mjs` | — |
| provider-config-approval | แก้ timeoutMs | success | T006 | test: `.claude/harness/tests/user-decisions.test.mjs` | — |
|  | ถอด provider | failure | T006 |  |  |
|  | แก้ claim | failure | T006 |  |  |
| land-dead-end-route | dependency ไม่แยก | failure | T007 | test: `.claude/harness/tests/land-check-phases.test.mjs` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (16).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered |  | .claude/harness/runtime/workflow/sandbox-runtime.mjs, .claude/harness/runtime/core/user-decisions.mjs, .claude/harness/runtime/workflow/land-runtime.mjs | audit ยืนยันกับโค้ด: preexistingDirty และ createSingle, receipt rebind เฉพาะ AI, WAIT ที่ไม่แยก exhausted, record ที่ตรวจเป็นลำดับ, agreementIdentity ที่ hash execution.yaml, ข้อความ recreate the sandbox |
| affected-actor | covered |  | WORKFLOW.md | ผู้ใช้ที่ต้องอนุมัติและให้ verdict ซ้ำ และ agent ที่ต้อง commit ระหว่าง Land |
| compatibility | covered |  | .claude/harness/runtime/core/user-decisions.mjs | change ที่ไม่มีงานค้างจาก change อื่นทำงานเหมือนเดิม และ approval ที่บันทึกไว้แล้วยังใช้ได้ |
| non-goals | covered |  | .claude/harness/EVIDENCE.md | ไม่เพิ่มการ waive review ไม่รวม test ทั้ง project เข้า Prove และไม่ลด evidence ของ provider |
| operability | covered |  | .claude/harness/commands.json | ทุกทางตันระบุทางต่อที่มีอยู่จริง และ sandbox รายงาน path ที่นำเข้า |
| recoverability | covered |  | .claude/harness/runtime/evidence/receipt-validity.mjs | การนำงานเข้า sandbox อ่านจาก target โดยไม่เขียน target และ review receipt ที่ rebind ไม่ได้ยังเปิด request ใหม่เหมือนเดิม |

Harness derive จากเนื้อหา draft (5): desired-behavior, success-path, failure-path, input-boundary, verification.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (6); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1: The read-only-dependency stop sends the agent to `claude-foundation doctor --stage land --change <id>`. `doctor` only accepts --stage change\|build\|prove: commands.json:22 lists that usage, WORKFLOW.md:1703 documents it, and diagnostics-runtime.mjs:188-189 fails any other stage with "doctor --stage must be change\|build\|prove". So the route does not exist in commands.json and does not match WORKFLOW.md, which is what land-dead-end-route requires; the agent still reaches a dead end, just a different one. The test at land-check-phases.test.mjs:297-300 only checks the text with a regex, so it passes on an invalid command. Point the stop at a supported route (for example `doctor --stage prove --change <id>` or the sandbox sync/recreate command the docs name), and assert in the test that the named command parses. (root/.claude/harness/runtime/workflow/land-runtime.mjs:588) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2: authorityResponsePreflightIssues runs before authorityStore.validateResponse for every review response (line 2045). Its comment says the later checks stay the authority, but it refuses responses those checks accept. (a) It requires a string `evidence.subject-actor`, yet authority responses may carry provenance only as `subject-provenance` (authority.mjs:7 normalizes it; subjectProvenanceOperation in review-protocol.mjs:30-33 prefers it). That is the only form legacySubjectProvenance allows for several implementers (review-protocol.mjs:16-17), so those changes can no longer record any review verdict. (b) The subject, reference and count checks also apply to `status: "error"` responses. recordAuthorityUnlocked previously closed those through recordAuthorityInfrastructureError (line 2067) without receipt provenance or reference validation. (c) It requires verified-findings to equal verifiedFindingIds.length whenever verified-findings is present. validateReviewScopeCounts (receipt-runtime.mjs:868-874) only enforces that when finding rows or IDs are supplied, or the scope is delta, so a previously valid full-review response is now refused. Limit the subject check to the absence of both subject-actor and subject-provenance, skip the provenance and reference checks for status error, and gate the count check the same way the receipt validator does. (root/.claude/harness/runtime/workflow/authority-runtime.mjs:348) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F3: The open-landed-merge diagnosis hardcodes `repository: "root"` for every conflict path. Conflicts recorded for a nested repository would be reported under the wrong repository. (root/.claude/harness/runtime/evidence/proof-execution-runtime.mjs:505) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1: The preflight count check still differs from validateReviewScopeCounts (receipt-runtime.mjs:868-874) in two small ways. (1) A non-empty evidence `scope-path` also turns the check on, but the receipt validator ignores scope-path unless the resolved scope mode is `delta`. A full-dispatch or legacy response that echoes scope-path, has no finding rows, and has a verified-findings count that does not match is now refused, though the receipt would accept it. (2) The preflight compares against the raw `verifiedIds.length`, while the validator removes duplicates and empty entries first. So `verifiedFindingIds: ["F1","F1"]` with verified-findings 1 is refused here but accepted later. To match exactly, drop the scope-path criterion and use the trimmed, de-duplicated ID count, as the closure check a few lines below already does. (root/.claude/harness/runtime/workflow/authority-runtime.mjs:381) | minor | ยังเปิดอยู่ | claude-opus |
