# Change: ปลดทางตันของ change ที่ code อยู่ใน repository เดียว (submodule) ใน Prove, amend, waive และ recovery ตาม issue #39 และ #40

- **Change:** `change-code-repository-submodule-prove-amend-waive-recovery-issu` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-14 · **Status:** `claude-foundation changes`

## Why

ปัจจุบัน provider ที่ harness derive จาก task verify ไม่ผูก repository จึงรันที่ control sandbox ที่ไม่มีไฟล์ของ repository ทำให้ Prove fail ทั้งที่เทสต์จริงผ่าน และ amend ยังเพิ่ม provider ซ้ำที่ไม่ผูก repository. ทางหนีด้วย waive ทำให้ proof ไม่มี receipt แล้ว advance วน REPAIR, ส่วน ASK_USER repair-no-progress ของ proof gate บันทึกคำตอบไม่ได้. ผู้ได้ประโยชน์คือ agent และ maintainer ของ consumer ที่ใช้ submodule: change ที่ทดสอบผ่านจริงต้อง land ได้โดยไม่ต้องเริ่มใหม่

## User stories

- **P1** As consumer agent ใน repository แบบ submodule, I want Prove รัน task verify ใน repository เดียวกับตอน Build ทั้งก่อนและหลัง amend so that change ที่เทสต์ผ่านจริงพิสูจน์และ land ได้. Requirements: derived-provider-repository, amend-reuses-capability-provider, amend-ambiguous-provider-fails.
- **P1** As ผู้ใช้ที่ต้องตอบ decision, I want คำตอบ ASK_USER จาก proof gate ถูกบันทึกและใช้ต่อได้ so that ไม่ต้องสร้าง amendment ปลอมเพื่อหนี boundary. Requirements: proof-gate-decision-answerable.
- **P2** As ผู้ใช้ที่ waive gate, I want ถูกปฏิเสธพร้อมเหตุผลทันทีเมื่อ waive จะทำให้ไม่เหลือหลักฐาน so that ไม่ติด REPAIR วนที่ไม่มี finding. Requirements: waive-keeps-executed-evidence, finalize-refuses-empty-proof.
- **P2** As consumer agent, I want ข้อความ recovery ชี้คำสั่งที่รองรับ so that ไม่ต้องแก้ไฟล์ receipt ด้วยมือ. Requirements: review-infra-recovery-names-reset, requested-review-wait-diagnostic, amend-reports-invalidated-waivers.

## Success criteria

- สถานการณ์ใน #40 (amend เพิ่ม task test ใน repository เดียว) ได้ provider test เดียวที่ผูก repository และ Prove รัน verify ใน repository sandbox
- waive ที่ทำให้ไม่เหลือ required provider ถูกปฏิเสธ 100% พร้อมข้อความที่บอกสาเหตุ
- advance --decision ตอบ repair-no-progress ของ proof gate ได้และรอบถัดไปคืน REPAIR แทน ASK_USER เดิม
- full registered suite ผ่าน

## Capabilities

| Capability | Requirements | Tasks |
|---|---|---|
| change | Derived providers run where their tasks run, Amendments reuse the provider that serves a capability, Ambiguous capability providers stop an amendment, Amendments report waivers they invalidate | T001, T002, T005, T006 |
| prove | A waiver cannot leave proof without evidence, Proof never finalizes without receipts, Proof no-progress decisions are answered through advance, Exhausted review infrastructure names its supported reset, A review no reviewer can start says so | T003, T004, T005, T006 |

## Scope

- **In scope:** Prove รัน verify ที่ derive ใน repository sandbox เดียวกับที่ Build ใช้; หลัง amend ที่เพิ่ม claim test มี provider test เพียงตัวเดิมที่ผูก repository; amend ไม่เดา provider และบอกให้แก้ execution providers ของ change; waive ที่จะทำให้ proof ไม่มี receipt ถูกปฏิเสธพร้อมสาเหตุและทางเลือก; สถานะ proof และ audit สอดคล้องกัน และ advance บอกสาเหตุที่แก้ได้; ผู้ใช้ตอบได้ครั้งเดียว และการตอบที่ไม่ใช่ pause ทำให้รอบถัดไปคืนงานซ่อมแทนคำถามเดิม; agent รู้คำสั่งที่รองรับหลังซ่อม reviewer โดยไม่ต้องแก้ไฟล์ request; agent แยกได้ระหว่างรอ reviewer ที่กำลังทำงานกับไม่มี reviewer เลย; ผู้ใช้รู้ทันทีว่าต้องบันทึก waiver ใหม่หรือไม่
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/runtime/workflow/semantic-amendment.mjs`, `.claude/harness/runtime/workflow/change-validation.mjs`, `.claude/harness/runtime/evidence/proof-runtime.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, … +14 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| derived-provider-repository › compile-draft | happy | T001, T006 | .claude/harness/tests/semantic-draft.test.mjs |
| derived-provider-repository › compile-draft-2 | edge | T001, T006 | .claude/harness/tests/semantic-draft.test.mjs |
| derived-provider-repository › compile-draft-3 | edge | T001, T006 | .claude/harness/tests/semantic-draft.test.mjs |
| derived-provider-repository › compile-draft-4 | edge | T001, T006 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-reuses-capability-provider › amend-requirement-evidence-test | happy | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-reuses-capability-provider › amend-claim-test-repository-svc | edge | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-reuses-capability-provider › amend-task | edge | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| amend-ambiguous-provider-fails | failure | T002 | .claude/harness/tests/semantic-draft.test.mjs |
| waive-keeps-executed-evidence › change-waive-capability-test | failure | T003, T006 | .claude/harness/tests/waive-gate.test.mjs, .claude/harness/tests/proof-finalize.test.mjs |
| waive-keeps-executed-evidence › change-waive-capability-review | happy | T003, T006 | .claude/harness/tests/waive-gate.test.mjs, .claude/harness/tests/proof-finalize.test.mjs |
| finalize-refuses-empty-proof › proof-finalize | failure | T003 | .claude/harness/tests/waive-gate.test.mjs, .claude/harness/tests/proof-finalize.test.mjs |
| finalize-refuses-empty-proof › proof-finalize-2 | happy | T003 | .claude/harness/tests/waive-gate.test.mjs, .claude/harness/tests/proof-finalize.test.mjs |
| proof-gate-decision-answerable › advance-decision | happy | T004, T006 | .claude/harness/tests/advance-recovery.test.mjs |
| proof-gate-decision-answerable › advance-decision-change-strategy | happy | T004, T006 | .claude/harness/tests/advance-recovery.test.mjs |
| proof-gate-decision-answerable › advance-decision-pause | edge | T004, T006 | .claude/harness/tests/advance-recovery.test.mjs |
| proof-gate-decision-answerable › advance-decision-2 | edge | T004, T006 | .claude/harness/tests/advance-recovery.test.mjs |
| proof-gate-decision-answerable › advance-decision-fingerprint | failure | T004, T006 | .claude/harness/tests/advance-recovery.test.mjs |
| review-infra-recovery-names-reset | failure | T005 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/amendment-invalidation.test.mjs |
| requested-review-wait-diagnostic | failure | T005 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/amendment-invalidation.test.mjs |
| amend-reports-invalidated-waivers › amend-revision-3 | failure | T005 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/amendment-invalidation.test.mjs |
| amend-reports-invalidated-waivers › amend | edge | T005 | .claude/harness/tests/advance-runtime.test.mjs, .claude/harness/tests/amendment-invalidation.test.mjs |

## Definition of done

- Fresh evidence for every claim (21).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Non-goals

- change ที่ task ครอบหลาย repository และใช้ provider ที่ derive คงพฤติกรรมเดิม (provider เดียวที่ control root); ไม่แตก provider ตาม repository
- ไม่เพิ่ม parser ของ go test -json
- ไม่เพิ่ม lock ของ advance และไม่เปลี่ยน no-progress fingerprint (#39-5 ยังไม่ได้ repro)
- ไม่อนุญาต addTasks ที่ไม่มี requirement
- ไม่เปลี่ยนความหมายของ waive: ยังคงถอนทั้ง capability
- ไม่เพิ่ม timeout อัตโนมัติให้ review ที่ค้าง requested

## Derived by harness

- **Failure matrix:** read from the failure scenarios (7); recovery is "No separate step; the outcome is the handling" where unstated.

## Investigation handoff

- **ID:** issues-39-40
- **Outcome:** ready-for-change
- **Summary:** ทั้ง #39 และ #40 ส่วนใหญ่เป็นจริงและยังไม่ถูกแก้ (PoC 6/6 ยืนยัน). Root cause หลักคือ provider ที่ derive (ทั้งตอน start และ amend) ไม่มี repository จึงรัน task verify ที่ control root. ทางตันมีสองจุด: (1) D1+D3 amend แล้ว Prove fail และ waive ทำให้ receipts ว่าง, (2) #39-4 ASK_USER repair-no-progress จาก proof gate บันทึกคำตอบไม่ได้. #39-3/#39-7 มีทางออกแต่ข้อความไม่บอก. ข้อ minor เรื่อง stdout ไม่จริง (ไป stderr). #39-5 ยังไม่ได้ repro. ผู้ใช้ตัดสินแล้ว: waive คงถอนทั้ง capability แต่ finalize/waive ปฏิเสธเมื่อไม่เหลือ receipt; amend ที่มีหลาย provider ต่อ capability ให้ fail พร้อมคำแนะนำ

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| verify-claims@1 | ตรวจแต่ละ claim ของ #39/#40 กับ source ว่าจริงหรือไม่ | requirement: derived-provider-repository; requirement: amend-reuses-capability-provider; requirement: finalize-refuses-empty-proof; requirement: proof-gate-decision-answerable |
| state-fixed@1 | ระบุว่าแก้แล้วหรือยัง พร้อมเหตุผล | design: waive-semantics; design: multi-repo-derive-unchanged |
| benefit-tradeoff@1 | อธิบายว่าแก้แล้วดีขึ้นอย่างไรและ trade-off คืออะไร | design: waive-semantics; design: amend-ambiguity; design: gate-decision-options |
| solution-poc@1 | มี solution และ PoC ที่ใช้ยืนยันก่อนส่งเข้า Change | requirement: amend-ambiguous-provider-fails; requirement: waive-keeps-executed-evidence; requirement: review-infra-recovery-names-reset; requirement: requested-review-wait-diagnostic; requirement: amend-reports-invalidated-waivers |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

## Appendix: discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | covered | review-infra-recovery-names-reset, requested-review-wait-diagnostic, amend-reports-invalidated-waivers, finalize-refuses-empty-proof |  | ข้อความ REPAIR, WAIT และ AMENDED ระบุสาเหตุและคำสั่งที่รองรับ (requirements review-infra-recovery-names-reset, requested-review-wait-diagnostic, amend-reports-invalidated-waivers, finalize-refuses-empty-proof) |
| recoverability | covered | proof-gate-decision-answerable, waive-keeps-executed-evidence, amend-ambiguous-provider-fails |  | ทุก failure scenario มี recovery; decision ของ proof gate ตอบได้และ pause คงหลักฐาน; waive ที่ถูกปฏิเสธไม่บันทึก state |
| current-behavior | covered (derived) |  |  | Derived from currentState |
| affected-actor | covered (derived) | 9: derived-provider-repository, amend-reuses-capability-provider, amend-ambiguous-provider-fails, proof-gate-decision-answerable, waive-keeps-executed-evidence, finalize-refuses-empty-proof, … +3 more |  | Derived from userStories |
| desired-behavior | covered (derived) | 9: derived-provider-repository, amend-reuses-capability-provider, amend-ambiguous-provider-fails, waive-keeps-executed-evidence, finalize-refuses-empty-proof, proof-gate-decision-answerable, … +3 more |  | Derived from requirements |
| success-path | covered (derived) | derived-provider-repository, amend-reuses-capability-provider, waive-keeps-executed-evidence, finalize-refuses-empty-proof, proof-gate-decision-answerable |  | Derived from requirements[].scenarios kind:success |
| failure-path | covered (derived) | 7: amend-ambiguous-provider-fails, waive-keeps-executed-evidence, finalize-refuses-empty-proof, proof-gate-decision-answerable, review-infra-recovery-names-reset, requested-review-wait-diagnostic, … +1 more |  | Derived from requirements[].scenarios kind:failure |
| input-boundary | covered (derived) | derived-provider-repository, amend-reuses-capability-provider, proof-gate-decision-answerable, amend-reports-invalidated-waivers |  | Derived from requirements[].scenarios kind:boundary |
| compatibility | covered (derived) |  |  | Derived from compatibility |
| non-goals | covered (derived) |  |  | Derived from nonGoals |
| verification | covered (derived) | 9: derived-provider-repository, amend-reuses-capability-provider, amend-ambiguous-provider-fails, waive-keeps-executed-evidence, finalize-refuses-empty-proof, proof-gate-decision-answerable, … +3 more |  | Derived from tasks[].verify, evidence |

## Appendix: investigation provenance

- **Change intent:** ปลดทางตันของ repository-scoped change (#39/#40): (1) provider ที่ derive ตอน start/amend ต้องรัน task verify ใน repository ของ task; amend ต้อง reuse provider เดิมที่ให้บริการ capability เดียวกัน และ fail พร้อมคำแนะนำเมื่อมีหลาย provider ที่กำกวม; (2) finalize/waive ต้องปฏิเสธพร้อมบอกสาเหตุเมื่อไม่เหลือ receipt ที่รันจริง (คงความหมาย waive = ถอนทั้ง capability) และ REPAIR ต้องระบุ finding เช่น missing-receipt-manifest; (3) ASK_USER repair-no-progress จาก proof gate ต้องตอบผ่าน advance --decision ได้; (4) ข้อความ recovery ชี้ authority reset-infra สำหรับ review infra ที่หมด, review requested ที่ไม่เริ่มต้องมี diagnostic, และ change amend ต้องรายงาน waiver ที่หลุด. ไม่รวม: parser go test -json, lock ของ advance (#39-5 ยังไม่ repro), addTasks ที่ไม่มี requirement
- **State:** .foundation/investigations/issues-39-40.json @ b0695a1010bcb796f1c61fac05bfe612f4fa6166b9831ef66603f50d772fd3fb
- **Sources:** sha256:578befe47bdad01f86ca7fe9ba44e1a284002684ba40d298c1cfae2e820dcb73
## บริบทที่รับจาก Investigate

เป้าหมาย: ตรวจว่า #39 และ #40 เป็นจริงกับ source ปัจจุบัน และว่าแก้ไปแล้วหรือไม่

ผลลัพธ์ที่ต้องการ: ได้ solution พร้อม PoC และ trade-off เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- amend provider derivation
- Prove cwd
- waive vs proof manifest
- review/ASK\_USER recovery text
- maintainer
- consumer agent

### ข้อกำหนดและประวัติการแก้ไข

- **verify-claims@1** [success-criterion / stated / user]: ตรวจแต่ละ claim ของ #39/#40 กับ source ว่าจริงหรือไม่
- **state-fixed@1** [success-criterion / stated / user]: ระบุว่าแก้แล้วหรือยัง พร้อมเหตุผล
- **benefit-tradeoff@1** [success-criterion / stated / user]: อธิบายว่าแก้แล้วดีขึ้นอย่างไรและ trade-off คืออะไร
- **solution-poc@1** [success-criterion / stated / user]: มี solution และ PoC ที่ใช้ยืนยันก่อนส่งเข้า Change

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- poc-d1-amend-provider [complete]: amend ใน change ที่มี provider test ผูก repository สร้าง provider test ที่ไม่มี repository จริงหรือไม่ และการ reuse provider เดิมตาม capability แก้ได้หรือไม่; criteria: compileSemanticAmendment คืน providers ที่มี key test โดยไม่มี repository / prototype merge ที่ reuse capability เดิมเหลือเฉพาะ test-svc; findings: รัน node --test: 3 pass. Repro ยืนยันบั๊ก (providers = test-svc + test ที่ไม่มี repository) / Prototype A เหลือ test-svc เท่านั้น / provider ที่ derive ไม่มี field capability จึงต้องใช้ name-as-capability fallback แบบ providerCapability; limitations: ทดสอบที่ระดับ compileSemanticAmendment ไม่ใช่ end-to-end Prove ใน sandbox submodule / D3 (waive -\> missing-receipt-manifest) และ #39-1 ที่ start-time derive ยังไม่ได้ repro อ่านจากโค้ดเท่านั้น / prototype ไม่ใช่ proof; refs: solution-poc@1
- poc-round2 [complete]: #39-4 ตอบ decision ของ proof gate ได้ไหม, #39-1 provider ที่ derive ตอน start มี repository ไหม, #40 D3 waive test ทำให้ required providers ว่างไหม; criteria: observe ไม่บันทึก pending และ resolve throw / derived provider ไม่มี repository / requiredProviders ว่างหลัง waive test; findings: รัน node --test: 3 pass / #39-4: decision repair-no-progress จาก proof gate ไม่มี fingerprint และไม่มีคำสั่งต่อตัวเลือก, pending เป็น null, advance --decision ล้มด้วย stale or absent; next ชี้ packet --phase build / #39-1: normalizeSemanticDraft ที่ task ผูก repository svc ได้ provider test ที่ไม่มี repository / #40 D3: ก่อน waive required = discovery, test, test-svc; หลัง waive test เหลือ \[\] รวม test-svc ที่ปกติดีและ discovery; limitations: ทดสอบที่ระดับฟังก์ชันด้วย context จำลอง ไม่ใช่ advance/Prove end-to-end / #39-4 จำลอง envelope ตาม advance-runtime.mjs:455-469 ไม่ได้รันผ่าน advance จริง; refs: solution-poc@1

### สาระจากบทสนทนา

- u1 [user]: 39 40 ดูทีว่า เป็นจริงไหม แก้ไขยังเพราะอะไร แก้แล้วดีขึ้นยังไง tradeoff คืออะไร (session message /investigate 39 40)
- u2 [user]: ได้ solution และ poc ครบหรือยัง (session message)
- u3 [user]: ทำตามที่เสนอเลย (session message)
- u4 [user]: ตามนี้ (D3 = reject-empty-receipts, A = fail-with-guidance) (session message)

### ช่องว่างของประวัติ

- เนื้อหา run artifacts ใต้ .foundation/ ของโปรเจกต์ผู้รายงานไม่มีให้ตรวจ
- ความเชื่อมโยงเชิงสาเหตุของ #39-5 (REPAIR จากหลักฐานเก่าถูกนับเป็น no-progress) ยังไม่ได้ repro



## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| verify-claims@1 | ตรวจแต่ละ claim ของ #39/#40 กับ source ว่าจริงหรือไม่ | requirement: derived-provider-repository; requirement: amend-reuses-capability-provider; requirement: finalize-refuses-empty-proof; requirement: proof-gate-decision-answerable |
| state-fixed@1 | ระบุว่าแก้แล้วหรือยัง พร้อมเหตุผล | design: waive-semantics; design: multi-repo-derive-unchanged |
| benefit-tradeoff@1 | อธิบายว่าแก้แล้วดีขึ้นอย่างไรและ trade-off คืออะไร | design: waive-semantics; design: amend-ambiguity; design: gate-decision-options |
| solution-poc@1 | มี solution และ PoC ที่ใช้ยืนยันก่อนส่งเข้า Change | requirement: amend-ambiguous-provider-fails; requirement: waive-keeps-executed-evidence; requirement: review-infra-recovery-names-reset; requirement: requested-review-wait-diagnostic; requirement: amend-reports-invalidated-waivers |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: ตรวจว่า #39 และ #40 เป็นจริงกับ source ปัจจุบัน และว่าแก้ไปแล้วหรือไม่

ผลลัพธ์ที่ต้องการ: ได้ solution พร้อม PoC และ trade-off เพื่อส่งต่อเป็น Change


### ขอบเขตและผู้เกี่ยวข้อง

- amend provider derivation
- Prove cwd
- waive vs proof manifest
- review/ASK\_USER recovery text
- maintainer
- consumer agent

### ข้อกำหนดและประวัติการแก้ไข

- **verify-claims@1** [success-criterion / stated / user]: ตรวจแต่ละ claim ของ #39/#40 กับ source ว่าจริงหรือไม่
- **state-fixed@1** [success-criterion / stated / user]: ระบุว่าแก้แล้วหรือยัง พร้อมเหตุผล
- **benefit-tradeoff@1** [success-criterion / stated / user]: อธิบายว่าแก้แล้วดีขึ้นอย่างไรและ trade-off คืออะไร
- **solution-poc@1** [success-criterion / stated / user]: มี solution และ PoC ที่ใช้ยืนยันก่อนส่งเข้า Change

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- poc-d1-amend-provider [complete]: amend ใน change ที่มี provider test ผูก repository สร้าง provider test ที่ไม่มี repository จริงหรือไม่ และการ reuse provider เดิมตาม capability แก้ได้หรือไม่; criteria: compileSemanticAmendment คืน providers ที่มี key test โดยไม่มี repository / prototype merge ที่ reuse capability เดิมเหลือเฉพาะ test-svc; findings: รัน node --test: 3 pass. Repro ยืนยันบั๊ก (providers = test-svc + test ที่ไม่มี repository) / Prototype A เหลือ test-svc เท่านั้น / provider ที่ derive ไม่มี field capability จึงต้องใช้ name-as-capability fallback แบบ providerCapability; limitations: ทดสอบที่ระดับ compileSemanticAmendment ไม่ใช่ end-to-end Prove ใน sandbox submodule / D3 (waive -\> missing-receipt-manifest) และ #39-1 ที่ start-time derive ยังไม่ได้ repro อ่านจากโค้ดเท่านั้น / prototype ไม่ใช่ proof; refs: solution-poc@1
- poc-round2 [complete]: #39-4 ตอบ decision ของ proof gate ได้ไหม, #39-1 provider ที่ derive ตอน start มี repository ไหม, #40 D3 waive test ทำให้ required providers ว่างไหม; criteria: observe ไม่บันทึก pending และ resolve throw / derived provider ไม่มี repository / requiredProviders ว่างหลัง waive test; findings: รัน node --test: 3 pass / #39-4: decision repair-no-progress จาก proof gate ไม่มี fingerprint และไม่มีคำสั่งต่อตัวเลือก, pending เป็น null, advance --decision ล้มด้วย stale or absent; next ชี้ packet --phase build / #39-1: normalizeSemanticDraft ที่ task ผูก repository svc ได้ provider test ที่ไม่มี repository / #40 D3: ก่อน waive required = discovery, test, test-svc; หลัง waive test เหลือ \[\] รวม test-svc ที่ปกติดีและ discovery; limitations: ทดสอบที่ระดับฟังก์ชันด้วย context จำลอง ไม่ใช่ advance/Prove end-to-end / #39-4 จำลอง envelope ตาม advance-runtime.mjs:455-469 ไม่ได้รันผ่าน advance จริง; refs: solution-poc@1

### สาระจากบทสนทนา

- u1 [user]: 39 40 ดูทีว่า เป็นจริงไหม แก้ไขยังเพราะอะไร แก้แล้วดีขึ้นยังไง tradeoff คืออะไร (session message /investigate 39 40)
- u2 [user]: ได้ solution และ poc ครบหรือยัง (session message)
- u3 [user]: ทำตามที่เสนอเลย (session message)
- u4 [user]: ตามนี้ (D3 = reject-empty-receipts, A = fail-with-guidance) (session message)

### ช่องว่างของประวัติ

- เนื้อหา run artifacts ใต้ .foundation/ ของโปรเจกต์ผู้รายงานไม่มีให้ตรวจ
- ความเชื่อมโยงเชิงสาเหตุของ #39-5 (REPAIR จากหลักฐานเก่าถูกนับเป็น no-progress) ยังไม่ได้ repro
