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

gate ที่รันแล้ว **fail** มีทางออกสามทาง และตัว blocker พิมพ์ให้ครบทั้งสาม: แก้โค้ดแล้ว prove ใหม่, ต่อสาย provider ใหม่ถ้าตัว gate เองผิด หรือ waive capability ตัวนั้นตัวเดียวด้วยการตัดสินใจของผู้ใช้ที่ถูกบันทึกไว้:

```bash
claude-foundation change waive <change> --capability <c> --reason <why> --decision-ref <ref>
```

claim ยังคงประกาศ capability นั้นอยู่ ส่วน waiver เดินทางเป็น advisory `user-waived` เข้าไปใน readiness, บันทึก proof, archive และบรรทัด `LAND READY` โดย `--revoke` คืนข้อบังคับกลับมา waiver เป็นการหักออกเท่านั้น — มันเปลี่ยนสิ่งที่ provider ตัวอื่นรับรองไว้ไม่ได้ receipt ที่ได้มาแล้วจึงยังใช้ได้ และการ prove ใหม่หลัง waive รัน provider ศูนย์ตัว ไม่มีเส้นทางที่พา proof ที่ fail ไป land ได้โดยเจตนา และ `review` กับ `acceptance` ถูกปฏิเสธที่นี่ เพราะมีเส้นทาง waiver ของตัวเองอยู่แล้ว

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

หลักฐานบางอย่างรันในเครื่องไม่ได้ — การรีวิวอิสระ การยอมรับเชิงอัตวิสัย หรือ CI ที่รันบนเครื่องอื่น ปกติให้ขยับ state machine หนึ่งครั้ง

```bash
claude-foundation proof advance <change>
```

`proof advance` รันหลักฐานใน project ที่ขาดหนึ่งครั้ง จัด review ก่อน acceptance และคืน handoff ที่รอทำต่อได้ การเรียกซ้ำบน request เดิมจะไม่ poll, ไม่รัน provider และไม่ dispatch reviewer ซ้ำ การรีวิว AI ที่ตั้งค่าไว้ใช้ `authority run`; named-human review ต้อง reserve packet ด้วย `authority dispatch` ก่อน `authority record`; acceptance ไม่ใช้ review dispatch

คำขอบรรจุ packet ที่มีขอบเขต มีวันหมดอายุ และ stale ไปพร้อม workspace คำตอบต้องตรงกับตัวตนของคำขอและ workspace แล้วผ่าน validator ตามปกติ AI dispatch ที่ crash, abort หรือ tool fail เป็น infrastructure ไม่นับเป็น verdict และ retry แบบ full ได้หนึ่งครั้ง

การปฏิเสธเพราะ stale จะบอกลำดับการกู้คืน ไม่ใช่ตอบว่าไม่เฉย ๆ: `proof is stale` บอกให้แก้ contract กับโค้ดให้จบ ซิงก์ แล้วรัน prove ใหม่หนึ่งรอบ ส่วนคำขอ authority ที่ stale บอกให้ขอ review กับ acceptance เป็นลำดับสุดท้าย หลัง workspace หยุดขยับแล้ว — แต่ละอันระบุคำสั่งที่ใช้ทำต่อให้ด้วย

agent จะแปล packet เป็นภาษาปกติแล้วถามว่าจะตรวจ ส่ง หรือพักไว้ คุณตอบด้วยภาษาปกติ — ไม่มีใครถามคุณเรื่อง syntax ของ receipt, ฟิลด์ provenance หรือ placeholder

**Review** งาน low ใช้ AI full review หนึ่งรอบ และถ้าต้องแก้จะเข้าเส้นทาง full/delta แบบเดียวกับ medium/high delta ต้องปิด finding IDs เดิมและอยู่ใน artifact ที่เปลี่ยน ถ้ารอบสุดท้ายพบ defect ใน contract finding ต้องผูก claim และ critical case; เมื่อแก้แล้ว provider receipt ปัจจุบันจะปิด ID เหล่านั้นแบบ deterministic ไม่มี AI รอบสามและไม่บังคับ human final ความขัดแย้งของ behavior/compatibility/security/data/rollout เท่านั้นที่เปิด Decision Sheet แบบ batch; ขาดสิทธิ์เป็น DevOps handoff

**External operations** Build และ Prove ไม่ถามขอ cloud credential จาก developer งาน AWS/IAM/secret/Terraform/deploy/restart อยู่ใน `handoffs.yaml`; ส่ง `handoff packet` หนึ่งครั้งแล้วรัน evidence ต่อ Land รอ pre-Land หรือ activation-coupled แต่ยอมให้ post-Land ที่มี ticket ค้างได้เฉพาะเมื่อพิสูจน์ว่า merged artifact ยังไม่ activate

**Acceptance** เป็นเรื่องภายนอกและต้องเป็นคนเท่านั้น receipt ที่ผ่านต้องมีขอบเขต claim ที่ชัดเจน, `--acceptor`, `--decision accept`, ค่า `--criterion` ที่ไม่ซ้ำและไม่ว่าง, `--observed`, provenance และ artifact หรือ reference ที่คงอยู่ ทุกครั้งที่อ่านจะตรวจทั้งหมดนี้ซ้ำเทียบกับตัวตนสุดท้ายของ workspace

## CI ที่เซ็นแล้ว

provider ภายนอกประกาศ issuer และ public key แบบ Ed25519 ได้ แล้วนำเข้าซองที่เซ็นและผูกกับ workspace

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

ซองนี้ผูกกับ change, provider, hash ของ workspace, commit (ถ้ามี), URL ของรัน, สถานะ, ผลการสังเกต และ digest ของ artifact ลายเซ็นที่ไม่ถูกต้อง workspace ที่ stale issuer ที่ผิด หรือ artifact ที่ผ่านแต่ไม่ได้เซ็น จะถูกปฏิเสธก่อนที่จะมีการเขียน receipt

## สิ่งที่ Prove ต้องไม่ทำ

ไม่เอาการรีวิวตัวเองมาแทนการรีวิวอิสระ ไม่อ้างว่าผ่านทั้งที่ยังไม่ได้พิสูจน์ และไม่ Land
