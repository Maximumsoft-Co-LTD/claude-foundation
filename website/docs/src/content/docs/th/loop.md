---
title: วงจรการเปลี่ยนแปลง
description: ห้าคำสั่ง เหตุผลที่มันแยกกัน และการย้อนกลับเมื่อความจริงเปลี่ยน
---

workflow ของ Change Loop คือห้าคำสั่ง โดยมีหนึ่งตัวเป็นตัวเลือก

```text
Investigate? → Change → Build → Prove → Land
```

## ลำดับอ่านที่แนะนำ

ถ้านี่คือ change แรก ให้อ่าน [เริ่มใช้งาน](/docs/th/quickstart/) และลองเส้นทาง
repository เดียวก่อนเปิดหน้าอ้างอิงด้านล่าง ตั้งค่า
[`foundation.json`](/docs/th/foundation-config/) เฉพาะเมื่อโปรเจกต์ต้องเปลี่ยน
model, reviewer, setup command หรือ policy

ถ้า test หรือ change หนึ่งต้องใช้หลาย repository ให้อ่าน
[Workflow หลาย Repository](/docs/th/multi-repository/) เป็นลำดับถัดไป ต้องเข้าใจ
ส่วนนี้ก่อนแบ่ง worker ขนานหรือต่อ evidence ข้าม repository ส่วนหมวด Evidence
อ่านเมื่อต้องประกาศ claim/provider หรือวิเคราะห์ receipt ที่ stale ผู้ใช้ไม่ต้องรู้
protocol ภายในเพื่อใช้งาน loop

## ทำไมต้องเป็นรูปนี้

ดีไซน์รุ่นก่อนเข้ารหัสคุณภาพเป็นลำดับ role และ phase ยาว ๆ — PM, lead, engineer, QA, retro มันรักษาคุณภาพได้จริง แต่ตัว orchestration เองกลับกลืนต้นทุนและเวลาไปเสียเอง เพราะทุกครั้งที่ส่งไม้ผลัดคือการสร้าง context ที่ persona ก่อนหน้ามีอยู่แล้วขึ้นมาใหม่

รูปแบบปัจจุบันแยกแค่สามเรื่อง

- **OpenSpec** เก็บข้อตกลง
- **coding agent** ทำตามข้อตกลง
- **provider แบบ deterministic** พิสูจน์ข้อตกลง

ไม่มีอะไรในสามข้อนี้ที่ต้องใช้การส่งไม้ผลัดระหว่าง persona จึงไม่มี

## นี่ไม่ใช่ waterfall

ลูกศรบอกว่า *อะไรต้องจริงก่อนอะไร* ไม่ได้บอกตารางเวลาแบบทางเดียว Change, Build และ Prove ย้อนกลับได้อิสระ

```text
Change ⇄ Build ⇄ Prove
```

เมื่อ requirement ขยับ คุณแก้ change ตัวเดิม ไม่ใช่เปิดตัวใหม่ Change Loop จะ sync sandbox และทำให้ proof ที่ล้าสมัยใช้ไม่ได้ มีเพียง Land เท่านั้นที่เป็นเส้นที่ข้ามครั้งเดียวอย่างตั้งใจ

## ทุก gate เดินจนจบอย่างไร

คำสั่งของผู้ใช้เหมือนเดิม ส่วน harness จัดการ loop เบื้องหลัง ในแต่ละ gate ระบบ
ตรวจ finding ที่เป็นอิสระทั้งหมดหนึ่งครั้ง แล้วรวมเป็นแผนแก้ตามลำดับ dependency
Agent แก้สิ่งที่ปลอดภัยและอยู่ใน contract เป็น batch ส่วน harness รันซ้ำเฉพาะ check ที่ input
เปลี่ยน ระบบทำต่อได้ตราบใดที่งานยังมี progress โดยไม่จำกัดจำนวนรอบแก้ product

ระบบจะพักเฉพาะเมื่อเลือกแทนผู้ใช้ไม่ได้อย่างปลอดภัย เช่น ต้องใช้อำนาจภายนอก
ชน resource หรือ budget เกิด conflict requirement ขัดกัน หรือไม่มี progress ซ้ำ
state เดิมจะถูกเก็บไว้ พร้อมตัวเลือกและทาง resume ที่แน่นอน การเรียกซ้ำบน wait
เดิมจะไม่ poll หรือเสีย model request เพิ่ม

Slash command เรียก coordinator สำหรับ model เพียงตัวเดียว `/build`, `/prove`
และ `/land` ใช้ `advance <change> --through build|proven|archived` ส่วน `/dev`
compose target ชุดเดียวกัน Coordinator คืนเพียง `EDIT`, `RUN_EXTERNAL`, `REPAIR`,
`WAIT`, `ASK_USER` หรือ `DONE` พร้อม exact resume route เมื่อหยุด Primitive เดิม
ยังอยู่ใต้ `help --all` สำหรับ operator และ host integration

## แต่ละขั้น

| ขั้น | คำสั่ง | รับผิดชอบอะไร |
|---|---|---|
| 00 | [`/investigate`](/docs/th/loop/investigate/) | สำรวจแบบอ่านอย่างเดียว **เป็นตัวเลือก** ใช้เมื่อทิศทางไม่ชัดจริง ๆ |
| 01 | [`/change`](/docs/th/loop/change/) | ข้อตกลง: เจตนา delta spec tasks claim ความเสี่ยง และ evidence contract |
| 02 | [`/build`](/docs/th/loop/build/) | การ implement ภายใน worktree ที่แยกออกมา |
| 03 | [`/prove`](/docs/th/loop/prove/) | หลักฐานที่รันได้จริง โดยใช้ receipt ที่ยังใช้ได้ซ้ำ |
| 04 | [`/land`](/docs/th/loop/land/) | transaction ปิดงานอย่างชัดเจน |

ยังมีอีกสองคำสั่งที่อยู่นอกวงจร `/changes` แสดงงานที่ active พร้อม action ถัดไปของแต่ละตัวโดยไม่แก้อะไร ส่วน `/dev` เป็น composition แบบเข้ากันได้ย้อนหลังของ Change → Build → Prove และจะรวม Land เฉพาะเมื่อ invocation มีอำนาจ Land ชัดเจนอยู่แล้ว โดย success ของ lane นั้นต้องเป็น `archived`

## ความเข้มมาจากความเสี่ยง ไม่ใช่ขนาด

`/change` จะประเมินคุณสมบัติไม่กี่อย่าง แล้วใช้มันตัดสินว่าต้องใช้กระบวนการหนักแค่ไหน

- **impact** — low, medium, high
- **coupling** — isolated หรือ coupled
- **security trigger** — จับแบบทั้งคำ ดังนั้น `access` จึงไม่ไปโดน "accessibility" อีกแล้ว ขณะที่ "sign in with a passkey" จะถูกจับได้
- **evidence capability** — อะไรที่พิสูจน์ claim ได้จริง
- **size** — ใช้กับงบและการแบ่งงาน *เท่านั้น*

บรรทัดสุดท้ายสำคัญที่สุด ขนาดไม่เคยลดคุณภาพลง เพราะ change ที่ดูถูกที่สุดมักเป็นตัวที่ข้าม trust boundary พอดี

## state อยู่ที่ไหน

เจตนาที่ต้องคงอยู่เก็บใน OpenSpec ส่วน state ของเครื่องเก็บใน `.foundation/` ไม่มีอะไรสำคัญอยู่ในบทสนทนา ซึ่งเป็นเหตุผลที่ session ใหม่หยิบงานต่อจากไฟล์ได้

```text
openspec/changes/add-profile-auth/
├── proposal.md
├── tasks.md          # ledger เดียว
├── evidence.yaml     # claim + capability ที่คงที่
├── specs/             # standard lane
├── design.md          # มีเมื่อใช้ decision/diagram/integration/prototype
├── grounding.yaml     # มีเมื่อมี material decision
├── execution.yaml     # มีเมื่อใช้ custom provider + service wiring
├── repositories.yaml  # มีเมื่อประกาศ multi-repository scope
└── handoffs.yaml       # มีเมื่อมี permission-bound operation

.foundation/
├── runtime/          # lifecycle + resolver
├── receipts/         # หลักฐานที่ผูกกับเนื้อหา
├── authority/        # คำขอ review + acceptance
├── transactions/     # journal ของ Land ที่กู้คืนได้
├── logs/             # output ของ provider + event
├── recovery/         # บันทึกของ change ที่ปลดระวาง
└── sandboxes/        # worktree ที่แยกออกมา
```

`.foundation/` เป็นของเครื่องและถูก gitignore ส่วน `openspec/` เป็นของคุณไว้อ่านและรีวิว
OpenSpec packet ที่ compile แล้วคือ source of truth ส่วน semantic input draft กับ
coordinator action เป็น input ของ compiler/runtime ไม่ใช่ requirement ledger คู่ขนาน
