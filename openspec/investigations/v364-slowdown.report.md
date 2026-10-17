<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: v364-slowdown

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-17T20:44:33.169Z · c2536cdddf3b9421a1ef111e81180e15c64848696f6d1f338b2f3773eabf913e

## ปัญหา

v3.6.4 ช้ากว่า v3.6.3: 10 scenario ที่ fixture เหมือนกันทุก byte รันสลับกัน ด้วย Sonnet 5.5 (n=1) ใช้เวลา 1,038 → 1,495 วินาที (+44%) และค่าใช้จ่าย $4.56 → $5.85 (+28%) ต้องรู้ว่าเวลาไปอยู่ช่วงไหนก่อนเสนอการแก้

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** อธิบายว่าเวลาและค่าใช้จ่ายที่เพิ่มขึ้นของ v3.6.4 เกิดในช่วงไหนและจากกลไกใด

**ผลลัพธ์ที่ต้องการ:** สาเหตุรายช่วงที่มีตัวเลขยืนยัน พร้อมทางเลือกการแก้ให้ผู้ใช้ตัดสิน


### ผู้เกี่ยวข้อง

- user
- agent
- harness

### ขอบเขต

- change start intake
- risk signal guidance in the start template
- review routing
- Prove

### ข้อกำหนดล่าสุด

- **phase-first@1** [constraint / stated] หาว่าเวลาไปอยู่ช่วงไหนก่อนเสนอการแก้ใดๆ; ที่มา: user (u-why-slow)

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- **poc-template-guidance** [complete]: คำแนะนำ input-domain ที่แคบลงและตาราง coverage ใน template ลดเวลาและรอบแก้ draft ได้เท่าไรเทียบกับ candidate 8410d517c; เกณฑ์ตัดสิน: ใช้ claude-sonnet-5-5 รันทีละ lane / oracle ต้องผ่านเต็มและ archived / เทียบเวลา ค่าใช้จ่าย รอบที่ change start ถูกตีกลับ issue เรื่อง coverage risk signal ที่ประกาศ และเวลา reviewer; ผลที่พบ: 6 lane (tiny-feature, bare-node-boundary, cart-coupons, python-api-validation, refactor-no-reproduction, notes-api): เวลา 673 → 475 วินาที (-30%) ค่าใช้จ่าย $3.04 → $2.61 (-14%) v3.6.3 อยู่ที่ 412 วินาที $2.46 / issue เรื่อง discovery coverage 27 → 0 รอบที่ change start ถูกตีกลับ 14 → 2 เท่ากับ v3.6.3 / input-domain ประกาศเฉพาะ python-api-validation และ notes-api ที่รับ HTTP input จริง lane อื่นไม่ประกาศ risk signal / เวลา reviewer 157 → 45 วินาที (v3.6.3 18 วินาที) cart-coupons 80 → 0 วินาที / ทุก lane completed, archived และ oracle เต็มเท่าเดิม จำนวน scenario 51 เท่าเดิม (v3.6.3 29) ซึ่งเป็นส่วนที่ยังช้ากว่า v3.6.3 ราว 15%; ข้อจำกัด: รันครั้งเดียวต่อ lane ไม่มีการทำซ้ำ / POC เป็นสำเนา ee0047f4e ที่ dirty 2 ไฟล์ ไม่ใช่ commit / ไม่ได้รัน project-tracker-api และ lane ที่มี access-control จริง จึงยังไม่รู้ผลกับงานที่ควรประกาศความเสี่ยงหลายตัว; refs: phase-first@1

### งานอิสระที่ทำต่อได้

- poc-copy: สำเนาทิ้งได้ของ ee0047f4e ที่แก้ minimalDraftRiskSignals และเพิ่ม minimalDraftRiskCoverage ใต้ .foundation/prototypes/v364-slowdown/poc

### สาระจากบทสนทนา

- **u-why-slow** [user]: investigate ทำไม v3.6.4 ช้ากว่า v3.6.3 (session message)
- **u-fix-direction** [user]: เลือก: แก้ coverage + คำแนะนำ (ทำ POC วัดก่อนเปิด change) (session message)

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- ตัวเลขทั้งหมดมาจาก raw bundle ที่ git ไม่เก็บ: ~/.local/share/changeloop/benchmarks/2026-10-18-candidate-8410d517c.tar.gz (candidate 8410d517c และ v3.6.3) วิเคราะห์ด้วยสคริปต์นอก repo (phase-split, intake-issues, intake-window, stage-spans, review-split)
- แต่ละ scenario รันครั้งเดียวต่อฝั่ง ยังไม่ได้วัดความแปรปรวนของ agent ระหว่างรอบสำหรับคู่นี้
- ไม่ได้วัดว่า input-boundary coverage และ review ที่เพิ่มขึ้นช่วยให้คุณภาพดีขึ้นจริงหรือไม่: oracle เท่ากันทั้ง 10 คู่ ส่วนผลดีที่เคยเห็นในรายงาน 2026-10-15 (ครอบคลุม boundary 5000) มาจาก guidance เรื่อง fixes ซึ่งแยกผลของ input-domain ไม่ได้

## ข้อสรุปปัจจุบัน

v3.6.4 ช้ากว่าเพราะ template รุ่นใหม่สอนให้ประกาศ riskSignals และเกือบทุก draft ประกาศ input-domain ซึ่งทำสามอย่าง: (1) บังคับ AI review ระดับ medium แม้งานเล็ก ทำให้ Prove +182–191 วินาที; (2) บังคับ discovery coverage ที่ agent เขียนผิดซ้ำ ทำให้รอบแก้ draft +127 วินาที; (3) ร่วมกับกฎแยก scenario ทำให้ scenario เพิ่ม 47 → 88 จึงต้องเขียนเทสต์มากขึ้นใน Build (ส่วนใหญ่ของ +144 วินาทีที่เหลือ อยู่ที่ project-tracker-api) oracle เท่ากันทุกคู่ จึงยังไม่มีหลักฐานว่าคุณภาพดีขึ้น ผู้ใช้เลือก opt-coverage ร่วมกับ opt-guidance และ POC 6 lane ลดเวลา -30% ค่าใช้จ่าย -14% รอบแก้ draft กลับมาเท่า v3.6.3 โดย oracle เต็มทุก lane ไม่ต้องแก้ review tier

## ข้อเสนอแนะและเหตุผล

(1) คำแนะนำ input-domain ใน change start --template ใช้เฉพาะค่าจากภายนอกโปรแกรม (HTTP request, ไฟล์ upload, CLI argument, message payload) ที่ต้องตรวจหรือปฏิเสธ ไม่ใช่ argument ของฟังก์ชันทั่วไป; (2) template มี minimalDraftRiskCoverage ที่บอกรูปแบบ discovery.coverage row และ dimension ที่แต่ละ risk signal บังคับ โดยสร้างจาก RISK\_SIGNAL\_DIMENSIONS ใน semantic-intake.mjs; ไม่เปลี่ยน review tier และกฎตรวจ coverage

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **phase-split:** ส่วนต่าง +457 วินาทีแยกเป็น: harness stage prove.execute 189 → 379 วินาที (+191) ส่วน stage อื่นของ harness (change.validate, build, land.\*) ต่างกันไม่ถึง 1 วินาที; เวลาตั้งแต่ change start ครั้งแรกถึงครั้งสุดท้าย 55 → 181 วินาที (+127); ที่เหลือ +144 วินาที โดย +118 อยู่ที่ project-tracker-api ช่วง Build (request 17 → 31) อีก 9 lane รวม +26 วินาที ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **review-time:** เวลาของ AI reviewer รวม 178 → 360 วินาที (+182) ใกล้เคียงกับ prove.execute ที่เพิ่ม +191 วินาที: 5 lane ที่ v3.6.3 ไม่มี review เลย (bare-node-boundary, cart-coupons, python-api-validation, refactor-no-reproduction, tiny-feature) ใน candidate มี review 11–80 วินาที; lane ที่มี review อยู่แล้วนานขึ้นเล็กน้อย ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))
- **risk-declared:** draft ของ v3.6.3 ไม่ประกาศ riskSignals เลยทั้ง 10 lane ส่วน candidate ประกาศ 9 จาก 10 lane และทุกตัวมี input-domain (บางตัวมี financial, persisted-data-change, access-control เพิ่ม) lane เดียวที่ไม่ประกาศคือ typescript-react-state ซึ่งไม่มี review และเป็น lane เดียวที่ candidate เร็วกว่า (70 → 43 วินาที) ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **template-guidance:** template ของ change start (minimalDraftRiskSignals ที่ change-lifecycle.mjs:1814 เพิ่มใน ef8ac0e2e) บอกให้ใส่ 'input-domain' for behavior computed from caller-supplied values ซึ่งเข้ากับงานเกือบทุกงาน ([.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>))
- **input-domain-tier:** SECURITY\_RISK\_SIGNAL\_TIERS ให้ input-domain เป็นระดับ medium (review-routing.mjs:34-38) และ mediumReviewRiskTriggers ใส่ trigger input-domain (review-routing.mjs:104-105) จึงมี AI review แม้ change เป็น rapid ขนาด xs และ impact low ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))
- **input-domain-coverage:** risk signal input-domain บังคับ discovery coverage dimension input-boundary (semantic-intake.mjs:63) financial บังคับ timeout-retry-idempotency และ recoverability ([.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>))
- **intake-repairs:** ใน 10 lane เดียวกัน change start ฝั่ง candidate ถูกตีกลับให้แก้ 22 ครั้งจาก 31 ครั้ง (v3.6.3: 5 จาก 15) issue เรื่อง discovery.coverage รวม 49 ครั้ง (covered แต่ไม่มี covers/sources 22, ขาด required dimension 20, status ไม่ถูกต้อง 5, not-applicable ไม่มีเหตุผล 2) ซึ่ง v3.6.3 ไม่มีเลย; issue ที่ scenario รวมหลายกรณีมีทั้งสองฝั่ง (18 กับ 8) ([.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>))
- **scenario-growth:** จำนวน scenario ใน spec ที่ archive รวม 47 → 88: project-tracker-api 6 → 26, cart-coupons 5 → 14, tiny-feature 2 → 9, notes-api 10 → 16 lane อื่นต่างกันไม่เกิน 1 ใน project-tracker-api ฝั่ง candidate เขียนไฟล์เทสต์แยกราว 6 ไฟล์ (v3.6.3 เขียน 1 ไฟล์) และช่วง Build จาก spec approved ถึง advance --through proven ยาว 145 → 268 วินาที; issue ที่ให้แยก scenario ที่รวมหลายกรณี (18 ครั้ง) และ coverage ของ input-boundary/access allow-deny ทำให้ scenario แตกเป็นหลายข้อ ([.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>))
- **same-quality:** oracle เท่ากันทุกคู่ (10/10 ทั้งสองฝั่ง รวม project-tracker-api 33/33) output token รวม 102,739 → 140,385 (+37%) request 135 → 168 ([.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>))

## สมมติฐานและหลักฐาน

- **h-review — มีหลักฐานสนับสนุน:** risk signal input-domain ที่ template สอนให้ใส่ทำให้มี AI review เพิ่มใน Prove และเป็นส่วนใหญ่ของ +191 วินาที; หลักฐาน: review-time, risk-declared, template-guidance, input-domain-tier
- **h-intake — มีหลักฐานสนับสนุน:** risk signal ที่ประกาศบังคับ discovery coverage ที่ agent ต้องเขียนเอง และ agent เขียนผิดรูปแบบหลายรอบ จึงเกิดรอบแก้ draft เพิ่ม +127 วินาที; หลักฐาน: intake-repairs, input-domain-coverage, risk-declared
- **h-tracker-build — มีหลักฐานหักล้าง:** ส่วนที่เหลือ +118 วินาทีของ project-tracker-api มาจากความแปรปรวนของ agent ใน Build ไม่ใช่ harness; หลักฐาน: phase-split, scenario-growth
- **h-scenarios — มีหลักฐานสนับสนุน:** spec ของ candidate มี scenario มากขึ้นเกือบเท่าตัว (แยกกรณี และ coverage ที่ risk signal บังคับ) agent จึงเขียนเทสต์มากขึ้นใน Build และ reviewer ตรวจมากขึ้น ซึ่งอธิบาย Build ที่ยาวขึ้นของ project-tracker-api และ output token +37%; หลักฐาน: scenario-growth, same-quality, intake-repairs

## ทางเลือกและข้อแลกเปลี่ยน

### opt-coverage

ให้ harness เติม discovery coverage dimension ที่ risk signal บังคับเองเมื่อ requirement มี scenario ของ boundary แล้ว หรือให้ template มีตัวอย่าง coverage ที่ถูกรูปแบบ เพื่อลดรอบแก้ draft โดยไม่ลดสิ่งที่ตรวจ

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### opt-tier

input-domain ไม่บังคับ review เอง (ยังบังคับ input-boundary coverage และหลักฐาน) เหมือนที่ทำกับ workType ใน v3.6.4

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### opt-guidance

ทำให้คำแนะนำ input-domain ใน template แคบลง ใช้เฉพาะค่าที่ข้าม trust boundary (request จากภายนอก, ไฟล์ upload, CLI ของผู้ใช้)

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

### opt-keep

คงไว้แบบเดิม ยอมรับต้นทุนที่สูงขึ้นแลกกับ review และ coverage ที่มากขึ้น

ข้อค้นพบ:

ยังไม่ได้บันทึก

ข้อแลกเปลี่ยน:

ยังไม่ได้บันทึก

แหล่งอ้างอิง: 

ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์): ยังไม่ได้บันทึก

## การตัดสินใจ

- **fix-direction — ตัดสินใจแล้ว:** จะลดต้นทุนที่เพิ่มขึ้นจาก input-domain ทางไหน
  ตัวเลือก: opt-coverage + opt-guidance แล้ว POC / opt-tier / opt-coverage อย่างเดียว / opt-keep; ข้อเสนอแนะและเหตุผล: opt-coverage + opt-guidance แล้ว POC; หลักฐาน: intake-repairs, template-guidance, review-time, same-quality

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/harness/runtime/evidence/review-routing.mjs](<../../.claude/harness/runtime/evidence/review-routing.mjs>)
- [.claude/harness/runtime/workflow/change-lifecycle.mjs](<../../.claude/harness/runtime/workflow/change-lifecycle.mjs>)
- [.claude/harness/runtime/workflow/validation/semantic-intake.mjs](<../../.claude/harness/runtime/workflow/validation/semantic-intake.mjs>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md>)
- [docs/reports/scenario-checkpoint-candidate-2026-10-18.th.md](<../../docs/reports/scenario-checkpoint-candidate-2026-10-18.th.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md](<../changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md>)
- [openspec/changes/archive/2026-10-17-task-build-skill-task-description-skill-spec-agent-skill/proposal.md](<../changes/archive/2026-10-17-task-build-skill-task-description-skill-spec-agent-skill/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md](<../changes/archive/2026-10-16-draft-v5-key-capability-outcome-worktype-review-worktype/proposal.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-checkpoint-candidate-2026-10-18.th.md](<../../docs/reports/scenario-checkpoint-candidate-2026-10-18.th.md>)
- [openspec/changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md](<../changes/archive/2026-10-15-change-code-repository-submodule-prove-amend-waive-recovery-issu/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [docs/reports/continuity-paid-e2e-2026-10-15.th.md](<../../docs/reports/continuity-paid-e2e-2026-10-15.th.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/proposal.md](<../changes/archive/2026-10-15-change-pstack-agent/proposal.md>)
- [docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md](<../../docs/reports/remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [openspec/changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md](<../changes/archive/2026-10-15-skill-pstack-reference-owner-skill-change-loop-context-budget/proposal.md>)
- [openspec/changes/archive/2026-10-17-task-build-skill-task-description-skill-spec-agent-skill/proposal.md](<../changes/archive/2026-10-17-task-build-skill-task-description-skill-spec-agent-skill/proposal.md>)
- [openspec/changes/archive/2026-10-15-change-pstack-agent/design.md](<../changes/archive/2026-10-15-change-pstack-agent/design.md>)
- [docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md](<../../docs/reports/scenario-checkpoint-v3.6.3-2026-10-11.th.md>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/v364-slowdown.json
```

