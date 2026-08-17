---
title: /land
description: transaction ปิดงานอย่างชัดเจน — apply sandbox ที่พิสูจน์แล้ว ตรวจสอบ sync spec archive แล้วเก็บกวาด
---

```text
/land <change>
```

Land เป็นขั้นเดียวที่แตะ working tree จริงของคุณ และมันชัดเจนโดยเจตนา การมาถึงขั้นนี้ไม่ได้เกิดขึ้นเอง และการที่คุณรันคำสั่งก่อนหน้าไม่ได้แปลว่าคุณยินยอมให้รันขั้นนี้

## ตรวจก่อน

```bash
claude-foundation land check <change>
```

ตรวจว่า projection ที่พิสูจน์แล้วยัง land ได้อยู่ — ความสดของ proof, ความถูกต้องของ receipt, ไม่มี scenario ที่หายไป, ไม่มี task ค้าง และมี projection ที่รันจริง

เมื่อ target มี commit ใหม่ check นี้จะระบุ replay ปกติเป็น automatic recovery
แล้ว Agent จะ sync ทุก writable sandbox ที่ขยับ, Prove งานบน base ใหม่, ตรวจซ้ำ
และทำต่อ พร้อมบอกว่างานถูกเก็บไว้อย่างปลอดภัย โดยไม่ให้คุณเปิด Change ใหม่หรือ
คัดลอกคำสั่งเอง ส่วน replay conflict และตัวเลือกด้าน authority ยังหยุดให้ตัดสินใจ

## แล้วค่อย archive

```bash
claude-foundation land archive <change>
```

การ archive ทำงานผ่าน journal และ journal นั่นแหละที่ทำให้มันกู้คืนได้ ขั้นตอนคือ

1. apply projection ที่พิสูจน์แล้วโดย **รักษาการแก้ไขอื่นที่ไม่เกี่ยวข้อง** ใน working tree ไว้
2. ตรวจตัวตนของ workspace
3. sync spec เข้าไปที่ `openspec/specs/`
4. ตรวจหลักฐาน
5. archive change
6. เก็บกวาดพื้นที่แยก

`ALREADY ARCHIVED` เป็นผลลัพธ์ที่สำเร็จ ไม่ใช่ error — มันแปลว่ารอบก่อนหน้าไปถึงจุดนั้นแล้ว

ก่อนขั้น archive ที่ย้อนกลับไม่ได้ จะมีการซิงก์ telemetry เงียบ ๆ หนึ่งรอบเพื่อดูดข้อมูลจาก transcript ของ session ที่ผูกไว้ บันทึกที่ถูกปิดผนึกจึงมีการใช้งานโมเดลจริงของ change นั้น ถ้า archive ทั้งที่ไม่มีข้อมูลการใช้งานเลย มันจะเตือนว่าคอลัมน์ต้นทุนจะว่าง และบอกคำสั่ง `telemetry sync` ที่รันเองได้ — telemetry ไม่เคยเป็นเงื่อนไขขวางการ archive

`land check` ยังเพิ่มบรรทัด `branch:` ใน `LAND READY` เมื่อรีโปเป้าหมาย checkout อยู่บน `main`/`master` และ `land record` เตือนเมื่อเป้าหมายอยู่บน default branch ทั้งคู่เป็นแค่คำเตือน — guard ของ land ทุกตัวยังอิง commit และการอ่าน branch ที่ล้มเหลวจะเงียบ ไม่ทำให้คำสั่งพัง

:::caution[Land ไม่ commit]
Land ไม่ commit ไม่ push และไม่เปิด pull request สิ่งเหล่านั้นต้องได้รับอนุญาตจากคุณแยกต่างหาก การรัน `/land` ไม่ใช่การอนุญาตให้ push
:::

## งานหลายรีโป

change ที่พาดหลายรีโปจะ land เป็น saga `land check` จะคืน action ถัดไปแบบมีโครงสร้างมาให้ ให้ทำตามนั้นแทนการด้นสด

```bash
claude-foundation land record <change> --repo <id> --commit <sha> --decision-ref <ref> \
  [--ci-attestation <signed.json>] [--ci-required]
claude-foundation land resume <change>
```

`land record` ผูก commit ของรีโปลูก **หลังจากมีการตัดสินใจของผู้ใช้ที่ host บันทึกไว้อย่างชัดเจนแล้ว** `--ci pass` คือคำยืนยันของผู้ปฏิบัติงาน ส่วน `--ci-attestation` รับซอง CI ที่เซ็นด้วย Ed25519 ซึ่ง harness ตรวจสอบได้จริง และ `--ci-required` จะปฏิเสธคำยืนยันที่ไม่ได้เซ็น การผูกของรีโปลูกที่ไม่ใช่ submodule จะถูกรายงานว่าอยู่ใน runtime state เท่านั้น เพราะไม่มีอะไรใน root ที่ version ไว้บันทึกมัน

`land resume` ทำ saga ที่ถูกขัดจังหวะหรือแบบหลายรีโปต่อ มันจะ stage root pointer ที่พร้อมและรายงานเมื่อจำเป็นต้อง Prove ใหม่

การ stage root pointer ที่ถือ commit ที่ land แล้วซ้ำเป็น no-op เดิมมันทำให้ proof เสียทันทีโดยไม่มีเงื่อนไข อะไรก็ตามที่รีเซ็ต index ของ control repository จึงส่ง Land กลับไป Prove แล้ววนกลับมา Land อีก

## เมื่อมีอะไรผิดพลาด

Land ถูกออกแบบให้ล้มเหลวอย่างปลอดภัยและบอกคุณว่ามันทิ้งอะไรไว้

**apply ปฏิเสธที่จะทับงานของ change อื่น** ไฟล์เป้าหมายที่มีการแก้ไขซึ่งยังไม่ commit — เช่นจาก change ที่เพิ่ง land ไปก่อนหน้า — จะไม่ถูกเขียนทับเงียบ ๆ ด้วยการคัดลอกทั้งไฟล์ apply จะปฏิเสธ ระบุ path ที่จะถูกทับ และบอกวิธี reconcile ส่วน symlink ถูกเทียบด้วย link target แบบเดียวกับ blob ของ Git

**apply transaction ที่ค้างจะหยุด apply ครั้งถัดไป** journal ที่ค้างอยู่ในสถานะ `rolling-back` หรือ `manual-recovery` จะไม่ถูกข้าม เพราะไม่อย่างนั้นมันจะเปิด transaction ใหม่ทับ working tree ที่ Foundation กู้คืนไม่สำเร็จ แล้วรายงานว่าสำเร็จ `doctor --change <id>` รายงานเรื่องนี้ก่อนที่ Land จะไปถึง

**การหยุดแบบสิ้นสุดพกทางออกมาด้วย** รอบรีวิวที่ใช้หมด, review chain ที่เสียหาย, งบ continuation ที่ใช้หมด, control repository ที่ขยับกลาง Land, apply ที่ rollback ไม่จบ — แต่ละอย่างส่งซองการตัดสินใจแบบเดียวกัน: รหัสการหยุด, ทางเลือกที่ตรงไปตรงมาอย่างน้อยสองทาง, คำแนะนำ และ `pause` ที่ถูกรักษาไว้

**การกู้คืนจะตรวจ guard ซ้ำ** ถ้า `openspec archive` ย้ายไดเรกทอรีของ change แล้วล้มเหลว การกู้คืนจะตรวจสิ่งที่ยังตรวจได้ก่อนจะเขียนอะไรลงไป และปฏิเสธ projection ที่ไม่เคยรัน

ถ้า change เดินต่อไม่ได้จริง ๆ `change abandon` คือทางออกที่ออกแบบไว้ให้

## ก่อนการกระทำที่ใช้อำนาจ

agent จะอธิบายผลที่มองเห็นได้เป็นภาษาปกติ แล้วเสนอทางเลือกตรวจ ดำเนินการต่อ และพักไว้ การที่คำสั่งใช้ได้ไม่ได้แปลว่าได้รับอนุมัติให้รัน
