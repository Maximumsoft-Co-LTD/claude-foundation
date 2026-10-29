# Change: Harness bookkeeping never voids user authority or amendments

- **Change:** `harness-bookkeeping-never-voids-user-authority-or-amendments` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-28

## เหตุผล

วันนี้ harness ใช้ตัวนับ `contractRevision` ตัวเดียวแทน "ข้อตกลงเปลี่ยน" แต่ขยับมันจากทั้ง amendment จริงและ bookkeeping ที่ harness แนะนำเอง (reopen grounding, validate, sandbox sync, authority grant) ขณะที่ spec approval, waiver, Decision Sheet, extend-review และ task lease ถูกเช็คกับตัวนับนั้นแบบเท่ากันพอดี ผลคือทุกขั้นที่ harness บอกให้ทำทำให้สิทธิ์เดิมตาย user ถูกถามซ้ำ และ amendment ที่บันทึกไว้ถูก restore ทับจน Prove วนลูป (incident hpx-control-plane 27-28 ต.ค. 2026 วน 2 รอบ) การเปลี่ยนนี้ผูกสิทธิ์ทุกชนิดกับเนื้อหาข้อตกลงแทนตัวนับ ตัด budget ออกจาก fingerprint และถือ amendment ที่ harness บันทึกเองว่าถูกต้องเสมอ

## ขอบเขต

สิ่งที่เปลี่ยน:

- contractFingerprint ไม่รวม grantedAiWaveCap หรือ budget อื่น
- approve-spec และ assertSpecApproval ไม่ restore sandbox ทับ packet ที่ตรงกับ amendment ล่าสุด
- spec approval, approval lane, waiver, Decision Sheet revision, task lease, approval package ตรวจด้วย identity/fingerprint; contractRevision เหลือเป็น audit
- reopen-grounding ที่ไม่เปลี่ยนเนื้อหา carry spec approval พร้อม audit row
- restore notice ระบุไฟล์ที่ถูกทับและ path สำเนา

ไม่ทำ:

- การรัน verify ของแต่ละ task ใน repo ของมันตอน Prove (ข้อ A ในรายงาน) เป็น change แยก
- ไม่เปลี่ยน schema ของ packet, protocol.json หรือ CLI surface
- ไม่ migrate runtime state เดิม; field ใหม่เป็น optional และ state 3.6.8 อ่านได้ตามเดิม

- **In scope (`authority-continuity`):** การให้สิทธิ์ extend-review ไม่ทำให้ receipt, plan, หรือ review closure มองว่าข้อตกลงเปลี่ยน; approve-spec และ assertSpecApproval ไม่ restore sandbox ทับ amendment แม้ contractRevision ขยับไปแล้วหลัง amend; ขั้นตอน bookkeeping ที่ harness แนะนำเอง (reopen grounding, validate, sandbox sync, authority grant) ไม่ทำให้สิทธิ์ที่ user ให้ไว้หมดอายุเมื่อเนื้อหาข้อตกลงเท่าเดิม; agent และ user เห็นว่าอะไรถูกทับและกู้จากที่ไหน
- **Out of scope:** edits outside `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/runtime/evidence/review-attempt-store.mjs`, `.claude/harness/tests/authority-fingerprint.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs`, … +20 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## สิ่งที่ต้องตัดสินใจและคำถามที่ยังเปิด

- **bind-authority-to-content:** สิทธิ์ของ user ทุกชนิดผูกกับ agreement identity และ contractFingerprint (เนื้อหาข้อตกลง) ส่วน contractRevision เหลือเป็นตัวนับ audit ไม่ใช่เงื่อนไข gate — แก้ที่ต้นเหตุจุดเดียวแทนการอุดทีละ gate; ทางเลือกที่ตัดคือแยก counter เป็นสองตัว (agreementRevision/bookkeepingRevision) ซึ่งต้อง migrate state และยังเสี่ยง bump ผิดตัวในอนาคต. ผลที่ตามมา: gate ทุกจุดต้องคำนวณ identity/fingerprint แทนอ่านตัวนับ (ช้าขึ้นเล็กน้อย); การเปลี่ยนเนื้อหาข้อตกลงยังขอสิทธิ์ใหม่เหมือนเดิม; contractRevision ยังถูกเขียนเพื่อ audit และ state เก่าอ่านได้

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| budget-outside-fingerprint | grant หลัง final AI delta แล้วรัน wave ได้ | success | T001, T005 | test: `.claude/harness/tests/authority-fingerprint.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | grant ไม่ทำให้ receipt provider อื่น stale | boundary | T001, T005 |  |  |
|  | ข้อตกลงเปลี่ยนจริงยังถูกจับได้ | failure | T001, T005 |  |  |
| amendment-survives-approval | amend แล้ว reopen grounding แล้ว approve | success | T002, T005 | test: `.claude/harness/tests/amendment-approval-survival.test.mjs`, `.claude/harness/tests/user-decisions.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | amendment หลายรอบคงรอบล่าสุด | boundary | T002, T005 |  |  |
|  | แก้ packet นอก amendment ยังถูก restore | failure | T002, T005 |  |  |
| authority-binds-to-content | reopen grounding คง spec approval | success | T003, T005 | test: `.claude/harness/tests/authority-continuity.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/change-resolution.test.mjs`, `.claude/harness/tests/review-closure-helpers.test.mjs`, `.claude/tests/run-all.sh` | bind-authority-to-content |
|  | reopen grounding คง waiver และ lease | success | T003, T005 |  |  |
|  | approval lane ตาม identity | success | T003, T005 |  |  |
|  | state เดิมที่ไม่มี field ใหม่ | boundary | T003, T005 |  |  |
|  | เนื้อหาเปลี่ยนยังต้องขอใหม่ | failure | T003, T005 |  |  |
| restore-names-files | notice ระบุไฟล์ | success | T004 | test: `.claude/harness/tests/user-decisions.test.mjs` | — |
|  | ไม่มีไฟล์ต่างกัน | boundary | T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (13).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | authority-binds-to-content, amendment-survives-approval, budget-outside-fingerprint |  |  |
| compatibility | covered | authority-binds-to-content |  |  |
| non-goals | covered | authority-binds-to-content |  |  |
| input-boundary | not-applicable |  |  | ไม่มีค่าจากภายนอกโปรแกรม; input คือ runtime state ที่ harness เขียนเอง |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F-whitespace-amended: When an amendment snapshot exists, `!source && repairWhitespaceDrift(...)` skips the in-place whitespace repair. `change-lifecycle.mjs` skips it the same way via `amendedSource \|\| !repairWhitespaceDrift(...)`. A whitespace-only formatter pass over an amended sandbox packet therefore gets a full restore, a drift copy and a 'restored' notice, which is the opposite of scenario restore-names-files-harness-drift. The result is still correct and nothing is lost. The restored files and copy only add noise. No test covers whitespace drift on an amended packet. (root/.claude/harness/runtime/core/user-decisions.mjs:149) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F-sync-carry: `updateSandboxSyncState` bumps `contractRevision` and moves only `specApproval.revision`. It does not call `carryApprovalAcrossBookkeeping`, so revision-bound waivers and `draftSource.contractRevision` still expire after a sync that leaves the packet bytes unchanged. Consent, lanes and leases are identity or fingerprint based and survive. The listed scenarios cover only the reopen-grounding path, so this does not violate any named scenario. (root/.claude/harness/runtime/workflow/sandbox-runtime.mjs:2347) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F-upgrade-fingerprint: Receipts recorded under the old runtime after a user grant embedded `grantedAiWaveCap` in their contract fingerprint. After this change the fingerprint omits it, so those in-flight receipts will read as stale once. Fresh grants are unaffected. This is a one-time upgrade cost and no compatibility test covers it. (root/.claude/harness/runtime/evidence/evidence-contract.mjs:239) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F-dispatch-untested: The test asserts that the closure route is AUTO_REPAIR and not CONTRACT_DECISION_REQUIRED. It does not assert that the granted wave is actually dispatched by advance, which is the last THEN clause of the first scenario. (root/.claude/harness/tests/authority-fingerprint.test.mjs:70) | minor | ยังเปิดอยู่ | claude-opus |
