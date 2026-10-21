---
title: ไฟล์ ผู้อ่าน และเจ้าของข้อมูล
description: อะไรให้ผู้ใช้ตรวจ อะไรเป็นของโปรเจกต์ และอะไรที่ agent หรือ harness ดูแล
---

<!-- docs-audience: users -->
**ผู้อ่าน:** ผู้ใช้โปรเจกต์ หน้านี้อธิบายสิ่งที่ต้องตรวจและตัดสินใจ ส่วน agent ดูแลขั้นตอนระบบตามปกติ

Change Loop เพิ่มไฟล์เข้าไปใน repository ของคุณ หน้านี้บอกว่าไฟล์ไหนเป็นของคุณและต้องตรวจ
ไฟล์ไหน Change Loop เขียนทับตอน upgrade ไฟล์ไหน harness เขียนระหว่างทำงาน และไฟล์ไหนไม่ควรแตะ
คุณตรวจเจตนาและผลลัพธ์ โดยไม่ต้องดูแลสถานะภายในด้วยตัวเอง

## ไฟล์ไหนเป็นของฉัน?

| กลุ่ม | ไฟล์ | สิ่งที่คุณทำ |
|---|---|---|
| **ของคุณ** (commit ไว้ และ upgrade ไม่ทับ) | `openspec/specs/`, `openspec/changes/`, `openspec/investigations/`, `foundation.json`, `openspec/config.yaml`, `openspec/repositories.yaml`, `quality/`, `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` | ตรวจและตัดสินใจ ให้ agent แก้ข้อตกลงผ่าน workflow ที่รองรับ |
| **Installer ดูแล** (ถูกแทนที่ตอน upgrade) | `.claude/orchestrator.md`, `.claude/commands`, `.claude/harness`, `.claude/skills`, `.claude/rules`, `.claude/hooks`, `openspec/schemas`, `WORKFLOW.md`, `.foundation/.gitignore`, `.foundation/README.md` | อ่านเป็นข้อมูลอ้างอิง ปรับผ่าน config ของโปรเจกต์ ไม่ใช่แก้ไฟล์เหล่านี้ |
| **Harness สร้างขึ้น** (Git ignore) | `.foundation/runtime/`, `receipts/`, `evidence/`, `transactions/`, `logs/` | อ่านเพื่อวิเคราะห์ได้ แต่ห้ามแก้เพื่อเปลี่ยนผลตรวจ และอย่าถือว่าลบทิ้งได้ |
| **ไฟล์ระหว่างทำงาน** | `.foundation/drafts/`, โค้ดใน `.foundation/sandboxes/` | Agent เป็นผู้เขียน คุณตรวจข้อตกลงที่ compile แล้วและ diff สุดท้าย |

![สามคอลัมน์แสดงไฟล์ที่เป็นของคุณ ไฟล์ที่ Change Loop ติดตั้งและเขียนทับ และไฟล์ที่ harness สร้างขึ้น](/docs/diagrams/artifacts-th.svg)

```text
your-project/
├── foundation.json          ของคุณ     นโยบาย: budget, model, review, setup
├── CLAUDE.md, AGENTS.md     ของคุณ     คำแนะนำของโปรเจกต์
├── quality/                 ของคุณ     config ของ quality gate (ถ้าเปิดใช้)
├── WORKFLOW.md              MANAGED    เอกสารอ้างอิง lifecycle
├── .claude/                 MANAGED    harness, commands, skills, rules, hooks
│                                       (settings.json ของโปรเจกต์ยังเป็นของคุณ)
├── openspec/
│   ├── specs/               ของคุณ     สิ่งที่ระบบซึ่ง land แล้วต้องทำได้
│   ├── changes/<id>/        ของคุณ     ข้อตกลงของ change ที่กำลังทำ
│   ├── investigations/      ของคุณ     สิ่งที่ค้นพบจาก /investigate
│   └── schemas/             MANAGED    ถูกเขียนทับทุกครั้งที่ติดตั้ง
└── .foundation/             GENERATED  runtime state, receipt, evidence,
                                        sandbox (อาจมีโค้ดที่ยังไม่ land)
```

**อย่าลบ `.foundation/` เพื่อเริ่มงานใหม่** การถูก Git ignore ไม่ได้แปลว่าลบได้
ภายในอาจมีโค้ดที่ยังไม่ land ประวัติหลักฐาน journal สำหรับกู้คืน และ backup
ให้ agent ใช้ขั้นตอนกู้คืนหรือ cleanup ที่รองรับ
ไฟล์ของโปรเจกต์ก็ไม่ได้แปลว่าแก้มือได้ระหว่าง change: harness ดูแล link, task ID
และ checkbox ที่สร้างขึ้นเอง ให้ขอ agent revise หรือ amend
ศัพท์อย่าง receipt และ sandbox อธิบายไว้ใน [glossary](/docs/th/glossary/)

## สำหรับ agent และ integrator: รายละเอียด ownership

เจ้าของไฟล์กับผู้อ่านเป็นคนละเรื่อง ข้อตกลงของโปรเจกต์อาจถูก compile โดย harness
และโค้ดของโปรเจกต์อาจเขียนโดย agent

## อะไรเป็นของใคร?

| ประเภท | ตัวอย่าง | หน้าที่ของคุณ | ผู้เขียนและพฤติกรรมตอน upgrade |
|---|---|---|---|
| ข้อตกลงของโปรเจกต์ | `openspec/specs/`, `openspec/changes/`, `openspec/investigations/` | ตรวจพฤติกรรม ขอบเขต การตัดสินใจ และผลลัพธ์ | Agent เขียนข้อมูลต้นทาง; harness compile และปรับ packet; installer เก็บรักษาไว้ |
| การตั้งค่าของโปรเจกต์ | `foundation.json`, `openspec/config.yaml`, `openspec/repositories.yaml`, `quality/` | เลือกนโยบายและให้ agent ช่วยตั้งค่า | Maintainer ของโปรเจกต์หรือ agent ที่ได้รับอนุญาต; installer สร้าง/รวม config ที่รองรับ |
| คำแนะนำของโปรเจกต์ | `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` | เก็บกฎและความต้องการของโปรเจกต์คุณ | Installer ปรับเฉพาะ pointer block ที่มี marker และรวม host settings ที่รองรับ ไม่แทนที่คำแนะนำทั้งไฟล์ |
| ไฟล์ Change Loop ที่ติดตั้ง | `WORKFLOW.md`, `.claude/harness/`, commands/skills/hooks ที่ managed, `openspec/schemas/` | อ่านอ้างอิง; ปรับผ่าน config ของโปรเจกต์ | Change Loop ดูแลและ upgrade ไฟล์ที่ managed |
| บันทึกสถานะระบบ | `.foundation/runtime/`, `receipts/`, `evidence/`, `transactions/` | อ่านวิเคราะห์ได้ แต่อย่าแก้ record เพื่อเปลี่ยนผลตรวจ | Harness และเครื่องมือที่ตั้งค่าไว้เขียนผ่านขั้นตอนที่รองรับ |
| ข้อมูลชั่วคราวและโค้ดที่กำลังทำ | `.foundation/drafts/`, path โค้ด/test ใน sandbox ที่ประกาศไว้ | ตรวจข้อตกลงที่ compile แล้วและ diff สุดท้าย | Agent เขียนข้อมูลต้นทางและ implementation; งานใน sandbox อาจยังไม่ส่งมอบ |

ใน source repository ของ Change Loop ไฟล์ `CLAUDE.md` และ `AGENTS.md` ที่ root
ใช้แนะนำ maintainer แต่ในโปรเจกต์ที่คุณติดตั้ง ไฟล์ชื่อเดียวกันยังเป็นคำแนะนำของ
โปรเจกต์คุณ ส่วน tests, reports และเว็บไซต์เอกสารของ upstream มีไว้พัฒนา
Change Loop ไม่ใช่สิ่งที่ผู้ใช้ต้องทำก่อนใช้งาน

[เอกสาร ownership ของระบบ](https://github.com/Maximumsoft-Co-LTD/claude-foundation/blob/main/.claude/harness/README.md#file-ownership-and-writers)
กำหนดประเภทและผู้เขียนฉบับเต็ม สำเนาที่ติดตั้งอยู่ใน `.claude/harness/README.md`
รายการ `MANAGED` ของ installer และ `.foundation/install-manifest.txt`
เป็นตัวกำหนดความเป็นเจ้าของไฟล์ที่ติดตั้ง

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
| `schemas/` | Change Loop | **ถูกเขียนทับทุกครั้งที่ติดตั้ง** แก้ profile ตรงนี้แล้วอัปเกรดครั้งหน้าจะหายไป |
| `config.yaml` | โปรเจกต์ของคุณ | คัดลอกให้เฉพาะตอนที่ยังไม่มี หลังจากนั้นเป็นของคุณ |
| `repositories.yaml` | โปรเจกต์ของคุณ | คัดลอกให้เฉพาะตอนที่ยังไม่มี หลังจากนั้นเป็นของคุณ |
| `specs/`, `changes/`, `investigations/` | โปรเจกต์ของคุณ | installer ไม่แตะเลย |

`foundation.json` อยู่ที่ root ของ repository ไม่ได้อยู่ใน `openspec/`
เพราะมันเก็บ *นโยบาย* ไม่ใช่เจตนา ได้แก่ budget การรัน เพดานขนาด packet
ระดับของโมเดล เงื่อนไขการยกระดับ การตั้งค่า review diversity กับ independence
และคำสั่ง setup ของ sandbox (`sandbox.setupCommand`) ที่รันหนึ่งครั้งในทุก
workspace ของ Build ที่สร้างใหม่
มันถูกสร้างให้ตอนยังไม่มีและยังเป็นของโปรเจกต์ การ upgrade อาจเติม field ที่ขาด
หรือย้ายค่า default เก่าที่รู้จัก โดยรักษานโยบายที่คุณปรับเอง

ดู field, ค่าเริ่มต้น และนโยบาย review ใน
[ตั้งค่า foundation.json](/docs/th/foundation-config/)
หน้านี้อธิบายความเป็นเจ้าของโดยไม่ทำสำเนาค่า default อีกชุด

Consumer quality เพิ่ม tree ที่ commit และเป็นของโปรเจกต์อีกหนึ่งชุด:

```text
quality/
├── foundation-quality.json       profile, provider, threshold และ exception แยก repository
└── baselines/
    ├── manifest.json             decision reference และ provenance ของ baseline
    └── <repository>/             versioned CRAP และ mutation report
```

`quality init` จะ preview config ก่อนเขียนเสมอ ส่วน baseline ไม่ถูกสร้างเงียบ ๆ:
`quality baseline --write` ต้องมีทั้ง decision reference และเหตุผล ดูรายละเอียดที่
[Quality gate ของโปรเจกต์](/docs/th/consumer-quality/)

:::caution[มีไฟล์ชื่อ `repositories.yaml` สองตัว]
`openspec/repositories.yaml` อธิบายโครงสร้าง repository ของทั้งโปรเจกต์
ส่วน `openspec/changes/<id>/repositories.yaml` อธิบายว่า **change ตัวนั้น**
แตะ repository ไหนบ้างและในโหมดใดเมื่อมี multi-repository scope ถ้าไม่มีไฟล์ใน
packet semantic default คือ repository เดียวชื่อ `root` สองไฟล์นี้คนละตัวกันแต่ชื่อเหมือนกัน
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
| `proposal.md` | สรุปสั้น ทำไมต้องมี change นี้ user story เกณฑ์ความสำเร็จ ดัชนี capability อะไรเปลี่ยนแบบที่สังเกตได้ impact และสิ่งที่ไม่ทำ โดยมี discovery coverage เป็นภาคผนวก | ทั้งคู่ |
| `tasks.md` | ledger เดียวของการ implement — ที่เดียวที่ติดตามงาน | ทั้งคู่ |
| `evidence.yaml` | สัญญาเชิงพฤติกรรมที่คงที่ — claim ID, scenario, capability | ทั้งคู่ |
| `grounding.yaml` | Semantic v3 เก็บ non-derived material decision; grounding read-set รุ่นเดิมยังอ่านได้ | มีเมื่อมี decision ที่ต้อง lock |
| `execution.yaml` | Custom wiring ที่เปลี่ยนได้ — คำสั่ง provider, service, readiness | มีเมื่อ derived wiring ไม่พอ |
| `repositories.yaml` | การเลือก repository และโหมดการเขียนแบบชัดเจน | มีเมื่อเป็น multi-repository |
| `handoffs.yaml` | Permission-bound external operation และ activation safety | มีเมื่องานแบบนี้มีจริง |
| `.openspec.yaml` | assurance profile ที่ควบคุม packet นี้ | ทั้งคู่ |
| `design.md` | ภาพรวม สมมติฐานและคำถามที่ค้าง blueprint แบบ typed ภาพรวม task, durable decision (รวมคำตอบที่ตกลงระหว่าง intake), diagram, integration, compatibility และความเสี่ยง โดยไม่แสดงหัวข้อที่ว่าง | standard และมีเมื่อมี design context |
| `specs/**/spec.md` | delta ของ requirement — `ADDED`, `MODIFIED`, `REMOVED` | ทั้งคู่ (rapid แบบกระชับ ไม่มีเฉพาะ packet เดิมที่ใช้ `skip_specs`) |

packet แบบ `foundation-rapid` มี spec delta แบบกระชับที่ merge เข้า `openspec/specs`
ตอน Land และปกติไม่มี `design.md` ค่า default ที่ agent เลือกเองแสดงใต้ Decisions
ใน proposal ทันทีที่ impact
สูงกว่า low, coupling ไม่ใช่ isolated แล้ว หรือมีการบังคับ review หรือ acceptance
change จะ **อัปเกรดตัวเองเป็น standard** และสร้าง delta artifact ให้อัตโนมัติ
ส่วน extension อื่นยังสร้างเฉพาะเมื่อมี concern จริง

Agent ไม่ต้องเขียน ID ข้าม ledger ด้วยมือ Semantic draft รุ่นปัจจุบัน compile requirement,
scenario, task, claim และ provider binding เป็น packet นี้ และ OpenSpec packet ที่
compile แล้วคือ source of truth Prototype หรือ diagram ที่เลือกอ้างจาก design ได้
แต่ output ของ prototype ยังไม่ authoritative และถูกปฏิเสธเป็น evidence

ไฟล์เป็นของโปรเจกต์ไม่ได้หมายความว่าควรแก้ด้วยมือระหว่าง change ที่กำลังทำ
ให้ agent ใช้ workflow revise หรือ amend ข้อตกลง ส่วน link, task ID และ checkbox
ที่สร้างโดยระบบให้ harness ดูแล คุณอ่านตรวจได้ แต่ไม่ควรติ๊กงานหรือแก้ field
ที่ระบบสร้างเพื่อข้าม checks

:::tip
`tasks.md` เป็น ledger เดียวโดยตั้งใจ checklist ที่สองที่เก็บไว้ในแชทหรือไฟล์ scratch
ไม่ถูกติดตาม ไม่ถูก validate และไม่ใช่หลักฐาน
:::

## Machine state

บันทึกที่ระบบสร้างถูก Git ignore ส่วน `.gitignore` และ README เป็นไฟล์ผลิตภัณฑ์ที่ติดตั้ง
Draft และโค้ดใน sandbox เป็นข้อมูลที่ agent เขียนได้ตามขอบเขตงาน
ส่วน `.foundation/policy.json` เป็นนโยบาย capability ที่โปรเจกต์กำหนด
ข้อยกเว้นเหล่านี้ไม่ได้อนุญาตให้แก้ receipt หรือ lifecycle state ด้วยมือ

รายการ state ฉบับเต็มอยู่ใน
[Runtime state reference](https://github.com/Maximumsoft-Co-LTD/claude-foundation/blob/main/.claude/harness/README.md#runtime-state)
ซึ่งแยก generated record, cache และข้อมูลระหว่างทำงานพร้อมหน้าที่

หัวข้อถัดไปอธิบายหลักฐานและ archive ที่คุณอาจต้องอ่านตรวจ
ไม่ใช่คำแนะนำให้แก้ runtime file

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

ledger ของรอบ review เป็น hash chain ถ้าลิงก์ขาด ระบบจะไม่ถือว่าเป็นประวัติว่าง แต่ harness จะย้าย ledger ไปไว้เป็น `review-attempts.corrupt-<stamp>` แล้วสร้างใหม่เองโดยไม่ถามคุณ จำนวนรอบที่สร้างใหม่จะไม่ต่ำกว่าที่มีหลักฐาน และรอบที่ตรวจสอบไม่ผ่านจะนับเป็นรอบ review ที่ใช้ไปแล้ว ไม่ใช่ผลที่นำกลับมาใช้ได้

## Archive

การ land จะย้าย packet ไปที่ `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`
โดยไฟล์ยังครบเหมือนเดิม แล้วรวม delta ของ requirement เข้าไปใน spec ถาวรที่
`openspec/specs/<capability>/spec.md`

การรวมนี้ถูกตรวจสอบ ไม่ใช่เชื่อไปเลย Change Loop จะคำนวณสถานะก่อน หลัง และ delta
ใหม่อีกครั้ง แล้วบล็อกการ land ถ้า spec ที่ archive ไม่ตรงกับที่ delta บอกว่าจะได้

## artifact ที่ตั้งใจไม่ให้เป็นหลักฐาน

ผลลัพธ์สองแบบมีไว้ช่วยให้คุณคิด และทั้งคู่อ้างเป็นหลักฐานไม่ได้

**Prototype** ที่เขียนลง `.foundation/prototypes/<id>/` ระหว่างการ investigate
แบบเปรียบเทียบ ถูกปฏิเสธอย่างชัดเจนไม่ให้เป็น artifact หรือ reference ของหลักฐาน
prototype พิสูจน์ว่าแนวทางนั้นเป็นไปได้ ไม่ได้พิสูจน์ว่า code ที่จะ ship ทำงานได้

**Investigation record** ที่ `openspec/investigations/<id>.json` เก็บ fact,
hypothesis, decision และ conclusion ที่ผูก source ส่วน note ที่
`openspec/investigations/<name>.md` เป็น narrative เสริม Machine state และ
handoff digest อยู่ใต้ `.foundation/investigations/` และเป็น derived state
record กับ note ของโปรเจกต์ถูก commit และรีวิวได้
และมันมีลำดับความสำคัญ **ต่ำกว่า** spec และ code เมื่อทั้งสามขัดกัน
เพราะ note บันทึกสิ่งที่เชื่อ ณ ตอนนั้น ไม่ใช่สิ่งที่จริงตอนนี้

:::caution
อย่าชี้ evidence provider ไปที่ไดเรกทอรี prototype หรือ investigation note
หลักฐานต้องมาจาก code ที่จะ ship จริงเท่านั้น
:::

## Telemetry

ทุกคำสั่งจะเขียนแถวหนึ่งลง `.foundation/logs/<change-id>/operations.jsonl`
พร้อมกับ context event และบันทึก phase context คำสั่ง `telemetry`
รายงานยอดรวม ประมาณการ token และ percentile ของระยะเวลาแยกตามชนิด รวมทั้ง
เวลาเข้าคิว การใช้ผลเดิม จำนวน node ที่รัน และ concurrency สูงสุดของ scheduler

การนับนี้แยก *unknown* ออกจาก *zero* โดยตั้งใจ การรันที่วัดต้นทุนไม่ได้
จะถูกรายงานว่าวัดไม่ได้ ไม่ใช่ว่าฟรี
