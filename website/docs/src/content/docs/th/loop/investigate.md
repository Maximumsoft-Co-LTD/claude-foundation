---
title: /investigate
description: ขั้นสำรวจแบบอ่านอย่างเดียว ใช้เมื่อยังไม่รู้ว่าปัญหา สาเหตุ หรือทิศทางคืออะไร
---

```text
/investigate <ปัญหาหรือการตัดสินใจ> [--compare]
```

**ใช้ขั้นนี้เมื่อคุณยังรู้ไม่พอที่จะเขียนข้อตกลงที่เชื่อถือได้เท่านั้น** มันเป็นขั้นเดียวในวงจรที่เป็นตัวเลือก และการหยิบมาใช้โดยอัตโนมัติมีแต่จะเพิ่มเวลา

เหตุผลที่ควรใช้จริง ๆ

- ยังไม่รู้ต้นตอของปัญหา
- มีหลายแนวทางที่ tradeoff ต่างกันอย่างมีนัยสำคัญ
- ข้อจำกัดเรื่อง compatibility หรือ migration ยังไม่ชัด
- เป็นเส้นทางโค้ด brownfield ที่ไม่คุ้นเคย
- เป็น external API ที่ยังไม่ได้อ่านเอกสารตาม version, success path หรือ failure behavior

## เริ่มจากสิ่งที่ยังไม่รู้

เขียน input เป็นการตัดสินใจที่คุณตัดไม่ลง ไม่ใช่คำสั่งให้ไป implement อะไร

```text
/investigate why profile updates occasionally overwrite newer data
```

ถ้าเป็น change ที่มีอยู่แล้ว ให้ใส่ ID พร้อมคำถามใหม่

```text
/investigate add-profile: should updates use last-write-wins or optimistic locking?
```

## ได้อะไรกลับมา

agent จะอ่านโค้ดที่เกี่ยวข้องแล้วแยกผลลัพธ์ออกเป็น

- **ข้อเท็จจริงที่ยืนยันจากโค้ดจริง**
- **สมมติฐาน** ที่ยังไม่ได้พิสูจน์
- **ข้อจำกัด** และขอบเขตที่ได้รับผลกระทบ
- **ตัวเลือก** พร้อม tradeoff
- **สิ่งที่ยังไม่รู้** ซึ่งต้องให้คุณตัดสินใจ

การแยกนี้คือคุณค่าทั้งหมดของขั้นนี้ เพราะสิ่งที่นำเสนอเป็นข้อเท็จจริงกับสิ่งที่เป็นแค่การเดา นำไปสู่ change ที่ต่างกันมาก และการยุบสองอย่างนี้รวมกันคือวิธีที่ข้อตกลงห่วย ๆ เกิดขึ้น

มันจะจบด้วยหนึ่งในสามอย่างนี้เท่านั้น

```text
ready for /change
needs user decision
not worth changing
```

`not worth changing` เป็นผลลัพธ์ที่ถูกต้องและมีประโยชน์

Agent เริ่มจาก `claude-foundation investigate --template` เก็บ record ที่
`openspec/investigations/<id>.json` และเรียก `claude-foundation investigate
<record.json>` หลังอ่านหลักฐานแต่ละ batch Harness จะค้นและ hash source ที่
เกี่ยวข้อง ตรวจ link ของ fact, hypothesis และ recommendation เก็บ metrics กับ
no-progress state แล้วคืน `EDIT`, `ASK_USER` หรือ `DONE` พร้อม resume route
source ใหม่ที่ค้นพบต้องถูกอ่านและยืนยันใน record ก่อนจบ

แต่ละ batch สร้างรายงานที่อ่านได้ที่ `openspec/investigations/<id>.report.md`
แสดงข้อสรุป เหตุผล แหล่งอ้างอิง สมมติฐานที่ทดสอบ ทางเลือก สิ่งที่ยังไม่รู้ และ
การตัดสินใจถัดไป Agent เขียนในภาษาของผู้ใช้และส่งสรุปสั้นพร้อมลิงก์รายงาน
JSON record ยังคงใช้ร่วมกับระบบเดิมได้ รายงานที่สร้างไม่เป็น source ของการสำรวจ
และไม่เริ่ม Change หากสร้างรายงานไม่ได้ ระบบรักษางานสำรวจไว้และให้ agent ทำต่อ
โดยไม่แสดงรายงานเก่าเป็นผลปัจจุบัน

หากคำถามเกิดจาก Build หรือ Prove workspace ที่มีอยู่ ให้ตั้ง field
`activeChange` ใน record เป็น change ID นั้น source path จะอ้างอิงจาก isolated
workspace ที่ active และ handoff จะผูก source root, base และ identity หาก sandbox
หายหรือ stale ระบบจะคืนคำสั่ง record เดิมที่ใช้ resume โดยไม่ย้อนอ่าน main checkout

## เขียนอะไรได้บ้าง

ขั้นสำรวจเป็น read-only ต่อ product code และ formal change packet งานเขียนปกติ
ของ agent มีเพียง JSON record กับ note ที่เลือกสร้างใต้
`openspec/investigations/`; harness เท่านั้นที่เขียน state ใต้
`.foundation/investigations/` และรายงาน `<id>.report.md` ที่สร้างจาก state
note `<id>.md` ที่ผู้ใช้เขียนไว้จะถูกเก็บรักษา

## โหมดเปรียบเทียบ

สำหรับทางเลือกด้าน experience, API หรือสถาปัตยกรรมที่ยังตัดสินไม่ได้จริง ๆ ให้เติม `--compare`

```text
/investigate dashboard filter interaction --compare
```

จะได้ทางเลือกแบบเบาและใช้แล้วทิ้ง 3–5 แบบใต้ `.foundation/prototypes/<id>/`
ในโหมดนี้ agent จึงเขียนเพิ่มได้ **เฉพาะ** ใน prototype directory โดยไม่แตะ
product code หรือ formal change packet

มันจะเขียน `selection.md` เสมอ เพื่อบันทึกตัวเลือกที่เลือก เหตุผล ทางเลือกที่ตัดทิ้ง และ path ของ artifact และเมื่อหลักฐานตัดสินไม่ได้ มันจะถามคุณแทนที่จะเลือกเอง

:::caution[prototype ไม่ใช่หลักฐาน]
ไฟล์ใต้ `.foundation/prototypes/` ไม่มีอำนาจรับรองโดยเจตนา runtime จะปฏิเสธมัน — รวมถึงการอ้างอิงแบบ local path และต้นทางที่เป็น symlink — ก่อนจะคัดลอก artifact หรือเขียน receipt ใด ๆ prototype ใช้ประกอบการตัดสินใจได้ แต่พิสูจน์ claim ไม่ได้เลย
:::

ไปต่อที่ข้อตกลงพร้อมแนบตัวเลือกที่เลือกไว้

```text
/change <intent> --prototype-selection <selection-path>
```

`/change` จะสรุปการตัดสินใจนั้นลงใน proposal และ design แต่จะไม่ถือว่าตัวเลือกหรือ artifact ของมันเป็นหลักฐาน
ผล `ready-for-change` จาก runtime จะมี `handoff` ที่ผูก digest ให้ agent คัดลอก
เข้า field `investigation` ของ semantic draft; Change จะปฏิเสธหาก state หรือ
source ที่เลือกเปลี่ยนไป
สำหรับ integration บันทึกจะเก็บ source กับ version ของเอกสารให้ชัด `/change`
จึงบังคับ scenario ทั้ง success และ failure ส่วน API ที่ยังไม่อ่านหรือไม่มี version
เป็น research boundary ไม่ใช่ contract ที่เดาได้
