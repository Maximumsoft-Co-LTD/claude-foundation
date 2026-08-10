---
title: Foundation เขียนอะไรบ้าง
description: artifact ทุกตัวที่ harness สร้าง — change packet, machine state, evidence vault และ archive — และตัวไหนที่ตั้งใจให้คุณอ่าน
---

Foundation เขียนลงสองที่ และการแยกนี้คือหัวใจทั้งหมด

**`openspec/` เป็นของคุณ** เก็บเจตนาที่ต้องคงอยู่ ผ่านการรีวิวโดยคน และ commit ลง Git
**`.foundation/` เป็นของเครื่อง** เก็บ lifecycle state, receipt, log และ proof bundle
ถูก Git ignore และลบทิ้งระหว่าง change ได้อย่างปลอดภัย

ไม่มีอะไรที่ต้องคงอยู่ถูกเก็บไว้แค่ในแชท และไม่มีอะไรที่เครื่องสร้างถูก commit ราวกับว่าคนเขียน

## Change packet

หนึ่งไดเรกทอรีต่อหนึ่ง change ที่กำลังทำงาน อยู่ที่ `openspec/changes/<change-id>/`
นี่คือสิ่งที่ผู้รีวิวอ่าน

| ไฟล์ | เก็บอะไร | Profile |
|---|---|---|
| `proposal.md` | ทำไมต้องมี change นี้ อะไรเปลี่ยนแบบที่สังเกตได้ impact และสิ่งที่ไม่ทำ | ทั้งคู่ |
| `tasks.md` | ledger เดียวของการ implement — ที่เดียวที่ติดตามงาน | ทั้งคู่ |
| `evidence.yaml` | สัญญาเชิงพฤติกรรมที่คงที่ — claim ID, scenario, capability | ทั้งคู่ |
| `execution.yaml` | การต่อสายที่เปลี่ยนได้ — คำสั่ง provider, service, readiness | ทั้งคู่ |
| `repositories.yaml` | โครงสร้าง repository และโหมดการเขียน | ทั้งคู่ |
| `.openspec.yaml` | assurance profile ที่ควบคุม packet นี้ | ทั้งคู่ |
| `design.md` | การตัดสินใจที่สำคัญ ทางเลือกที่ปฏิเสธ compatibility และความเสี่ยง | standard |
| `specs/**/spec.md` | delta ของ requirement — `ADDED`, `MODIFIED`, `REMOVED` | standard |

packet แบบ `foundation-rapid` จะไม่มี `design.md` กับ spec delta ทันทีที่ impact
สูงกว่า low, coupling ไม่ใช่ isolated แล้ว หรือมีการบังคับ review หรือ acceptance
change จะ **อัปเกรดตัวเองเป็น standard** และสร้างสอง artifact นั้นให้อัตโนมัติ

:::tip
`tasks.md` เป็น ledger เดียวโดยตั้งใจ checklist ที่สองที่เก็บไว้ในแชทหรือไฟล์ scratch
ไม่ถูกติดตาม ไม่ถูก validate และไม่ใช่หลักฐาน
:::

## Machine state

ทุกอย่างใต้ `.foundation/` ถูกสร้างขึ้นมา ไฟล์ `.gitignore` ของมันเป็นแบบ allow-list
คือ ignore `*` แล้วเปิดรับกลับเฉพาะ `.gitignore` กับ `README.md` เท่านั้น
machine state จึงหลุดเข้า commit โดยบังเอิญไม่ได้

| Path | เก็บอะไร |
|---|---|
| `runtime/` | lifecycle state หนึ่งไฟล์ต่อหนึ่ง change |
| `receipts/` | receipt ที่ใช้งานอยู่ และ `proof.json` |
| `evidence/` | proof bundle ที่แก้ไม่ได้ และ ledger ของรอบ review |
| `snapshots/` | ตัวบอก snapshot ของ workspace หนึ่งตัวต่อหนึ่ง proof |
| `logs/` | log ของ provider, telemetry, audit การใช้ receipt ซ้ำและ budget |
| `sandboxes/` | control sandbox — เป็น Git worktree หรือสำเนา |
| `repository-sandboxes/` | sandbox แยกต่อ repository สำหรับงานหลาย repository |
| `plans/` | แผนการทำงานของ agent |
| `leases/` | lease ของ task และ resource |
| `transactions/` | journal ของการ apply ตอน Land และไฟล์สำรอง |
| `authority/` | คำขอ review และ acceptance พร้อมบันทึกผล |
| `attestations/` | challenge สำหรับการรันแบบไม่มีคนดู และ nonce ที่ใช้ไปแล้ว |
| `instruction-manifests/` | ที่มาของคำสั่งแต่ละคำสั่ง |
| `recovery/` | change ที่ถูกยกเลิกและ state ที่กำพร้า |
| `prototypes/` | prototype สำหรับเปรียบเทียบ ใช้แล้วทิ้ง |
| `policy.json` | กฎของโปรเจกต์ที่แม็ป path ไปยัง capability ที่ต้องมี (ไม่บังคับ) |
| `install-manifest.txt` | บันทึกของ installer ว่ามันเป็นเจ้าของไฟล์ไหนบ้าง |

หลายตัวจะปรากฏก็ต่อเมื่อมีอะไรสร้างมันขึ้นมา — `repository-sandboxes/`
ต้องมีงานหลาย repository, `recovery/` ต้องมี change ที่ถูกยกเลิก
ส่วน `policy.json` เป็นของคุณจะเขียนหรือไม่มีก็ได้

## Evidence vault

`receipts/` เก็บ receipt ที่ **ใช้งานอยู่** ของแต่ละ provider ซึ่งถูกเขียนทับทุกครั้งที่ provider นั้นรัน
ส่วน `evidence/` เก็บ **สำเนาที่แก้ไม่ได้** ที่ถ่ายไว้ ณ ตอนที่ proof ถูกปิด

```text
.foundation/evidence/<change-id>/
  <proof-run-id>/
    manifest.json                     proof ที่คัดลอกมาทั้งดุ้น
    receipts/<provider>.json          receipt แต่ละตัว พร้อม sha256 และขนาดไบต์
    artifacts/<provider>/<digest>-<name>   log, report, trace, screenshot
  review-attempts/
    0001-<digest>.json                ledger ของ review แบบ hash chain
```

receipt และ artifact ทุกตัวที่คัดลอกมาถูกผูกด้วย **SHA-256 และขนาดไบต์**
คำสั่ง `proof audit` จะอ่านซ้ำและ fail ถ้าค่าใดค่าหนึ่งเปลี่ยน
artifact ที่อยู่นอก vault ใช้เป็นหลักฐานไม่ได้ นี่คือเหตุผลที่ report สำคัญถูกคัดลอกเข้ามา
แทนที่จะอ้างอิงไปยังที่ที่มันถูกสร้าง

ledger ของรอบ review เป็น hash chain ถ้าลิงก์ขาด ระบบจะ fail แบบปิดประตู
ไม่ใช่ตีความว่าเป็นประวัติว่างเปล่า

## Archive

การ land จะย้าย packet ไปที่ `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`
โดยไฟล์ยังครบเหมือนเดิม แล้วรวม delta ของ requirement เข้าไปใน spec ถาวรที่
`openspec/specs/<capability>/spec.md`

การรวมนี้ถูกตรวจสอบ ไม่ใช่เชื่อไปเลย Foundation จะคำนวณสถานะก่อน หลัง และ delta
ใหม่อีกครั้ง แล้วบล็อกการ land ถ้า spec ที่ archive ไม่ตรงกับที่ delta บอกว่าจะได้

## artifact ที่ตั้งใจไม่ให้เป็นหลักฐาน

ผลลัพธ์สองแบบมีไว้ช่วยให้คุณคิด และทั้งคู่อ้างเป็นหลักฐานไม่ได้

**Prototype** ที่เขียนลง `.foundation/prototypes/<id>/` ระหว่างการ investigate
แบบเปรียบเทียบ ถูกปฏิเสธอย่างชัดเจนไม่ให้เป็น artifact หรือ reference ของหลักฐาน
prototype พิสูจน์ว่าแนวทางนั้นเป็นไปได้ ไม่ได้พิสูจน์ว่า code ที่จะ ship ทำงานได้

**Investigation note** ที่ `openspec/investigations/<name>.md` คือผลลัพธ์ถาวรของ
`/investigate` เมื่อสิ่งที่ค้นพบต้องอยู่ต่อหลังจบ session มันถูก commit และรีวิวได้
และมันมีลำดับความสำคัญ **ต่ำกว่า** spec และ code เมื่อทั้งสามขัดกัน
เพราะ note บันทึกสิ่งที่เชื่อ ณ ตอนนั้น ไม่ใช่สิ่งที่จริงตอนนี้

:::caution
อย่าชี้ evidence provider ไปที่ไดเรกทอรี prototype หรือ investigation note
หลักฐานต้องมาจาก code ที่จะ ship จริงเท่านั้น
:::

## Telemetry

ทุกคำสั่งจะเขียนแถวหนึ่งลง `.foundation/logs/<change-id>/operations.jsonl`
พร้อมกับ context event และบันทึก phase context คำสั่ง `telemetry`
รายงานยอดรวม ประมาณการ token และ percentile ของระยะเวลาแยกตามชนิด

การนับนี้แยก *unknown* ออกจาก *zero* โดยตั้งใจ การรันที่วัดต้นทุนไม่ได้
จะถูกรายงานว่าวัดไม่ได้ ไม่ใช่ว่าฟรี
