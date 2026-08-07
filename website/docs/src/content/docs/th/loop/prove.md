---
title: /prove
description: ผลิตหลักฐานที่ผูกกับเนื้อหา — ใช้ receipt เดิมซ้ำ รันเฉพาะที่ขาดหรือ stale และไม่รับคำกล่าวอ้างเป็นการผ่าน
---

```text
/prove <change>
```

Prove คือจุดที่ claim หยุดเป็นแค่คำกล่าวอ้าง มันรันใน **context ใหม่** โดยเริ่มจาก `packet <change> --phase prove` ไม่ใช่จากประวัติของ Build — agent ที่เขียนโค้ดไม่ควรได้เอาความมั่นใจในงานตัวเองติดเข้าไปในขั้นที่ตรวจงานนั้น

## รันอะไร

```bash
claude-foundation proof readiness <change>   # blocker แบบมีชนิด + คำสั่งถัดไป
claude-foundation proof run <change>         # readiness, execute, finalize, audit
```

`proof run` ทำสี่ขั้นนั้นแบบ atomic ส่วน `readiness` บอกได้ว่าขาดอะไรบ้างโดยไม่ต้องรันอะไรเลย

## ใช้ซ้ำก่อนรันใหม่

receipt ผูกกับโค้ด ข้อตกลง claim การตั้งค่า environment protocol และ artifact ถ้า input ที่ผูกไว้ไม่เปลี่ยนเลย receipt จะถูกใช้ซ้ำและไม่ต้องรันงานนั้นอีก เปลี่ยนแค่อย่างเดียวมันก็ stale

การประหยัดสามชั้นทบกัน

- **ใช้ซ้ำข้ามรอบ** — receipt ที่ยังใช้ได้อยู่รอดข้ามการพยายาม prove หลายครั้ง
- **ยุบซ้ำระหว่างรัน** — คำสั่ง อาร์กิวเมนต์ environment working directory timeout และ readiness ที่เหมือนกันจะรันครั้งเดียวต่อหนึ่งการ execute
- **ขนานตาม resource** — provider ที่อ่านอย่างเดียวรันทับกันได้ ส่วน `workspace-write`, browser, dev-server และ database เป็น exclusive

provider ประกาศ `inputs` แบบอิงพาธใน workspace ได้ receipt ของมันจึงผูกใหม่ได้เมื่อ *ไฟล์เหล่านั้น* ไม่เปลี่ยน แม้ไฟล์อื่นที่ไม่เกี่ยวใน workspace จะขยับ

## ผลลัพธ์มีสี่แบบ ไม่ใช่สอง

หลักฐานคืนค่าเป็น `pass`, `fail`, `inconclusive` หรือ `error` ทุกอย่างที่ไม่ใช่ `pass` บล็อกการ land

`inconclusive` คือตัวที่คนมักประเมินต่ำไป browser suite ที่ exit 0 แต่ไม่มี claim annotation ครบถือว่า inconclusive — โปรเซสสำเร็จก็จริง แต่ไม่มีอะไรพิสูจน์ claim นั้น เช่นเดียวกับคำสั่งเทสที่ผ่านแต่ไม่เปิดเผยจำนวนเทสที่แน่นอน จะทำให้ discovery เป็น inconclusive ทั้งคู่ไม่ใช่การผ่านแบบหย่อน ๆ

## receipt บันทึกว่ามันถูกผลิตอย่างไร

นี่คือเกณฑ์ขั้นต่ำที่ทำให้คำว่า `PROVEN` มีความหมาย

- receipt ที่ harness รันเองจะมี `execution: "harness"` พร้อม log ของคำสั่ง ค่านี้ถูกตั้งได้เฉพาะจากจุดเรียกที่รันคำสั่งจริง ผ่านอาร์กิวเมนต์ที่ command line ส่งเข้ามาไม่ได้
- ทุกอย่างที่บันทึกด้วยมือเป็น `execution: "manual"` และต้องมี `--observed`, provenance (`--source` หรือ `--reviewer`) และอย่างน้อยหนึ่ง `--artifact` หรือ `--reference`
- `--reference` ต้องเป็น URI หรือ path ที่มีอยู่จริง ข้อความลอย ๆ ไม่นับเป็น reference

receipt ที่ผ่าน **บันทึกด้วยมือไม่ได้** สำหรับ provider ที่ harness เป็นคนรัน `evidence record` ปฏิเสธ `--adapter command`, `test-discovery`, `playwright` และ `contract-digest` และปฏิเสธ receipt ที่ผ่านทุกตัวของ provider ที่ตั้งค่าด้วย adapter เหล่านั้น ให้รัน `proof run` เพื่อให้คำสั่งที่ประกาศไว้เป็นคำสั่งที่ถูกรันจริง

:::note[ทำไมต้องเข้มขนาดนี้]
ในเวอร์ชันก่อน เงื่อนไขเรื่องหลักฐานจริงถูกตัดสินจาก adapter *ที่ผู้เรียกส่งเข้ามา* ผู้เรียกจึงเลือกได้เองว่าจะถูกตรวจหรือไม่ การทำซ้ำ receipt ที่บันทึกมือให้ครบทุก provider จึงผลิต change ที่รายงานว่า `PROVEN` และ `LAND READY` ทั้งที่ไม่ได้รันอะไรเลยสักอย่าง
:::

## อำนาจจากคนและระบบภายนอก

หลักฐานบางอย่างรันในเครื่องไม่ได้ — การรีวิวอิสระ การยอมรับเชิงอัตวิสัย หรือ CI ที่รันบนเครื่องอื่น พวกนี้ใช้สะพาน authority ที่ทำต่อได้

```bash
claude-foundation proof collect <change>
claude-foundation authority request <change> --type review|acceptance
claude-foundation authority status <change> --request <id>
claude-foundation authority record <change> --request <id> --response <file>
```

คำขอบรรจุ packet ที่มีขอบเขต มีวันหมดอายุ และ stale ไปพร้อม workspace คำตอบต้องตรงกับตัวตนของคำขอและ workspace แล้วผ่าน validator ของ review หรือ acceptance ตามปกติ คำขอที่เสร็จแล้วเล่นซ้ำไม่ได้

agent จะแปล packet เป็นภาษาปกติแล้วถามว่าจะตรวจ ส่ง หรือพักไว้ คุณตอบด้วยภาษาปกติ — ไม่มีใครถามคุณเรื่อง syntax ของ receipt, ฟิลด์ provenance หรือ placeholder

**Review** นโยบายระดับ critical บังคับให้ต้องใช้ provider/model คนละตระกูล หรือใช้คน hash chain ระดับ change ผูกกับ payload ของ receipt ทั้งก้อน และจำกัดให้ AI บันทึกได้สองครั้ง แม้ receipt ปัจจุบันจะถูกลบหรือ provider ถูกเปลี่ยนชื่อ ประวัติที่เสียหายจะ fail แบบปิด

**Acceptance** เป็นเรื่องภายนอกและต้องเป็นคนเท่านั้น receipt ที่ผ่านต้องมีขอบเขต claim ที่ชัดเจน, `--acceptor`, `--decision accept`, ค่า `--criterion` ที่ไม่ซ้ำและไม่ว่าง, `--observed`, provenance และ artifact หรือ reference ที่คงอยู่ ทุกครั้งที่อ่านจะตรวจทั้งหมดนี้ซ้ำเทียบกับตัวตนสุดท้ายของ workspace

## CI ที่เซ็นแล้ว

provider ภายนอกประกาศ issuer และ public key แบบ Ed25519 ได้ แล้วนำเข้าซองที่เซ็นและผูกกับ workspace

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

ซองนี้ผูกกับ change, provider, hash ของ workspace, commit (ถ้ามี), URL ของรัน, สถานะ, ผลการสังเกต และ digest ของ artifact ลายเซ็นที่ไม่ถูกต้อง workspace ที่ stale issuer ที่ผิด หรือ artifact ที่ผ่านแต่ไม่ได้เซ็น จะถูกปฏิเสธก่อนที่จะมีการเขียน receipt

## สิ่งที่ Prove ต้องไม่ทำ

ไม่เอาการรีวิวตัวเองมาแทนการรีวิวอิสระ ไม่อ้างว่าผ่านทั้งที่ยังไม่ได้พิสูจน์ และไม่ Land
