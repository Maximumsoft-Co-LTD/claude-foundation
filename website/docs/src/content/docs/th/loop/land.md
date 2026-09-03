---
title: /land
description: Apply ตรวจ archive และ cleanup change ที่ proven ด้วยอำนาจชัดเจน
---

```text
/land <change>
```

Slash command นี้คือ boundary ที่ให้อำนาจ Land อย่างชัดเจน และรัน:

```bash
claude-foundation advance <change> --through archived
```

Coordinator ตรวจ proof freshness และสถานะ external operation เตรียม apply
transaction ที่กู้คืนได้ apply projection ที่ proven ตรวจ identity ของ target archive
ผ่าน OpenSpec และ cleanup งานจบเมื่อ runtime เป็น `archived`; `proven` ยังไม่จบ

มีเพียง recoverable Land transaction ของ harness ที่ apply product และ sync
agreement ได้ Agent ไม่แก้ไฟล์เหล่านั้นนอก transaction และ Land ไม่ให้อำนาจ
commit, push, publish หรือเปิด PR
อำนาจเหล่านั้นแยกกัน Base ที่ขยับ conflict, transaction ที่ค้าง, permission ที่หาย,
child repository หรือ pre-Land handoff ที่ยังไม่เสร็จจะหยุดด้วย `WAIT`, `REPAIR`,
`RUN_EXTERNAL` หรือ `ASK_USER` พร้อมสาเหตุ actor ทางเลือกปลอดภัย state ที่เก็บไว้
และ resume route ที่แน่นอน

Automatic recovery ที่ปลอดภัยทำได้ภายในอำนาจปัจจุบัน ส่วน transaction recovery,
external delivery record และ multi-repository resume แบบ manual ยังอยู่เป็น primitive
ขั้นสูงใต้ `help --all` Change ที่ archive แล้วจะคืน `DONE` สำเร็จ

Metrics รักษาค่าที่ไม่รู้ไว้ ถ้า host รายงาน usage ไม่ได้ cost เป็น `null` แทนที่จะ
กลายเป็นศูนย์ที่ทำให้เข้าใจผิด
