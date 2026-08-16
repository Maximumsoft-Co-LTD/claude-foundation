---
title: Foundation เขียนอะไรบ้าง
description: artifact ทุกตัวที่ harness สร้าง — change packet, machine state, evidence vault และ archive — และตัวไหนที่ตั้งใจให้คุณอ่าน
---

Foundation เขียนลงสองที่ และการแยกนี้คือหัวใจทั้งหมด

**`openspec/` เป็นของคุณ** เก็บเจตนาที่ต้องคงอยู่ ผ่านการรีวิวโดยคน และ commit ลง Git
**`.foundation/` เป็นของเครื่อง** เก็บ lifecycle state, receipt, log และ proof bundle
ถูก Git ignore และลบทิ้งระหว่าง change ได้อย่างปลอดภัย

ไม่มีอะไรที่ต้องคงอยู่ถูกเก็บไว้แค่ในแชท และไม่มีอะไรที่เครื่องสร้างถูก commit ราวกับว่าคนเขียน

## โครงสร้าง `openspec/`

```text
openspec/
├── config.yaml          config และกฎการเขียนของโปรเจกต์
├── repositories.yaml    โครงสร้าง repository และ CI issuer ของแต่ละตัว
├── specs/               requirement ที่ระบบซึ่ง land แล้วต้องทำได้
├── changes/
│   ├── <change-id>/     change packet ที่กำลังทำงานหนึ่งตัว
│   └── archive/         packet ที่ land แล้ว เรียงตามวันที่
├── investigations/      สิ่งที่ค้นพบจาก /investigate ที่ต้องคงอยู่
└── schemas/             assurance profile สองแบบพร้อม template
```

ความเป็นเจ้าของในโครงสร้างนี้ไม่เหมือนกันทุกตัว และมันคือสิ่งที่ตัดสินว่า
การอัปเกรดจะเขียนทับอะไรได้บ้าง

| Path | เจ้าของ | ตอนติดตั้ง |
|---|---|---|
| `schemas/` | Foundation | **ถูกเขียนทับทุกครั้งที่ติดตั้ง** แก้ profile ตรงนี้แล้วอัปเกรดครั้งหน้าจะหายไป |
| `config.yaml` | โปรเจกต์ของคุณ | คัดลอกให้เฉพาะตอนที่ยังไม่มี หลังจากนั้นเป็นของคุณ |
| `repositories.yaml` | โปรเจกต์ของคุณ | คัดลอกให้เฉพาะตอนที่ยังไม่มี หลังจากนั้นเป็นของคุณ |
| `specs/`, `changes/`, `investigations/` | โปรเจกต์ของคุณ | installer ไม่แตะเลย |

`foundation.json` อยู่ที่ root ของ repository ไม่ได้อยู่ใน `openspec/`
เพราะมันเก็บ *นโยบาย* ไม่ใช่เจตนา ได้แก่ budget การรัน เพดานขนาด packet
ระดับของโมเดล เงื่อนไขการยกระดับ การตั้งค่า review diversity กับ independence
และคำสั่ง setup ของ sandbox (`sandbox.setupCommand`) ที่รันหนึ่งครั้งในทุก
workspace ของ Build ที่สร้างใหม่
มันถูกสร้างให้ตอนยังไม่มี และหลังจากนั้นเป็นของคุณ

นโยบายเริ่มต้นอนุญาต agent ทำงานขนานกันสูงสุดสามตัวและใช้ lease 45 นาที
task packet กับ review packet มีเพดาน 8 KiB, repository packet 12 KiB และ
global packet 16 KiB ส่วน rapid run มีเพดาน 800,000 token กับ 100 request
และ standard run มีเพดาน 1,600,000 token กับ 200 request ตัวเลขเหล่านี้เป็น
ขอบเขตสูงสุดของการรัน ไม่ใช่โควตาที่ต้องใช้ให้หมด

model tier แบ่งตามจุดประสงค์: `fast`/Haiku ใช้กับ inventory, log และงานเอกสาร
เชิงกล; `standard`/Sonnet ใช้กับ implementation, test และ investigation
ที่เจาะจง; `deep`/Opus ใช้กับ architecture, security, migration และ review
reviewer เริ่มต้นคือ Claude Code Opus ใน run แบบ read-only และ ephemeral
โดยมี Codex GPT-5.6 Sol เป็นทางเลือก ค่าเริ่มต้น `independence: "self"` กับ
`diversity: "single-model"` จึงทำงานได้โดยไม่ต้องมี identity หรือ provider
ตัวที่สอง และ receipt จะบันทึก waiver ทั้งคู่ โปรเจกต์ที่ต้องการ separation of
duties สามารถเพิ่ม independence, diversity หรือทั้งคู่เป็น `required` ได้
วงจร review แบบ risk-tiered อนุญาต full review หนึ่งรอบและ delta เพิ่มได้
ไม่เกินหนึ่งรอบเมื่อจำเป็นตามนโยบาย

ดูรายละเอียดทุก field, ช่วงค่าที่ใช้ได้ และ policy recipe พร้อมใช้ได้ที่
[ตั้งค่า foundation.json](/docs/th/foundation-config/)

:::caution[มีไฟล์ชื่อ `repositories.yaml` สองตัว]
`openspec/repositories.yaml` อธิบายโครงสร้าง repository ของทั้งโปรเจกต์
ส่วน `openspec/changes/<id>/repositories.yaml` อธิบายว่า **change ตัวนั้น**
แตะ repository ไหนบ้างและในโหมดใด สองไฟล์นี้คนละตัวกันแต่ชื่อเหมือนกัน
provider ที่อ่านผิดตัวจะกำหนดขอบเขตผิดแบบเงียบ ๆ
:::

`config.yaml` ควรอ่านสักครั้ง มันเก็บ schema เริ่มต้นพร้อมกฎการเขียนที่ทุก change
สืบทอดไป — proposal ต้องระบุอะไร, spec ต้องใช้ชื่อที่คงที่และเขียนแบบ WHEN/THEN,
design บันทึกเฉพาะการตัดสินใจที่จำกัดการ implement หรือการย้อนกลับ
และ `tasks.md` ต้องเป็น ledger เดียว การแก้ไฟล์นี้คือการเปลี่ยนสิ่งที่ harness
เรียกร้องจากทุก change ในอนาคต

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
