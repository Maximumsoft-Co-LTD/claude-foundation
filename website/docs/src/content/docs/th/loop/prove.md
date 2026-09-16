---
title: /prove
description: ใช้และรัน evidence ที่ผูกกับเนื้อหาจน proven หรือถึง boundary จริง
---

```text
/prove <change>
```

รัน:

```bash
claude-foundation advance <change> --through proven
```

Coordinator ตรวจ agreement/workspace ปัจจุบัน ใช้ receipt ที่ input ยังตรงซ้ำ รัน
provider อิสระที่พร้อมหนึ่งครั้ง ส่ง review ก่อน acceptance สร้าง proof bundle และ
audit ระบบคืน `DONE` เฉพาะเมื่อถึงเป้าหมาย `proven`

Evidence ที่ล้มเหลวคืน `REPAIR` หรือ `EDIT` batch พร้อม claim closure ที่ stale หลัง
แก้จะรันซ้ำเฉพาะ check ที่ invalidated และ downstream Review ที่ตั้งค่าไว้เป็น
`RUN_EXTERNAL` การรอภายนอกที่ผู้ใช้เลือกแล้วเป็น `WAIT` มติด้าน contract หรือ
acceptance เป็น `ASK_USER` ทุก boundary เก็บ state และให้ resume route เดียว การ
เรียกซ้ำบน wait เดิมไม่ poll ไม่รัน evidence ซ้ำ และไม่เสีย model request เพิ่ม

ประวัติ recovery ยังคงอยู่หลังเริ่ม process ใหม่ หากส่งงานซ่อมเดิมสามครั้งโดยไม่
คืบหน้า ระบบจะถามว่าจะทำอย่างไร พร้อมสาเหตุ สิ่งที่ลอง ทางเลือกและคำแนะนำ
Agent บันทึกคำตอบ retry/wait/pause ผ่าน `advance --decision` พร้อม fingerprint
ที่ได้รับ decision reference และเหตุผล Harness resume เป้าหมายเดิมและใช้คำตอบซ้ำ
เมื่อขอบเขตยังไม่เปลี่ยน การรอระบุเจ้าของกับเงื่อนไข ส่วนการพักไม่รัน setup หรือ
provider ต่อ การ retry ไม่ได้ให้อำนาจ waiver เพิ่มงบ หรือ Land

Harness ไม่สร้าง evidence ปลอม ไม่เปลี่ยนค่าที่วัดไม่ได้เป็นศูนย์/pass และไม่ใช้
review prose แทนผล behavior ที่หาย Prototype artifact ใช้เป็น proof ไม่ได้ Claim
ของ integration อาจบังคับ security, compatibility, resilience และ signed external
evidence ตาม agreement

`proof readiness`, `proof advance`, provider, receipt และ authority command ยังใช้
ได้ในฐานะ advanced surface ใต้ `help --all` Agent ปกติไม่ประกอบเอง `DONE` ที่
`proven` ไม่ได้ให้อำนาจ Land
