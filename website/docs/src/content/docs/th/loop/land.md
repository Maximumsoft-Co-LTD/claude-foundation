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
ผ่าน OpenSpec และ cleanup ทุก writable repository ได้ diff แบบยังไม่ commit โดย
HEAD และ index ไม่เปลี่ยน งานจบเมื่อ runtime เป็น `archived`; `proven` ยังไม่จบ

มีเพียง recoverable Land transaction ของ harness ที่ apply product และ sync
agreement ได้ Agent ไม่แก้ไฟล์เหล่านั้นนอก transaction และ Land ไม่ให้อำนาจ
commit, push, publish หรือเปิด PR ระหว่างที่ Land ยัง active phase guard จะปฏิเสธ
คำสั่ง shell เหล่านี้ เว้นแต่เป็น child ของ runtime transaction ที่มี marker หลัง
archive แล้วจึงส่งมอบผ่าน process ปกติของ project ด้วยอำนาจแยกต่างหาก Base ที่ขยับ
conflict, transaction ที่ค้าง, external owner ที่ยังใช้ไม่ได้,
child repository หรือ pre-Land handoff ที่ยังไม่เสร็จจะหยุดด้วย `WAIT`, `REPAIR`,
`RUN_EXTERNAL` หรือ `ASK_USER` พร้อมสาเหตุ actor ทางเลือกปลอดภัย state ที่เก็บไว้
และ resume route ที่แน่นอน

Automatic recovery ที่ปลอดภัย รวมทั้ง host-permission integration และ journal
resume ทำได้ภายในอำนาจปัจจุบัน ส่วน external delivery record และ legacy
transaction diagnostic ยังอยู่เป็น primitive ขั้นสูงใต้ `help --all` แต่ไม่ใช่
ขั้นที่ user ต้องทำ Change ที่ archive แล้วจะคืน `DONE` สำเร็จ

Metrics รักษาค่าที่ไม่รู้ไว้ ถ้า host รายงาน usage ไม่ได้ cost เป็น `null` แทนที่จะ
กลายเป็นศูนย์ที่ทำให้เข้าใจผิด
