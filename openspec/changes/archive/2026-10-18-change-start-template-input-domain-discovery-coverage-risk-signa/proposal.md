# Change: change start --template แนะนำ input-domain เฉพาะค่าจากภายนอกโปรแกรม และบอกรูปแบบ discovery.coverage ที่แต่ละ risk signal บังคับ เพื่อลด review และรอบแก้ draft ที่ไม่จำเป็น

- **Change:** `change-start-template-input-domain-discovery-coverage-risk-signa` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-17

## เหตุผล

investigation `v364-slowdown` ชี้ว่า v3.6.4 ช้ากว่า v3.6.3 44% เพราะคำแนะนำ `input-domain` ใน
`change start --template` กว้างจนเข้ากับเกือบทุกงาน ผลคือมี AI review ระดับ medium แม้งานเล็ก และ
agent ต้องแก้ discovery coverage ที่ signal บังคับซ้ำหลายรอบ เพราะ template ไม่ได้บอกรูปแบบ

## ขอบเขต

- ทำคำแนะนำ `input-domain` ให้แคบลง ใช้เฉพาะค่าจากภายนอกโปรแกรมที่ต้องตรวจหรือปฏิเสธ
- เพิ่ม `minimalDraftRiskCoverage` ใน template ซึ่งบอกรูปแบบ row และ dimension ที่แต่ละ signal บังคับ
  โดยสร้างจากตารางเดียวกับที่ intake ใช้ตรวจ
- POC 6 lane ลดเวลา 30% และค่าใช้จ่าย 14% โดย oracle เต็มทุก lane

- **In scope (`change`):** งานที่ไม่ได้รับค่าจากภายนอกไม่ประกาศ input-domain จึงไม่มี review และ coverage ที่ไม่จำเป็น; agent เขียน coverage ที่ risk signal บังคับได้ถูกตั้งแต่ draft แรก
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/runtime/workflow/validation/semantic-intake.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs`; the authored Non-goals below

## Non-goals

- ไม่เปลี่ยน review tier ของ input-domain หรือ signal อื่น
- ไม่เปลี่ยนกฎตรวจ discovery coverage
- ไม่เพิ่มข้อความใน commands/change.md เพราะ POC ทำให้ issue เรื่อง coverage เป็น 0 แล้ว

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| narrow-input-domain | คำแนะนำแคบลง | unclassified | T001 | test: `.claude/harness/tests/change-atomic-start.test.mjs` | — |
|  | signal อื่นคงเดิม | unclassified | T001 |  |  |
| risk-coverage-template | ทุก signal มี dimension | unclassified | T001 | test: `.claude/harness/tests/change-atomic-start.test.mjs` | — |
|  | รูปแบบ row | unclassified | T001 |  |  |
|  | draft ตามตัวอย่างผ่าน intake | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (5).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: การสืบค้น

- **ID:** v364-slowdown
- **ผลลัพธ์:** ready-for-change
- **สรุป:** v3.6.4 ช้ากว่าเพราะ template รุ่นใหม่สอนให้ประกาศ riskSignals และเกือบทุก draft ประกาศ input-domain ซึ่งทำสามอย่าง: (1) บังคับ AI review ระดับ medium แม้งานเล็ก ทำให้ Prove +182–191 วินาที; (2) บังคับ discovery coverage ที่ agent เขียนผิดซ้ำ ทำให้รอบแก้ draft +127 วินาที; (3) ร่วมกับกฎแยก scenario ทำให้ scenario เพิ่ม 47 → 88 จึงต้องเขียนเทสต์มากขึ้นใน Build (ส่วนใหญ่ของ +144 วินาทีที่เหลือ อยู่ที่ project-tracker-api) oracle เท่ากันทุกคู่ จึงยังไม่มีหลักฐานว่าคุณภาพดีขึ้น ผู้ใช้เลือก opt-coverage ร่วมกับ opt-guidance และ POC 6 lane ลดเวลา -30% ค่าใช้จ่าย -14% รอบแก้ draft กลับมาเท่า v3.6.3 โดย oracle เต็มทุก lane ไม่ต้องแก้ review tier
- **เจตนาของ change:** (1) คำแนะนำ input-domain ใน change start --template ใช้เฉพาะค่าจากภายนอกโปรแกรม (HTTP request, ไฟล์ upload, CLI argument, message payload) ที่ต้องตรวจหรือปฏิเสธ ไม่ใช่ argument ของฟังก์ชันทั่วไป; (2) template มี minimalDraftRiskCoverage ที่บอกรูปแบบ discovery.coverage row และ dimension ที่แต่ละ risk signal บังคับ โดยสร้างจาก RISK_SIGNAL_DIMENSIONS ใน semantic-intake.mjs; ไม่เปลี่ยน review tier และกฎตรวจ coverage
- **State:** .foundation/investigations/v364-slowdown.json @ c2536cdddf3b9421a1ef111e81180e15c64848696f6d1f338b2f3773eabf913e
- **Sources:** sha256:bb508ce5aa0fe5c4ffcc6b5ee689d0d32117be75ffcbd71777f379a65ad8dbf2

เป้าหมาย: อธิบายว่าเวลาและค่าใช้จ่ายที่เพิ่มขึ้นของ v3.6.4 เกิดในช่วงไหนและจากกลไกใด

ผลลัพธ์ที่ต้องการ: สาเหตุรายช่วงที่มีตัวเลขยืนยัน พร้อมทางเลือกการแก้ให้ผู้ใช้ตัดสิน

### ขอบเขตและผู้เกี่ยวข้อง

- change start intake
- risk signal guidance in the start template
- review routing
- Prove
- user
- agent
- harness

### ความครบของ requirement

| Source | Requirement | สถานะ | Targets | รายละเอียด |
|---|---|---|---|---|
| phase-first@1 | หาว่าเวลาไปอยู่ช่วงไหนก่อนเสนอการแก้ใดๆ | constraint / stated / user | requirement: narrow-input-domain; requirement: risk-coverage-template | — |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- poc-template-guidance [complete]: คำแนะนำ input-domain ที่แคบลงและตาราง coverage ใน template ลดเวลาและรอบแก้ draft ได้เท่าไรเทียบกับ candidate 8410d517c; criteria: ใช้ claude-sonnet-5-5 รันทีละ lane / oracle ต้องผ่านเต็มและ archived / เทียบเวลา ค่าใช้จ่าย รอบที่ change start ถูกตีกลับ issue เรื่อง coverage risk signal ที่ประกาศ และเวลา reviewer; findings: 6 lane (tiny-feature, bare-node-boundary, cart-coupons, python-api-validation, refactor-no-reproduction, notes-api): เวลา 673 → 475 วินาที (-30%) ค่าใช้จ่าย $3.04 → $2.61 (-14%) v3.6.3 อยู่ที่ 412 วินาที $2.46 / issue เรื่อง discovery coverage 27 → 0 รอบที่ change start ถูกตีกลับ 14 → 2 เท่ากับ v3.6.3 / input-domain ประกาศเฉพาะ python-api-validation และ notes-api ที่รับ HTTP input จริง lane อื่นไม่ประกาศ risk signal / เวลา reviewer 157 → 45 วินาที (v3.6.3 18 วินาที) cart-coupons 80 → 0 วินาที / ทุก lane completed, archived และ oracle เต็มเท่าเดิม จำนวน scenario 51 เท่าเดิม (v3.6.3 29) ซึ่งเป็นส่วนที่ยังช้ากว่า v3.6.3 ราว 15%; limitations: รันครั้งเดียวต่อ lane ไม่มีการทำซ้ำ / POC เป็นสำเนา ee0047f4e ที่ dirty 2 ไฟล์ ไม่ใช่ commit / ไม่ได้รัน project-tracker-api และ lane ที่มี access-control จริง จึงยังไม่รู้ผลกับงานที่ควรประกาศความเสี่ยงหลายตัว; refs: phase-first@1

### สาระจากบทสนทนา

- u-why-slow [user]: investigate ทำไม v3.6.4 ช้ากว่า v3.6.3 (session message)
- u-fix-direction [user]: เลือก: แก้ coverage + คำแนะนำ (ทำ POC วัดก่อนเปิด change) (session message)

### ช่องว่างของประวัติ

- ตัวเลขทั้งหมดมาจาก raw bundle ที่ git ไม่เก็บ: ~/.local/share/changeloop/benchmarks/2026-10-18-candidate-8410d517c.tar.gz (candidate 8410d517c และ v3.6.3) วิเคราะห์ด้วยสคริปต์นอก repo (phase-split, intake-issues, intake-window, stage-spans, review-split)
- แต่ละ scenario รันครั้งเดียวต่อฝั่ง ยังไม่ได้วัดความแปรปรวนของ agent ระหว่างรอบสำหรับคู่นี้
- ไม่ได้วัดว่า input-boundary coverage และ review ที่เพิ่มขึ้นช่วยให้คุณภาพดีขึ้นจริงหรือไม่: oracle เท่ากันทั้ง 10 คู่ ส่วนผลดีที่เคยเห็นในรายงาน 2026-10-15 (ครอบคลุม boundary 5000) มาจาก guidance เรื่อง fixes ซึ่งแยกผลของ input-domain ไม่ได้

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for narrow-input-domain, risk-coverage-template.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-comment-split: The new riskSignalDimensions() and its comment were inserted between the existing comment block and requiredDiscoveryDimensions. That block explains the nine core dimensions, so it is now detached from the function it describes. Move the new export above the old comment, or below requiredDiscoveryDimensions. (root/.claude/harness/runtime/workflow/validation/semantic-intake.mjs:89) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | f-shared-mutable: riskSignalDimensions() returns the module-level RISK_SIGNAL_DIMENSIONS object itself. A caller can mutate the table that intake validation uses. Return a frozen or copied value, or confirm that the table is already frozen. (root/.claude/harness/runtime/workflow/validation/semantic-intake.mjs:91) | minor | ยังเปิดอยู่ | claude-opus |
