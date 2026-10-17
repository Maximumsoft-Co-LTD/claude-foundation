---
title: /change
description: Compile semantic draft หนึ่งชุดเป็นข้อตกลง OpenSpec ที่ validate แล้ว
---

<!-- docs-audience: agents-integrators -->
**ผู้อ่าน:** Coding agent และผู้ดูแล integration คำสั่ง CLI และ schema ด้านล่างเป็นเอกสารระบบ ไม่ใช่รายการที่ผู้ใช้ต้องทำเอง ผู้ใช้เริ่มที่ [เริ่มใช้งาน](/docs/th/quickstart/)

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` เปลี่ยน intent ให้เป็นข้อตกลงถาวรที่ทุก phase ถัดไปอ่าน Agent ตีความ
source และเขียน semantic draft ส่วน Change Loop derive มิติการค้น requirement
ตามความเสี่ยง ตรวจ decision frontier สร้าง bookkeeping และติดตั้งผลลัพธ์แบบ
transaction

## Draft แบบขั้นต่ำ

งานทั่วไป agent เขียนแค่ intent, ประเภทงาน, พฤติกรรมที่ต้องการ และ task
คำสั่ง `change start --template` แสดงรูปแบบนี้เป็นอันดับแรกในชื่อ `minimalDraft`
โดยมี field `save` นำหน้า: agent เขียน folder ของ draft v5 `.foundation/drafts/<id>/`
(ดูด้านล่าง) ด้วย Write tool เพราะ host ปฏิเสธ shell heredoc และ `.foundation/drafts/`
เป็น path ที่อนุญาตไว้ล่วงหน้า จากนั้นรัน `claude-foundation change start .foundation/drafts/<id>`
`change.json` ประกาศ `version: 5` และ `workType` ซึ่งเป็นตัวเลือกหัวข้อบังคับ ส่วน
`proposal.md` เก็บเหตุผลเป็นเนื้อความ

```json
{
  "version": 5,
  "language": "en",
  "intent": "Reject empty note titles",
  "workType": ["bugfix"],
  "requirements": [{
    "description": "The system SHALL reject a note whose title is empty",
    "scenarios": [{ "when": "a user submits an empty title", "then": "the note is not created" }]
  }],
  "tasks": [{ "outcome": "Validate note titles", "verify": "npm test", "paths": ["src/note.js"] }]
}
```

Draft JSON ไฟล์เดียวที่ไม่มี `version` (`.foundation/drafts/<id>.json`) ยังเริ่มได้ในฐานะ
draft v4 พร้อมค่า default เดียวกัน

Compiler เติมให้เอง ได้แก่ version, key ของ requirement และ task, capability
(ใส่ `capability` ระดับบนสุดเพื่อตั้งชื่อเองได้ ไม่เช่นนั้นเลือกจาก capability ใน
`openspec/specs` ที่ตรงกับข้อความของ requirement หรือ path ของ task ถ้าจับคู่ไม่ได้จะคืน
`EDIT` เดียวพร้อมรายชื่อ capability ให้เลือก และเมื่อยังไม่มี spec เลยจะใช้นามวลีของ
intent ไม่เกินสามคำ เช่น `kanban-board`), operation (`modified` เมื่อตรงกับ requirement
เดิม ไม่เช่นนั้นเป็น `added`), ชื่อ scenario, `covers` (เดาให้เฉพาะเมื่อมี task เดียว
หรือ requirement เดียว ถ้ามีหลายทั้งคู่จะคืน `EDIT` เดียวที่ระบุ `tasks[i].covers`), ค่า default ของ rapid และ
evidence แบบ test จาก `verify` key ของ requirement ที่ derive ให้เป็นคำเต็มจากประโยค
SHALL (ไม่เกินห้าคำและ 40 ตัวอักษร ไม่ลงท้ายด้วยคำอย่าง "and" หรือ "to") และหัวข้อ
requirement คือประโยคเดียวกันในรูปหัวข้อที่อ่านง่าย เช่น "Persist its cards in browser
localStorage" delta ของ capability ที่ยังไม่มี living spec จะมี `## Purpose` (จาก
capability overview ไม่เช่นนั้นจาก intent และต่อด้วยชื่อ requirement เมื่อ intent สั้น)
ซึ่ง archive นำไปใส่ใน spec ใหม่ และไม่แทนที่ Purpose ของ spec ที่มีอยู่แล้ว
ชื่อ scenario ที่ derive ให้เป็นหัวข้อสั้นจาก `when`
ตัดที่ขอบคำ (ไม่เกิน 60 ตัวอักษร ไม่มี article นำหน้าหรือคำค้างท้าย) ถ้าสองชื่อซ้ำกันจะแยกด้วย
`given` หรือ `then` ไม่เช่นนั้นใช้ตัวเลข ใส่ `decisions: [{ "key", "choice", "reason"? }]`
สำหรับค่า default ทุกข้อที่เลือกเองโดยไม่ได้ถามผู้ใช้ (stack, storage) ระบบบันทึกเป็น
`decidedBy: agent` แสดงใต้หัวข้อ Decisions ใน proposal และยังอยู่ใน rapid lane ถ้าไม่มี
`why` proposal จะไม่มีหัวข้อ Why แทนการซ้ำ intent สั่ง `change start <draft>` ครั้งเดียวก็ตรวจและเริ่ม
change พร้อมแสดงรายชื่อไฟล์ใน packet และ task ถ้าใส่ `version: 4` หรือ `version: 5` หรือประกาศ
ความเสี่ยงไว้ จะใช้รูปแบบเต็มด้านล่าง

## Semantic draft แบบเต็ม

แกนใช้ `version: 4` (หรือ 5), `intent`, `requirements`, `tasks` ที่ระบุ `covers`,
`evidence` ที่ใช้ requirement key เดียวกัน ส่วน `discovery.coverage` เป็น optional
สำหรับ change ทั่วไป และบังคับเฉพาะเมื่อ `impact: high` หรือประกาศ typed risk
(`riskSignals`, security trigger, integration, external operation) แต่ละมิติระบุว่า
ถูก cover, ไม่เกี่ยวข้องพร้อมเหตุผล (เหตุผลอย่างเดียวก็พอ), ต้อง investigate หรือต้องถามผู้ใช้
Harness ไม่สแกน keyword จาก prose มิติที่บังคับซึ่ง draft เขียนไว้แล้วไม่ต้องมี row:
harness จะ derive row `covered` ที่ระบุว่า derived ไว้ใน appendix ของ proposal จาก
`currentState`, `userStories`, requirement, `kind` ของ scenario (`success`,
`failure`, `boundary`), `compatibility`, `nonGoals`, task ที่มี `verify` และ evidence,
`failureMatrix`, `apiContracts`, `dataModel`, `uiStates`, `jobContract` หรือ
`integrations` ที่มีเอกสาร ถ้าไม่มีเนื้อหารองรับมิตินั้นจะยังขาดอยู่ และ row ที่ agent
เขียนเองชนะเสมอ ดังนั้น row `needs-user-decision` ยังถูกถามผู้ใช้เหมือนเดิม
ตัวอย่างโครงสร้างเต็มดูได้
จาก `claude-foundation change start --template`

Agent ใช้ key ที่มีความหมาย Compiler สร้าง claim/task ID ที่ stable และผูก
spec → claim → task → provider ให้อัตโนมัติ รวมปัญหา draft ที่เป็นอิสระทั้งหมดใน
ครั้งเดียวและชี้กลับไปยัง field ต้นทาง Harness จะปฏิเสธ coverage ที่ยังไม่จบ
ตรวจ dependency cycle และเปิดเฉพาะ frontier ที่พร้อมครั้งละไม่เกินสาม decision
ถ้า compile ไม่ผ่านจะไม่เหลือ change ครึ่งชุด Draft version 1 ถึง 3 ยังใช้ได้กับ
integration เดิม

Spec เขียนให้คนอ่าน แต่ละ scenario คือหนึ่งกรณี มี `name` สั้น ๆ, `given` สำหรับ
สถานะก่อนเริ่ม (ไม่บังคับ), `when` หนึ่งเหตุการณ์, `then` หนึ่งผลลัพธ์ และ `and`
สำหรับผลลัพธ์เพิ่ม (ไม่บังคับ) Compiler ปฏิเสธ `when` หรือ `then` ที่รวมหลายกรณีด้วย
`;` และประโยค requirement ที่ยาวจนซ่อนหลาย requirement ไว้ (ใส่ข้อจำกัดใน `details`
แทน) `capabilityOverviews` ให้ชื่อและภาพรวมสั้น ๆ แก่แต่ละไฟล์ spec ส่วน `language`
บันทึกภาษาของเอกสาร เนื้อความเป็นภาษานั้น แต่ `SHALL`, `GIVEN`, `WHEN`, `THEN`
และ `AND` คงเป็นภาษาอังกฤษเพื่อให้ OpenSpec parse ได้

```bash
claude-foundation change start .foundation/drafts/<id>.json
claude-foundation change start .foundation/drafts/<id>   # folder ของ draft v5
```

## Folder ของ draft v5

งานใหม่ใช้ draft v5 ส่วน draft v4 และ v3 ยังใช้ได้ Draft v5 เป็น folder ที่
`change start <folder>` รับได้เหมือน draft แบบ JSON:

```text
.foundation/drafts/<id>/
├── change.json   # "version": 5 และ field แบบ typed ทั้งหมด
├── proposal.md   # เนื้อความที่เขียนเองใต้หัวข้อของ outline
└── design.md     # เนื้อความที่เขียนเองใต้หัวข้อของ outline
```

`proposal.md` และ `design.md` ใช้เฉพาะหัวข้อ `## ` จาก outline ที่มีเวอร์ชันชุดเดียว
เรียงตามลำดับ outline เป็นภาษาอังกฤษหรือไทยก็ได้ Harness เขียน section ที่ derive
เอง (Change header, Capabilities, Acceptance traceability, Definition of done,
Work type, File map, Test map) แล้วรวมกับเนื้อความของคุณซึ่งคงไว้ทุก byte ตามลำดับ
outline Proposal เรียงจาก why, user story, success criteria และ scope ไปจนถึง
impact และ risk, decision ที่รอ ratify และวิธี verify แล้วตามด้วย appendix ส่วน design
เรียงจาก current state และ architecture ผ่าน contract, section ตามชนิดงาน, decision,
quality, rollout ไปจนถึง test `EDIT` เดียวระบุ section ที่ outline ไม่รู้จัก, ที่ harness
derive เอง, ที่ผิดลำดับ, ที่ว่าง หรือที่มี `TODO`/`TBD` คำสั่ง `change start --template`
แสดงหัวข้อที่รับได้ใน `draftFolderV5` ส่วน status, approver, ความสดของ evidence และ
review record ไม่แสดงก่อน Land ให้อ่านด้วย `claude-foundation changes` ลำดับและกฎ
ฉบับเต็มอยู่ใน `WORKFLOW.md` หัวข้อ "Draft v5 folder and outline"

## ชนิดงาน

`workType` (ประกาศเอง หรืออนุมานจาก path ของ task) เลือก section ของ design ที่
standard change ต้องมี ถ้าขาดจะเป็น `EDIT` ของ agent ที่ระบุรูปแบบ field พร้อมตัวอย่าง
ไม่ใช่คำถามถึงผู้ใช้ ตัวอย่างบางส่วน:

| ชนิดงาน | Section ที่บังคับ |
|---|---|
| feature | `userFlow` |
| bugfix | `bugfix` |
| api | `apiContracts`, `boundaries` |
| data | `dataModel` |
| migration | `migrationPlan`, `rollout` |
| ui | `userFlow`, `uiStates`, `componentMap` |

งาน docs, test และ chore ต้องมีแค่ summary งานที่ผู้ใช้มองเห็นต้องมี `releaseNote` ด้วย
ชนิดงานยังเลือก evidence capability ด้วย ส่วน skill นั้น agent เลือกเองจากคำอธิบายของ
skill ที่อ้างถึง `workType`, `riskSignals`, requirement และ scenario รายการครบทั้ง 23 ชนิดอยู่ใน
`WORKFLOW.md` หัวข้อ "Work types and required sections" ส่วน capability อยู่ใน
`.claude/harness/EVIDENCE.md` หัวข้อ "Work-type capabilities"

## Decision

Decision มี `status` ได้ (`proposed`, `accepted`, `superseded` ถ้าไม่ระบุถือว่า accepted)
พร้อม driver, ตัวเลือก และ requirement ที่มันอธิบาย Decision ที่ proposed แสดงเฉพาะใต้
Decisions to ratify ของ proposal เพื่อให้คุณ ratify หรือแก้พร้อมการอนุมัติ ส่วน
`design.md` บันทึก decision ที่ accepted และ superseded Decision ที่ accepted และ
`durable: true` จะเพิ่มบรรทัด `Rationale` ใต้ requirement แต่ละข้อที่ระบุ เหตุผลจึงอยู่รอด
ผ่าน archive เข้า living spec ดู `WORKFLOW.md` หัวข้อ "Decisions"

## Extension แบบมีชนิด

เพิ่มเฉพาะเมื่อจำเป็น:

- requirement หลายตัว แยก `capability` และ `operation`
- section ของ dev document: `summary`, `userFlow` (Mermaid), `failureMatrix`,
  `componentMap`, `apiContracts`, `dataModel`, `uiStates`, `configContract`,
  `jobContract`, `bugfix` หรือ `refactor` โดย harness อนุมาน `workType` จาก
  `paths` ของ task (ประกาศเองเพื่อ override ได้) และสร้าง folder tree,
  file map และ test map ให้เอง Standard change ต้องมี section ที่ชนิดงานต้องการ
  ถ้าขาดจะเป็นงานแก้ draft ของ agent ไม่ใช่คำถามถึงผู้ใช้ ข้อเท็จจริงแต่ละข้อเขียนครั้งเดียว:
  `why` ใช้แทน summary ได้ (เพิ่ม `summary` เมื่อมีอะไรมากกว่านั้น) และถ้าไม่ได้เขียน
  `failureMatrix` เอง scenario ที่มี `"kind": "failure"` จะกลายเป็นแถวของมัน
  โดย `recovery` ของ scenario (ไม่บังคับ) เติมคอลัมน์ recovery ส่วน task ที่เทสของตัวเอง
  อยู่นอก `paths` เป็น design warning
- `decisions` สำหรับมติที่มีผลต่อ implementation พร้อมผลที่ตามมา
- diagram แบบ Mermaid หรืออ้าง SVG/PNG
- `prototypeSelection` ที่ชี้ไป selection note ที่มีจริง
- `integrations` พร้อมแหล่ง/เวอร์ชันเอกสาร requirement ที่เกี่ยวข้อง และ concern
  ด้าน security, resilience, compatibility โดย scenario ที่เกี่ยวข้องต้องระบุ
  `"kind": "success"` และ `"kind": "failure"`
- `repositories` เมื่อแตะหลาย repo พร้อม `repository` ของแต่ละ task โดย paths และ
  verify อ้างอิงจาก root ของ repository นั้น ซึ่งเป็นที่ที่ verify รัน
- external operation เมื่อต้องใช้อำนาจภายนอก
- Grounding v3 สำหรับมติสำคัญที่ derive ไม่ได้

Prototype ไม่ใช่ proof เอกสาร integration ที่หายหรือไม่ระบุเวอร์ชันเป็น boundary
ให้ค้นคว้าหรือถามผู้ใช้ ไม่ใช่สิทธิ์ให้เดา สำหรับ `MODIFIED` compiler จะอ่าน
canonical spec แล้ว merge scenario เดิมให้ครบก่อนเพิ่มหรือแก้ ส่วน `REMOVED`
ต้องมีผลด้าน migration diagram, prototype selection หรือเอกสาร integration แบบ
local ต้อง resolve เป็นไฟล์ปกติภายใน project; directory และ symlink ที่หนีออกไปจะ
ถูกปฏิเสธ ส่วน remote source ต้องใช้ HTTPS และ version แบบคงที่ ไม่ใช่ `latest`
หรือชื่อ branch

## Artifact แบบ conditional และ source of truth

Rapid มี `proposal.md`, `tasks.md`, `evidence.yaml` และ delta
`specs/<capability>/spec.md` แบบกระชับที่ render แบบเดียวกับ standard ซึ่ง Land จะ merge
เข้า `openspec/specs` มีเพียง rapid packet แบบเดิม หรืองานที่ประกาศว่าเป็นเอกสารล้วน
(`workType: ["docs"]` ที่เพิ่ม requirement) ซึ่งประกาศ `skip_specs` ที่ไม่มี delta
ถ้อยคำใน README จึงไม่กลายเป็น requirement ที่มีชีวิต
ทุก proposal เริ่มด้วย header ที่ harness สร้างให้ (id, lane พร้อมเหตุผล, owner,
วันที่สร้าง, status) และระบุ scope, ตาราง acceptance traceability (requirement,
scenario, task, evidence, ไฟล์ทดสอบ) กับ definition of done ที่สร้างจาก policy ที่บังคับใช้จริง
พร้อม `successMeasure` หนึ่งบรรทัดแบบไม่บังคับ task อยู่ใน `tasks.md` เท่านั้น
ส่วน folder tree ที่สร้างให้ (path ที่ยังไม่มีใน base ถูกทำเครื่องหมาย `+`)
อยู่ใน file map ของ `design.md` Proposal ของ rapid คือ dev document แบบกระชับ:
summary, user flow, failure matrix และ decisions ของมัน change เดิมคง layout เก่าไว้และยังอ่านได้
section เชิงบรรยาย (`fileMap`, `testMap`, `componentMap`,
`userFlow`, `configContract`, `refactor`) ก็ render ที่นี่ และไม่ทำให้ change
ความเสี่ยงต่ำย้ายไป standard ส่วน standard v4 หรือ v5 มี `design.md` ที่เป็น dev document
เต็มเสมอ และระบุชนิดงานพร้อมบอกเมื่อเป็นค่าที่อนุมาน label ของ node ใน flowchart
ที่มี `(`, `)` หรือ `"` ต้องใส่เครื่องหมายคำพูด เช่น `A["mean(values)"]` ไฟล์
execution, repository, handoff และ grounding จะเกิดเมื่อมี override จริงเท่านั้น

ตอน archive Land ต่อท้าย record ที่เปลี่ยนแปลงได้ไว้ใน `proposal.md` ที่ archive แล้วเท่านั้น:
Appendix: Review record, Appendix: Compliance change record (เฉพาะเมื่อ
`openspec/config.yaml` ตั้ง `compliance: change-record`) และ Appendix: Rollout gates

หลัง compile แล้ว `openspec/changes/<id>/` คือ source of truth Draft เป็นข้อมูล
ชั่วคราว และ `.foundation/` เป็น runtime state ที่ derive ได้

รัน `change start <draft.json>` ถ้า draft ครบ harness จะตรวจ compile และเริ่ม
change ในคำสั่งเดียว และแสดงรายชื่อไฟล์ใน packet กับ task ถ้ายังไม่ครบจะคืน action
เดียวพร้อม resume route โดยไม่สร้างอะไร: `EDIT` สำหรับการค้นข้อเท็จจริงหรือซ่อม
draft หรือ `ASK_USER` สำหรับ decision ที่เชื่อมกับ coverage ไม่เกินสามข้อ ใช้
`--inspect` เมื่อต้องการตรวจอย่างเดียว และบันทึกการอนุมัติ spec ของผู้ใช้ด้วย
`advance <change> --approve-spec --decision-ref <ref>` หรือเพิ่ม
`--approve-spec --decision-ref <ref>` ในคำสั่ง `change start`, `change revise` หรือ
`change amend` ที่ apply คำตอบอนุมัตินั้น Open question ของ design จะแสดงพร้อม
approval packet การ inspect ครั้งแรกยังคืน task `verify` ที่อ้างไฟล์ test ซึ่งไม่มีอยู่
และไม่อยู่ใน `paths` ของ task ใด และ error ใน `apiContracts` ที่ไม่มี status หรือ code
เป็นงานซ่อมของ agent
ใช้ `riskSignals` แบบ typed สำหรับ access control, persisted data, integration,
performance SLO, UI, operational risk, external side effect และผลทางการเงิน
(`financial`) เพื่อให้ coverage ที่บังคับใช้ไม่ขึ้นกับภาษาของ prose เมื่อมี
`access-control` ให้ติด `access: allow` และ `access: deny` ใน scenario อย่างน้อย
อย่างละหนึ่ง `constraints` (ถ้ามี) แสดงใน proposal และ `fixes` (ถ้ามี) ระบุ change
ที่ archive แล้วซึ่ง change นี้แก้ Harness บันทึก source digest เอง draft ที่ถูกต้องจึงได้
`DONE` ตั้งแต่ inspect ครั้งแรก และ warning ของ design กับ reader guide เป็นเพียงคำแนะนำ
การ inspect เก็บ snapshot ที่ harness เป็นเจ้าของเพียงชุดเดียว โดยผูก digest ของ
draft และ local sources ก่อน inspect repository intelligence แบบ bounded จะ
จัดอันดับ spec, test, caller, integration, persistence และ permission boundary
โดยปรับ read budget จาก typed risk กับสัญญาณของ repository แต่ไม่ลดมิติที่บังคับ
คำถามที่ source ตอบได้ ตัวเลือกซ้ำ และ recommendation ที่ไม่มีหลักฐานจะถูกปฏิเสธ
เมื่อ source เปลี่ยนจะคืน `refresh-source-coverage`; snapshot เก็บ effectiveness
metrics แบบย่อแต่ไม่เก็บ transcript

## แก้ข้อตกลงก่อน Build

ถ้าต้องแก้ change ที่ agreed แล้วแต่ยังไม่เริ่ม Build ให้ revise change เดิมแทนการ
abandon:

```bash
claude-foundation change revise <change> <draft.json>
```

Draft ฉบับแก้ใช้ id เดิมและผ่าน intake gate เดียวกับ `change start` ในคำสั่งเดียว
ถ้า intake ยังไม่ครบจะแสดง action และไม่เปลี่ยนอะไร ถ้าใส่ `--merge` ไฟล์จะมีเฉพาะ key
และ entry แบบมี key ที่เปลี่ยน เพิ่ม หรือลบ (`"$remove": true`) Packet ทั้งชุด
ถูกคอมไพล์ใหม่แบบ transaction, contract revision เพิ่มขึ้น และถ้าล้มเหลวจะคืน
packet กับ runtime state เดิม เมื่อ Build มี workspace, receipt หรือ task ที่เสร็จแล้ว
คำสั่งจะชี้ไปที่ `change amend` ผลลัพธ์แสดง requirement ที่ added, revised และ
removed change ที่ approve แล้วใช้ approval เดิมต่อสำหรับ delta ที่เพิ่มหรือแก้
requirement และขอ approve ใหม่เฉพาะ delta ที่ลบ requirement

## แก้ข้อตกลงระหว่าง Build

ถ้า Build พบ observable requirement ใหม่หรือที่เปลี่ยนไป ให้ใช้ semantic amendment
หนึ่งชุด `reviseRequirements` แทน requirement เดิม (ต้องมี task ที่ยังไม่เสร็จครอบคลุม)
และ `removeRequirements` ลบ requirement พร้อม `migration`:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

มันรักษา task ที่เสร็จแล้ว prose/diagram/section ที่ไม่เกี่ยวข้อง เพิ่ม link แบบ
stable เพิ่ม revision แล้ว validate ทั้งชุด หากล้มเหลวจะ rollback Change เก่ายังใช้
manual path เดิมได้ Existing task เพิ่ม claim coverage ได้ แต่ถ้าจะเปลี่ยน outcome
ต้องเพิ่ม task ใหม่ ส่วน verify command ของ task ที่เสร็จแล้วเปลี่ยนได้เฉพาะด้วย
`reopen: true` ซึ่งเอาเครื่องหมายเสร็จออกให้ต้องผ่านใหม่ ถ้าจะแก้ verify command
ของ task ที่ยังไม่เสร็จ ให้ส่งเฉพาะ `updateTasks: [{"key", "verify", "paths"?}]`
โดยไม่ต้องมี requirement, evidence หรือ intake และ Prove จะ rerun evidence ของ task
นั้น `change amend --template` แสดงทั้งสองรูปแบบ Amendment ของ agreement v4 ต้องมี
discovery coverage สำหรับ requirement ที่เพิ่ม และ compiler จะต่อ delta ที่ผ่าน
validation เข้า `proposal.md` ก่อน mutation harness จะบันทึก claim, task และ
provider dependency closure ที่ได้รับผลไว้เป็น bounded input สำหรับ proof scheduling
Receipt ที่ผ่านและไม่ affected จะคงไว้เฉพาะเมื่อ declared provider, claim และ input
fingerprint ตรงครบ ส่วน binding ที่ affected หรือคลุมเครือต้อง rerun ผ่าน Prove route

`/change` ที่สำเร็จ validate และแยก workspace แล้ว ทำต่อด้วย
`claude-foundation advance <change> --through build`
