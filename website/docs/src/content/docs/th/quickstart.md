---
title: เริ่มใช้งาน
description: พา change หนึ่งตัวจากเจตนาไปจนถึง landed ด้วยห้าคำสั่งตามลำดับ
---

หน้านี้พา change เล็ก ๆ หนึ่งตัวจนจบวงจร คุณคุยกับ coding agent ด้วยภาษาปกติ แล้ว agent เป็นคนรันคำสั่ง — ไม่มีอะไรในนี้ที่บังคับให้คุณต้องจำ syntax ของ CLI

## 0. เช็คก่อนว่าโปรเจกต์พร้อม

```bash
claude-foundation doctor --stage change
```

## 1. ตกลงขอบเขต

```text
/change add profile authentication
```

agent จะสร้าง `openspec/changes/add-profile-auth/` แล้วประเมินว่า change นี้ต้องการความเข้มแค่ไหน — impact, coupling, security trigger และต้องให้คนอนุมัติผลลัพธ์หรือไม่ เรื่องไหนที่มีผลสำคัญ **มันจะถามคุณ** ไม่ใช่เดาเอง

change มีสองรูปแบบ แบบ *rapid* มี proposal, tasks, evidence และ execution wiring ใช้กับงาน impact ต่ำที่แยกขาดเท่านั้น ส่วนแบบ *standard* เพิ่ม delta spec กับเอกสาร design เข้ามา และ rapid จะ **อัปเกรดตัวเองในที่** ถ้าพบความเสี่ยง — ตอนอัปเกรดมันจะบอกว่าลงเอยที่ schema ไหนและสร้างไฟล์ที่ schema ใหม่ต้องการให้ด้วย

สิ่งที่คุณควรอ่านและเถียงกลับคือ `proposal.md` กับ delta spec นั่นแหละคือตัวข้อตกลง

## 2. ลงมือแบบแยกพื้นที่

```text
/build add-profile-auth
```

agent สร้าง Git worktree แยกไว้ใต้ `.foundation/sandboxes/` อ่าน packet ที่กระชับ แล้วลงมือเขียน **working tree ของคุณไม่ถูกแตะ** และ `tasks.md` เป็น ledger เดียว — ไม่มี checklist ที่สองให้ต้องคอยซิงก์

## 3. พิสูจน์

```text
/prove add-profile-auth
```

ขั้นนี้คือหัวใจ Foundation จะใช้ receipt เดิมที่ยังใช้ได้ซ้ำ จัดคิวรันเฉพาะส่วนที่ขาดหรือ stale สั่งเครื่องมือของโปรเจกต์คุณ แล้วตรวจผลลัพธ์

หลักฐานกลับมาได้สี่แบบ: `pass`, `fail`, `inconclusive`, `error` อะไรที่ไม่ใช่ pass จะบล็อก change ไว้ และ agent จะย้อนกลับไป Build เพื่อแก้

`inconclusive` **ไม่ใช่การผ่านแบบหย่อน ๆ** — browser suite ที่ exit 0 แต่ไม่มี claim annotation ครบถือว่า inconclusive เพราะไม่มีอะไรพิสูจน์ claim นั้นเลย

## 4. นำเข้าโปรเจกต์

```text
/land add-profile-auth
```

Land เป็นเส้นแบ่งที่ชัดเจน และเป็นขั้นเดียวที่แตะ working tree จริงของคุณ มันตรวจความสดของ proof ซ้ำ, apply เฉพาะ sandbox ที่พิสูจน์แล้วโดยรักษาการแก้ไขอื่นที่ไม่เกี่ยวไว้, sync spec, ตรวจหลักฐาน, archive change แล้วเก็บกวาด sandbox

:::caution
Land ไม่ commit ไม่ push และไม่เปิด PR ให้เอง สิ่งเหล่านั้นต้องได้รับอนุญาตจากคุณแยกต่างหาก
:::

## ย้อนกลับได้

วงจรนี้ไม่ใช่ waterfall ถ้า requirement เปลี่ยนกลางทาง คุณแก้ change ตัวเดิม ไม่ใช่เปิดตัวใหม่

```text
Change ⇄ Build ⇄ Prove
```

การแก้ข้อตกลงจะ sync sandbox และทำให้ proof ที่ล้าสมัยไปแล้วใช้ไม่ได้ ซึ่งนั่นคือเจตนา — มันกันไม่ให้หลักฐานจากข้อตกลงเก่าถูกนับให้ข้อตกลงใหม่

## ดูสถานะ

```text
/changes
```

แสดง change ที่ active สถานะ อุปสรรค และ action ถัดไปของแต่ละตัว ไม่แก้อะไรเลย จึงรันได้เสมออย่างปลอดภัย

## เมื่อ change พิสูจน์ไม่ได้

บางที change กลายเป็นสิ่งที่พิสูจน์ไม่ได้จริง ๆ — evidence contract ที่ทำให้เป็นจริงไม่ได้ หรือ provider ที่จะไม่มีวันมี ให้ปลดระวางอย่างชัดเจนแทนที่จะไล่ลบไฟล์เอง

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

คำสั่งนี้กักบันทึกของ change ไว้ใต้ `.foundation/recovery/abandoned/<id>/` แทนการลบทิ้ง ไม่แตะ Git และปฏิเสธ change ที่ archive ไปแล้ว agent จะเสนอทางนี้เมื่อเข้าเงื่อนไข แต่จะไม่ปลดระวาง change โดยไม่ถามคุณก่อน
