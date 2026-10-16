# Change: draft v5 ที่มี key ได้ capability และ outcome ที่เติมให้, workType อย่างเดียวไม่ยกระดับ review และ workType ทุกแบบมีหลักฐาน

- **Change:** `draft-v5-key-capability-outcome-worktype-review-worktype` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-16

## เหตุผล

รอบทดสอบเต็มชุดของ 54fad9c99 ช้ากว่า 8262dfe97 45% ใน 21 lane ที่วัดครบ สาเหตุหลักคือ draft v5 ที่มี key ไม่ได้รับ capability และ outcome ที่ harness เติมให้ ทำให้แทบทุก lane เสียรอบแก้ draft เพิ่ม และ workType ทำให้ review ถูกยกระดับโดยไม่มี risk จริง POC ลดเวลาได้ 25–30% โดยผลงานเท่าเดิม

## ขอบเขต

- **In scope:** draft v5 ที่มี key แต่ไม่มี capability และ outcome ผ่าน intake โดยไม่ต้องแก้ draft เพิ่ม; change ที่ประกาศ workType api หรือ library ได้ระดับ review ตาม risk จริง และยังต้องมีหลักฐาน compatibility; workType ทั้ง 4 แบบมีหลักฐานที่ต้องมีเหมือน workType อื่น
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/tests/draft-folder.test.mjs`, `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/review-policy.test.mjs`, `.claude/harness/EVIDENCE.md`, … +4 more; the authored Non-goals below

## Non-goals

- ไม่แก้ข้อความของ change start --template เพราะ POC แสดงว่าไม่ลดความยาวเอกสาร

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| hybrid-change-drafts | v5-keyed-defaults | T001 |
| review-policy | worktype-no-tier | T002 |
| evidence-capabilities | worktype-evidence-four | T003 |

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| v5-keyed-defaults | draft v5 ที่มี key | failure | T001 | test: `.claude/harness/tests/draft-folder.test.mjs` | — |
|  | draft v5 แบบเต็มคงเดิม | unclassified | T001 |  |  |
| worktype-no-tier | api ที่ไม่มี risk อื่น | unclassified | T002 | test: `.claude/harness/tests/review-policy.test.mjs` | — |
|  | path บังคับ compatibility | unclassified | T002 |  |  |
| worktype-evidence-four | ประกาศ async | unclassified | T003 | test: `.claude/harness/tests/change-policy-surface.test.mjs` | — |
|  | ประกาศ deprecation | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: การสืบค้น

- **ID:** checkpoint-slowdown
- **ผลลัพธ์:** ready-for-change
- **สรุป:** สาเหตุหลักที่ช้าลงคือ draft v5 ที่มี key ไม่ได้รับ capability/outcome ที่ harness เติมให้ จึงเสียรอบแก้ draft เพิ่มใน 20 จาก 21 lane (+434 วินาที) รองลงมาคือ review ที่ถูกยกระดับเพราะ workType (POC ลด 30% ใน notes-api) ส่วนที่เหลือคือ API ช้าลงต่อ token ช่องว่าง token 4 เท่าของ notes-api เป็นผลของการวัดที่ขาด
- **เจตนาของ change:** (1) draft version 5 ที่ requirement หรือ task มี key ยังได้รับ capability และ outcome ที่ harness เติมให้เหมือน draft v4; (2) capability ที่ถูกบังคับเพราะ workType อย่างเดียวยังต้องมีหลักฐานครบ แต่ไม่ยกระดับ review; (3) ผูกหลักฐาน performance→performance, async→concurrency (capability ใหม่), integration→integration, deprecation→compatibility; ไม่แก้ข้อความ template
- **State:** .foundation/investigations/checkpoint-slowdown.json @ 5213a91ecd17e8a91b6d1edf4d9e17e15d2fbe3451399ac883b80cd7975e1346
- **Sources:** sha256:7701318212f790dd5ff1fffedde3d6835a1c2044f9d86581500b44ee7c415b4a

เป้าหมาย: ลดเวลาและค่าใช้จ่ายที่เพิ่มขึ้นจาก template v5 และ review ที่ยกระดับเพราะ workType

ผลลัพธ์ที่ต้องการ: ตัวเลขจาก POC 1 lane ว่าการแก้ 3 ข้อลดเวลาได้เท่าไร เพื่อใช้ตัดสินใจเปิด change

### ขอบเขตและผู้เกี่ยวข้อง

- change start --template
- review tier routing
- work-type capabilities
- user
- agent
- harness

### ความครบของ requirement

| Source | Requirement | สถานะ | Targets | รายละเอียด |
|---|---|---|---|---|
| shorter-template@1 | ย่อ draft ขั้นต่ำของ template v5 ให้สั้นลง | behavior / stated / user | non-goal: ไม่แก้ข้อความของ change start --template เพราะ POC แสดงว่าไม่ลดความยาวเอกสาร; requirement: v5-keyed-defaults | — |
| worktype-no-tier@1 | workType อย่างเดียวไม่ยก review ขึ้นระดับสูง ใช้ risk จริงเป็นตัวตัดสิน | behavior / stated / user | requirement: worktype-no-tier | — |
| worktype-evidence@1 | ทุก workType ที่ประกาศต้องมีหลักฐานของมัน | constraint / stated / user | requirement: worktype-no-tier; requirement: worktype-evidence-four | — |
| bind-four@1 | ผูกหลักฐาน performance→performance, async→concurrency, integration→integration, deprecation→compatibility | behavior / stated / user | requirement: worktype-evidence-four | — |
| poc-first@1 | investigate และทำ POC 1 งานเพื่อวัดว่าลดได้แค่ไหนก่อนปรับจริง | constraint / stated / user | design: approve-scope | — |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

### ผลทดลองและข้อจำกัด (ไม่ใช่ proof)

- poc-notes-api [complete]: การแก้ 3 ข้อทำให้ notes-api เร็วขึ้นเท่าไรเทียบกับ 54fad9c99; criteria: ใช้ claude-sonnet-5-5 รันทีละ lane เหมือนเดิม / oracle ต้องผ่านเต็ม / เทียบเวลา host envelope ค่าใช้จ่าย ระดับ review และความยาว draft; findings: POC (2 ข้อ: ข้อความ template และ workType ไม่ยก tier) รัน notes-api 1 ครั้ง: เวลาจริง 264 → 185 วินาที (-30%), ค่าใช้จ่าย $0.740 → $0.677 (-9%), archived และ oracle 13/13 เท่าเดิม / review กลับเป็น medium; เวลา advance --through proven 100 → 25 วินาที คือส่วนที่ลดได้เกือบทั้งหมด / ความยาว draft ไม่ลด (15,740 → 15,567 ตัวอักษร) และเวลา model แทบเท่าเดิม (147 → 141 วินาที): การแก้ข้อความ template ไม่ได้ผล / ยังช้ากว่า 8262dfe97 (149 วินาที, $0.265): output token 21,401 เทียบกับ 5,372 ยังเป็นส่วนต่างที่ยังไม่ได้อธิบาย; limitations: รันครั้งเดียว ไม่มีการทำซ้ำ ความแปรปรวนของ agent ระหว่างรอบอาจใหญ่กว่าผลที่วัดได้ / ไม่ได้ทดสอบการผูกหลักฐาน 4 workType เพราะ notes-api ไม่ใช้ / POC เป็นสำเนาที่ dirty ไม่ใช่ candidate ที่ commit; refs: poc-first@1, shorter-template@1, worktype-no-tier@1
- poc-v5-defaults [complete]: ให้ draft v5 ที่มี key ได้ capability/outcome ที่เติมให้ ลดรอบแก้ draft และเวลาจริงไหม; criteria: 3 lane ที่ระดับ review ไม่เปลี่ยน / claude-sonnet-5-5 ทีละ lane / oracle ต้องผ่านเต็ม; findings: error capability/outcome is required หายทั้ง 3 lane / typescript-react-state 73 → 57 วินาที, library-cli-flag 97 → 62 วินาที, security-hotfix 138 → 112 วินาที; รวม 308 → 231 วินาที (-25%) เทียบกับ 197 วินาทีของ 8262dfe97 / ค่าใช้จ่ายรวม $1.33 → $1.18 (-11%) ต่ำกว่า 8262dfe97 ($1.22) / ทุก lane archived และ oracle เต็ม; limitations: รันครั้งเดียวต่อ lane / POC มีการแก้ review tier รวมอยู่ด้วย แต่ 3 lane นี้ระดับ review ไม่เปลี่ยน / การแก้ใน POC ให้ทุก draft v5 นับเป็น minimal ต้องตรวจผลข้างเคียงกับ draft v5 แบบเต็มใน change จริง; refs: poc-first@1

### สาระจากบทสนทนา

- u-why [user]: ทำไมช้าก่อน (session message)
- u-fix [user]: เลือก: ย่อ template กับลด review (ถามว่าลดอะไร) (session message)
- u-evidence [user]: ดีนะจะใส่ worktype อะไรต้องมีหลักฐาน (session message)
- u-bind [user]: เลือก: ผูกทั้ง 4 ตามที่เสนอ (session message)
- u-poc [user]: ถ้าปรับ ลอง /investigate และ Poc ดูทีสัก 1 งานว่าจะลดได้แค่ไหน (session message)

### ช่องว่างของประวัติ

- ข้อความก่อนสรุป context ของ session นี้อ่านจาก summary ไม่ได้อ่านครบทุกข้อความ
- ตัวเลขที่วัดได้มาจาก raw bench ที่ git ไม่เก็บ: .claude/tests/bench/results/openspec-native-lab/ (54fad9c99 เทียบกับ 8262dfe97) วิเคราะห์ด้วยสคริปต์นอก repo

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from scenarios that state a rejection or error (1); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for v5-keyed-defaults, worktype-no-tier, worktype-evidence-four.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
