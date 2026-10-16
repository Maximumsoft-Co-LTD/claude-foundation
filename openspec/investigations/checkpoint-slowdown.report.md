<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: checkpoint-slowdown

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-16T10:54:19.455Z · 5213a91ecd17e8a91b6d1edf4d9e17e15d2fbe3451399ac883b80cd7975e1346

## ปัญหา

candidate 54fad9c99 ช้ากว่า 8262dfe97 47% ใน 22 lane ที่รันทีละ lane ต้องรู้ว่าการแก้ที่เสนอลดเวลาได้เท่าไรก่อนเปิด change

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** ลดเวลาและค่าใช้จ่ายที่เพิ่มขึ้นจาก template v5 และ review ที่ยกระดับเพราะ workType

**ผลลัพธ์ที่ต้องการ:** ตัวเลขจาก POC 1 lane ว่าการแก้ 3 ข้อลดเวลาได้เท่าไร เพื่อใช้ตัดสินใจเปิด change


### ผู้เกี่ยวข้อง

- user
- agent
- harness

### ขอบเขต

- change start --template
- review tier routing
- work-type capabilities

### ข้อกำหนดล่าสุด

- **shorter-template@1** [behavior / stated] ย่อ draft ขั้นต่ำของ template v5 ให้สั้นลง; ที่มา: user (u-fix)
- **worktype-no-tier@1** [behavior / stated] workType อย่างเดียวไม่ยก review ขึ้นระดับสูง ใช้ risk จริงเป็นตัวตัดสิน; ที่มา: user (u-fix)
- **worktype-evidence@1** [constraint / stated] ทุก workType ที่ประกาศต้องมีหลักฐานของมัน; ที่มา: user (u-evidence)
- **bind-four@1** [behavior / stated] ผูกหลักฐาน performance→performance, async→concurrency, integration→integration, deprecation→compatibility; ที่มา: user (u-bind)
- **poc-first@1** [constraint / stated] investigate และทำ POC 1 งานเพื่อวัดว่าลดได้แค่ไหนก่อนปรับจริง; ที่มา: user (u-poc)

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- **poc-notes-api** [complete]: การแก้ 3 ข้อทำให้ notes-api เร็วขึ้นเท่าไรเทียบกับ 54fad9c99; เกณฑ์ตัดสิน: ใช้ claude-sonnet-5-5 รันทีละ lane เหมือนเดิม / oracle ต้องผ่านเต็ม / เทียบเวลา host envelope ค่าใช้จ่าย ระดับ review และความยาว draft; ผลที่พบ: POC (2 ข้อ: ข้อความ template และ workType ไม่ยก tier) รัน notes-api 1 ครั้ง: เวลาจริง 264 → 185 วินาที (-30%), ค่าใช้จ่าย $0.740 → $0.677 (-9%), archived และ oracle 13/13 เท่าเดิม / review กลับเป็น medium; เวลา advance --through proven 100 → 25 วินาที คือส่วนที่ลดได้เกือบทั้งหมด / ความยาว draft ไม่ลด (15,740 → 15,567 ตัวอักษร) และเวลา model แทบเท่าเดิม (147 → 141 วินาที): การแก้ข้อความ template ไม่ได้ผล / ยังช้ากว่า 8262dfe97 (149 วินาที, $0.265): output token 21,401 เทียบกับ 5,372 ยังเป็นส่วนต่างที่ยังไม่ได้อธิบาย; ข้อจำกัด: รันครั้งเดียว ไม่มีการทำซ้ำ ความแปรปรวนของ agent ระหว่างรอบอาจใหญ่กว่าผลที่วัดได้ / ไม่ได้ทดสอบการผูกหลักฐาน 4 workType เพราะ notes-api ไม่ใช้ / POC เป็นสำเนาที่ dirty ไม่ใช่ candidate ที่ commit; refs: poc-first@1, shorter-template@1, worktype-no-tier@1
- **poc-v5-defaults** [complete]: ให้ draft v5 ที่มี key ได้ capability/outcome ที่เติมให้ ลดรอบแก้ draft และเวลาจริงไหม; เกณฑ์ตัดสิน: 3 lane ที่ระดับ review ไม่เปลี่ยน / claude-sonnet-5-5 ทีละ lane / oracle ต้องผ่านเต็ม; ผลที่พบ: error capability/outcome is required หายทั้ง 3 lane / typescript-react-state 73 → 57 วินาที, library-cli-flag 97 → 62 วินาที, security-hotfix 138 → 112 วินาที; รวม 308 → 231 วินาที (-25%) เทียบกับ 197 วินาทีของ 8262dfe97 / ค่าใช้จ่ายรวม $1.33 → $1.18 (-11%) ต่ำกว่า 8262dfe97 ($1.22) / ทุก lane archived และ oracle เต็ม; ข้อจำกัด: รันครั้งเดียวต่อ lane / POC มีการแก้ review tier รวมอยู่ด้วย แต่ 3 lane นี้ระดับ review ไม่เปลี่ยน / การแก้ใน POC ให้ทุก draft v5 นับเป็น minimal ต้องตรวจผลข้างเคียงกับ draft v5 แบบเต็มใน change จริง; refs: poc-first@1

### งานอิสระที่ทำต่อได้

- poc-copy: สำเนาทิ้งได้ของ 54fad9c99 พร้อมการแก้ 3 ข้อ ใต้ .foundation/prototypes/checkpoint-slowdown/poc

### สาระจากบทสนทนา

- **u-why** [user]: ทำไมช้าก่อน (session message)
- **u-fix** [user]: เลือก: ย่อ template กับลด review (ถามว่าลดอะไร) (session message)
- **u-evidence** [user]: ดีนะจะใส่ worktype อะไรต้องมีหลักฐาน (session message)
- **u-bind** [user]: เลือก: ผูกทั้ง 4 ตามที่เสนอ (session message)
- **u-poc** [user]: ถ้าปรับ ลอง /investigate และ Poc ดูทีสัก 1 งานว่าจะลดได้แค่ไหน (session message)

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- ข้อความก่อนสรุป context ของ session นี้อ่านจาก summary ไม่ได้อ่านครบทุกข้อความ
- ตัวเลขที่วัดได้มาจาก raw bench ที่ git ไม่เก็บ: .claude/tests/bench/results/openspec-native-lab/ (54fad9c99 เทียบกับ 8262dfe97) วิเคราะห์ด้วยสคริปต์นอก repo

## ข้อสรุปปัจจุบัน

สาเหตุหลักที่ช้าลงคือ draft v5 ที่มี key ไม่ได้รับ capability/outcome ที่ harness เติมให้ จึงเสียรอบแก้ draft เพิ่มใน 20 จาก 21 lane (+434 วินาที) รองลงมาคือ review ที่ถูกยกระดับเพราะ workType (POC ลด 30% ใน notes-api) ส่วนที่เหลือคือ API ช้าลงต่อ token ช่องว่าง token 4 เท่าของ notes-api เป็นผลของการวัดที่ขาด

## ข้อเสนอแนะและเหตุผล

(1) draft version 5 ที่ requirement หรือ task มี key ยังได้รับ capability และ outcome ที่ harness เติมให้เหมือน draft v4; (2) capability ที่ถูกบังคับเพราะ workType อย่างเดียวยังต้องมีหลักฐานครบ แต่ไม่ยกระดับ review; (3) ผูกหลักฐาน performance→performance, async→concurrency (capability ใหม่), integration→integration, deprecation→compatibility; ไม่แก้ข้อความ template

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **slowdown-total:** 22 lane (ไม่นับ project-tracker-api) เวลาจริงรวม 2,019 → 2,968 วินาที: เวลา model +558 วินาที, advance --through proven (ส่วนใหญ่คือ AI review) +322 วินาที, ส่วนอื่นแทบไม่เปลี่ยน ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **draft-format:** ก่อนหน้า 21/22 lane เขียน draft เป็น JSON ไฟล์เดียว ตอนนี้ 22/22 เขียน change.json + proposal.md; ข้อความ draft ที่ agent เขียน 82,312 → 112,891 ตัวอักษร (+37%), ข้อความ test +15% ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **output-tokens:** output token รวม 163,410 → 212,385 (+30%); เวลา model ต่อ 1,000 token 8.05 → 8.82 วินาที (+10%) จึงส่วนใหญ่เป็นงานเขียนที่เพิ่ม ไม่ใช่ API ช้า ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **worktype-declared:** ก่อนหน้า draft ส่วนใหญ่ไม่ประกาศ workType ตอนนี้ทุก lane ประกาศ; notes-api ประกาศ feature,api และ deprecate-option ประกาศ feature,library,deprecation ([.claude/harness/runtime/contracts/work-types.mjs](<../../.claude/harness/runtime/contracts/work-types.mjs>))
- **worktype-to-tier:** workType api/library เพิ่ม capability compatibility ซึ่งอยู่ใน REVIEW\_DIVERSITY\_CAPABILITIES จึงเพิ่ม trigger critical-capability และยก review เป็น high: notes-api และ deprecate-option จาก medium เป็น high ([.claude/harness/runtime/workflow/change-policy.mjs](<../../.claude/harness/runtime/workflow/change-policy.mjs>), [.claude/harness/runtime/evidence/evidence-contract.mjs](<../../.claude/harness/runtime/evidence/evidence-contract.mjs>))
- **risk-driven-tiers:** cart-coupons (financial), platform-migration, add-metrics, privacy-erasure (input-domain) ได้ review เพิ่มจากสัญญาณ risk ของเนื้องาน ไม่ใช่จาก workType ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))
- **unbound-worktypes:** WORK\_TYPES มี 23 แบบ ผูก capability ไว้ 12 แบบ; performance, async, integration, deprecation ยังไม่มี capability เฉพาะ; catalog มี performance, integration, compatibility แต่ไม่มี concurrency ([.claude/harness/runtime/workflow/change-policy.mjs](<../../.claude/harness/runtime/workflow/change-policy.mjs>), [.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>), [.claude/harness/runtime/contracts/work-types.mjs](<../../.claude/harness/runtime/contracts/work-types.mjs>))
- **poc-result:** POC notes-api: 264 → 185 วินาที, $0.740 → $0.677, review high → medium, Prove 100 → 25 วินาที, draft 15,740 → 15,567 ตัวอักษร, oracle 13/13 ([.claude/harness/runtime/evidence/evidence-contract.mjs](<../../.claude/harness/runtime/evidence/evidence-contract.mjs>), [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **measurement-gap:** notes-api ของ 8262dfe97 ไม่มี host usage envelope (0/1 session) ตัวเลข $0.27 และ 5,372 token จึงเป็นค่าประมาณ ช่องว่าง token 4 เท่าเป็นผลของการวัด ไม่ใช่งานจริง; project-tracker-api รอบใหม่วัดแค่ turn สุดท้าย ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **clean-21:** 21 lane ที่วัดครบทั้งสองฝั่ง: เวลา 1,871 → 2,704 วินาที (+45%), ค่าใช้จ่าย $9.68 → $10.43 (+8%), output token +19%; เวลา API +581 วินาที, harness +265 วินาที; context ต่อ turn เท่าเดิม (~40k token) ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **v5-minimal-gap:** isMinimalSemanticDraft นับ draft ที่ไม่มี version เป็น minimal แม้ requirement มี key แต่นับ draft version 5 เป็น minimal เฉพาะเมื่อ requirement และ task ไม่มี key; draft ที่ไม่ minimal ไม่ได้รับ capability และ outcome ที่ harness เติมให้ ([.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>))
- **v5-repair-rounds:** draft แรกของ agent: เดิม 20/21 ไม่มี version, ตอนนี้ 21/21 เป็น version 5 และ 20 มี key; error capability/outcome is required 2 → 29 ครั้งใน 20 lane; เวลาจากเริ่มถึง build task แรก 894 → 1,328 วินาที (+434 วินาที หรือราวครึ่งของเวลาที่เพิ่ม) ([.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>), [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **poc2-result:** POC รอบ 2 (3 lane): 308 → 231 วินาที (-25%), $1.33 → $1.18, error capability/outcome หายทั้งหมด, oracle เต็ม ([.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>))

## สมมติฐานและหลักฐาน

- **h-template — มีหลักฐานหักล้าง:** draft ขั้นต่ำที่สั้นลงลดเวลา model ได้ส่วนใหญ่ของ +558 วินาที; หลักฐาน: draft-format, output-tokens, poc-result
- **h-tier — มีหลักฐานสนับสนุน:** ไม่ให้ workType ยก tier ทำให้ notes-api กลับเป็น medium review และลดเวลา Prove; หลักฐาน: worktype-to-tier, poc-result
- **h-v5-defaults — มีหลักฐานสนับสนุน:** draft v5 ที่มี key ไม่ได้รับ capability/outcome ที่เติมให้ ทำให้ทุก lane เสียรอบแก้ draft เพิ่ม; หลักฐาน: v5-minimal-gap, v5-repair-rounds, poc2-result

## การตัดสินใจ

- **d-bind-four — ตัดสินใจแล้ว:** workType ที่ยังไม่มีหลักฐานจะผูกหลักฐานอะไร
  ตัวเลือก: ผูกทั้ง 4: performance→performance, async→concurrency, integration→integration, deprecation→compatibility; ข้อเสนอแนะและเหตุผล: ผู้ใช้ต้องการให้ทุก workType ที่ประกาศมีหลักฐาน; หลักฐาน: ยังไม่ได้บันทึก

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/runtime/contracts/work-types.mjs](<../../.claude/harness/runtime/contracts/work-types.mjs>)
- [.claude/harness/runtime/evidence/evidence-contract.mjs](<../../.claude/harness/runtime/evidence/evidence-contract.mjs>)
- [.claude/harness/runtime/evidence/provider-catalog.mjs](<../../.claude/harness/runtime/evidence/provider-catalog.mjs>)
- [.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>)
- [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>)
- [.claude/harness/runtime/workflow/change-policy.mjs](<../../.claude/harness/runtime/workflow/change-policy.mjs>)
- [.claude/harness/runtime/workflow/semantic-draft.mjs](<../../.claude/harness/runtime/workflow/semantic-draft.mjs>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)
- [docs/reports/scenario-order-inventory-2026-10-12.th.md](<../../docs/reports/scenario-order-inventory-2026-10-12.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/harness-rapid-speed-plan-2026-09-30.md](<../../docs/reports/harness-rapid-speed-plan-2026-09-30.md>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [docs/reports/scenario-order-inventory-2026-10-12.th.md](<../../docs/reports/scenario-order-inventory-2026-10-12.th.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/checkpoint-slowdown.json
```

