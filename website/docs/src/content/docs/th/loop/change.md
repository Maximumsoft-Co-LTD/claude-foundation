---
title: /change
description: Compile semantic draft หนึ่งชุดเป็นข้อตกลง OpenSpec ที่ validate แล้ว
---

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` เปลี่ยน intent ให้เป็นข้อตกลงถาวรที่ทุก phase ถัดไปอ่าน Agent เขียน
semantic draft ขนาดเล็กหนึ่งครั้ง ส่วน Change Loop สร้าง bookkeeping และติดตั้ง
ผลลัพธ์แบบ transaction

## Semantic draft

แกนที่บังคับมีเพียง `version: 3`, `intent`, `requirements`, `tasks` ที่ระบุ
`covers` และ `evidence` ที่ใช้ requirement key เดียวกัน ตัวอย่างโครงสร้างเต็มดูได้
จาก `claude-foundation change start --template`

Agent ใช้ key ที่มีความหมาย Compiler สร้าง claim/task ID ที่ stable และผูก
spec → claim → task → provider ให้อัตโนมัติ รวมปัญหา draft ที่เป็นอิสระทั้งหมดใน
ครั้งเดียวและชี้กลับไปยัง field ต้นทาง ถ้า compile ไม่ผ่านจะไม่เหลือ change
ครึ่งชุด Draft version 1 และ 2 ยังใช้ได้กับ integration เดิม

```bash
claude-foundation change start .foundation/drafts/<id>.json --consume-draft
```

## Extension แบบมีชนิด

เพิ่มเฉพาะเมื่อจำเป็น:

- requirement หลายตัว แยก `capability` และ `operation`
- `decisions` สำหรับมติที่มีผลต่อ implementation
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
ต้องมีผลด้าน migration เอกสาร local ต้องมีจริงใน project และ remote source ต้อง
เป็น URL ที่ระบุ version

## Artifact แบบ conditional และ source of truth

Rapid ปกติมีเพียง `proposal.md`, `tasks.md`, `evidence.yaml` Standard เพิ่ม delta
spec และสร้าง `design.md` เฉพาะเมื่อมีมติหรือบริบทสถาปัตยกรรมที่จำเป็น ไฟล์
execution, repository, handoff และ grounding จะเกิดเมื่อมี override จริงเท่านั้น

หลัง compile แล้ว `openspec/changes/<id>/` คือ source of truth Draft เป็นข้อมูล
ชั่วคราว และ `.foundation/` เป็น runtime state ที่ derive ได้

## แก้ข้อตกลงระหว่าง Build

ถ้า Build พบ observable requirement ใหม่ ให้ใช้ semantic amendment หนึ่งชุด:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

มันรักษา task ที่เสร็จแล้ว prose/diagram/section ที่ไม่เกี่ยวข้อง เพิ่ม link แบบ
stable เพิ่ม revision แล้ว validate ทั้งชุด หากล้มเหลวจะ rollback Change เก่ายังใช้
manual path เดิมได้

`/change` ที่สำเร็จ validate และแยก workspace แล้ว ทำต่อด้วย
`claude-foundation advance <change> --through build`
