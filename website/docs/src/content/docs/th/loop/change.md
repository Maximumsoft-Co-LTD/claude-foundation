---
title: /change
description: Compile semantic draft หนึ่งชุดเป็นข้อตกลง OpenSpec ที่ validate แล้ว
---

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` เปลี่ยน intent ให้เป็นข้อตกลงถาวรที่ทุก phase ถัดไปอ่าน Agent ตีความ
source และเขียน semantic draft ส่วน Change Loop derive มิติการค้น requirement
ตามความเสี่ยง ตรวจ decision frontier สร้าง bookkeeping และติดตั้งผลลัพธ์แบบ
transaction

## Semantic draft

แกนใช้ `version: 4`, `intent`, `requirements`, `tasks` ที่ระบุ `covers`,
`evidence` ที่ใช้ requirement key เดียวกัน และ `discovery.coverage` ซึ่งระบุว่า
แต่ละมิติถูก cover, ไม่เกี่ยวข้องพร้อมเหตุผล, ต้อง investigate หรือต้องถามผู้ใช้
ตัวอย่างโครงสร้างเต็มดูได้
จาก `claude-foundation change start --template`

Agent ใช้ key ที่มีความหมาย Compiler สร้าง claim/task ID ที่ stable และผูก
spec → claim → task → provider ให้อัตโนมัติ รวมปัญหา draft ที่เป็นอิสระทั้งหมดใน
ครั้งเดียวและชี้กลับไปยัง field ต้นทาง Harness จะปฏิเสธ coverage ที่ยังไม่จบ
ตรวจ dependency cycle และเปิดเฉพาะ frontier ที่พร้อมครั้งละไม่เกินสาม decision
ถ้า compile ไม่ผ่านจะไม่เหลือ change ครึ่งชุด Draft version 1 ถึง 3 ยังใช้ได้กับ
integration เดิม

```bash
claude-foundation change start .foundation/drafts/<id>.json --consume-draft
```

## Extension แบบมีชนิด

เพิ่มเฉพาะเมื่อจำเป็น:

- requirement หลายตัว แยก `capability` และ `operation`
- `workType` (list เช่น `["feature", "api", "ui"]`) และ design blueprint ที่
  workType เลือก: `fileMap`, `failureMatrix`, `testMap` และ `apiContracts`,
  `dataModel`, `uiStates`, `configContract`, `jobContract`, `bugfix` หรือ
  `refactor` ถ้าขาดจะเป็น design warning ที่ไม่บล็อก เช่นเดียวกับ task ที่เทสของตัวเอง
  อยู่นอก `paths`
- `decisions` สำหรับมติที่มีผลต่อ implementation พร้อมผลที่ตามมา
- diagram แบบ Mermaid หรืออ้าง SVG/PNG
- `prototypeSelection` ที่ชี้ไป selection note ที่มีจริง
- `integrations` พร้อมแหล่ง/เวอร์ชันเอกสาร requirement ที่เกี่ยวข้อง และ concern
  ด้าน security, resilience, compatibility โดย scenario ที่เกี่ยวข้องต้องระบุ
  `"kind": "success"` และ `"kind": "failure"`
- repository เมื่อแตะหลาย repo
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

Rapid ปกติมีเพียง `proposal.md`, `tasks.md`, `evidence.yaml` Standard เพิ่ม delta
spec และสร้าง `design.md` เฉพาะเมื่อมีมติหรือบริบทสถาปัตยกรรมที่จำเป็น ไฟล์
execution, repository, handoff และ grounding จะเกิดเมื่อมี override จริงเท่านั้น

หลัง compile แล้ว `openspec/changes/<id>/` คือ source of truth Draft เป็นข้อมูล
ชั่วคราว และ `.foundation/` เป็น runtime state ที่ derive ได้

ก่อน compile ให้ใช้ `change start <draft.json> --inspect` Harness จะคืน action
เดียวพร้อม resume route: `EDIT` สำหรับการค้นข้อเท็จจริงหรือซ่อม draft,
`ASK_USER` สำหรับ decision ที่เชื่อมกับ coverage และพร้อมถามไม่เกินสามข้อ หรือ
`DONE` เมื่อพร้อม compile จากนั้นจึงรันไฟล์เดิมด้วย `--consume-draft`
ใช้ `riskSignals` แบบ typed สำหรับ access control, persisted data, integration,
performance SLO, UI, operational risk และ external side effect เพื่อให้ coverage
ที่บังคับใช้ไม่ขึ้นกับภาษาของ prose
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
claude-foundation change revise <change> <draft.json> --inspect
claude-foundation change revise <change> <draft.json> --consume-draft
```

Draft ฉบับแก้ใช้ id เดิมและผ่าน intake gate เดียวกับ `change start` Packet ทั้งชุด
ถูกคอมไพล์ใหม่แบบ transaction, contract revision เพิ่มขึ้น และถ้าล้มเหลวจะคืน
packet กับ runtime state เดิม เมื่อ Build มี workspace, receipt หรือ task ที่เสร็จแล้ว
คำสั่งจะชี้ไปที่ `change amend` ผลลัพธ์แสดง requirement ที่ added, revised และ
removed และขอ approve ใหม่เฉพาะ delta นั้น

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
หรือ verify command ต้องเพิ่ม task ใหม่ Amendment ของ agreement v4 ต้องมี
discovery coverage สำหรับ requirement ที่เพิ่ม และ compiler จะต่อ delta ที่ผ่าน
validation เข้า `proposal.md` ก่อน mutation harness จะบันทึก claim, task และ
provider dependency closure ที่ได้รับผลไว้เป็น bounded input สำหรับ proof scheduling
Receipt ที่ผ่านและไม่ affected จะคงไว้เฉพาะเมื่อ declared provider, claim และ input
fingerprint ตรงครบ ส่วน binding ที่ affected หรือคลุมเครือต้อง rerun ผ่าน Prove route

`/change` ที่สำเร็จ validate และแยก workspace แล้ว ทำต่อด้วย
`claude-foundation advance <change> --through build`
