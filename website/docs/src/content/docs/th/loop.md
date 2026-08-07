---
title: วงจรการเปลี่ยนแปลง
description: ห้าคำสั่ง เหตุผลที่มันแยกกัน และการย้อนกลับเมื่อความจริงเปลี่ยน
---

workflow ของ Foundation คือห้าคำสั่ง โดยมีหนึ่งตัวเป็นตัวเลือก

```text
Investigate? → Change → Build → Prove → Land
```

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

เมื่อ requirement ขยับ คุณแก้ change ตัวเดิม ไม่ใช่เปิดตัวใหม่ Foundation จะ sync sandbox และทำให้ proof ที่ล้าสมัยใช้ไม่ได้ มีเพียง Land เท่านั้นที่เป็นเส้นที่ข้ามครั้งเดียวอย่างตั้งใจ

## แต่ละขั้น

| ขั้น | คำสั่ง | รับผิดชอบอะไร |
|---|---|---|
| 00 | [`/investigate`](/docs/th/loop/investigate/) | สำรวจแบบอ่านอย่างเดียว **เป็นตัวเลือก** ใช้เมื่อทิศทางไม่ชัดจริง ๆ |
| 01 | [`/change`](/docs/th/loop/change/) | ข้อตกลง: เจตนา delta spec tasks claim ความเสี่ยง และ evidence contract |
| 02 | [`/build`](/docs/th/loop/build/) | การ implement ภายใน worktree ที่แยกออกมา |
| 03 | [`/prove`](/docs/th/loop/prove/) | หลักฐานที่รันได้จริง โดยใช้ receipt ที่ยังใช้ได้ซ้ำ |
| 04 | [`/land`](/docs/th/loop/land/) | transaction ปิดงานอย่างชัดเจน |

ยังมีอีกสองคำสั่งที่อยู่นอกวงจร `/changes` แสดงงานที่ active พร้อม action ถัดไปของแต่ละตัวโดยไม่แก้อะไร ส่วน `/dev` เป็น composition แบบเข้ากันได้ย้อนหลังของ change → build → prove สำหรับผู้เรียกที่มีมาก่อนการแยกคำสั่ง

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
├── design.md
├── tasks.md          # ledger เดียว
├── evidence.yaml     # claim + capability ที่คงที่
├── execution.yaml    # การต่อสาย provider + service
├── repositories.yaml # ขอบเขตการเขียน
└── specs/

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
