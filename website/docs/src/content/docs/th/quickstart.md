---
title: เริ่มใช้งาน
description: พา change หนึ่งตัวจากเจตนาไปจนถึง landed ด้วยห้าคำสั่งตามลำดับ
---

หน้านี้พา change เล็ก ๆ หนึ่งตัวจนจบวงจร คุณคุยกับ coding agent ด้วยภาษาปกติ แล้ว agent เป็นคนรันคำสั่ง — ไม่มีอะไรในนี้ที่บังคับให้คุณต้องจำ syntax ของ CLI

Agent จะใช้ภาษาของคุณ เริ่มจากผลลัพธ์ ทำ recovery ที่ปลอดภัยภายใน authority
ที่คุณให้ไว้ และรายงานว่าแก้อะไรกับตรวจอะไรแล้ว มันจะถามเฉพาะ decision ที่มีผลจริง
ส่วน JSON, hash, receipt และ provider code จะไม่หลุดเข้าบทสนทนาจนกว่าคุณจะขอ
ข้อมูลวิเคราะห์

:::note[Repository เดียวหรือหลายตัว?]
ถ้าใช้ repository เดียวให้ทำตามหน้านี้ได้เลย ถ้า implementation หรือ evidence
ต้องใช้หลาย Git repository ให้อ่าน
[Workflow หลาย Repository](/docs/th/multi-repository/) ก่อนขั้น 1 คำสั่งห้าขั้น
ยังเหมือนเดิม แต่เพิ่มชั้นตั้งค่า scope และ sandbox ของ repository
:::

## 0. เช็คก่อนว่าโปรเจกต์พร้อม

```bash
claude-foundation doctor --stage change
```

Consumer quality เป็นตัวเลือก ถ้าต้องการ changed-code CRAP และ mutation gate
ให้ onboard repository หนึ่งครั้งด้วย `quality discover`, `quality init` และ
`quality doctor` ก่อนเปิด enforcement โดยคง policy เริ่มต้นเป็น report-only
จนตรวจ mapping กับ baseline แล้ว ดู
[Quality gate ของโปรเจกต์](/docs/th/consumer-quality/)

## 1. ตกลงขอบเขต

```text
/change add profile authentication
```

agent จะสร้าง `openspec/changes/add-profile-auth/` แล้วประเมินว่า change นี้ต้องการความเข้มแค่ไหน — impact, coupling, security trigger และต้องให้คนอนุมัติผลลัพธ์หรือไม่ เรื่องไหนที่มีผลสำคัญ **มันจะถามคุณ** ไม่ใช่เดาเอง

Agent เขียน semantic draft หนึ่งชุด: intent, requirement กับ scenario, task
outcome และ evidence ที่ต้องใช้ Harness derive stable ID กับ link แล้ว compile
OpenSpec packet แบบ transaction ทั้งสอง lane มี core แค่ proposal, tasks และ
evidence ส่วน standard เพิ่ม delta spec ขณะที่ design, grounding, custom
execution, repository scope และ handoff จะมีเมื่อ concern นั้นมีจริง Rapid จะ
**อัปเกรดตัวเองในที่** ถ้าพบความเสี่ยง

สิ่งที่คุณควรอ่านและเถียงกลับคือ `proposal.md` กับ delta spec นั่นแหละคือตัวข้อตกลง

## 2. ลงมือแบบแยกพื้นที่

```text
/build add-profile-auth
```

Agent เรียก `advance add-profile-auth --through build` Coordinator จะสร้าง
workspace แยก คืน action ที่มีขอบเขตหนึ่งตัว และ resume ด้วย route เดิม
**working tree ของคุณไม่ถูกแตะ** และ `tasks.md` เป็น ledger เดียว ผู้ใช้ไม่ต้อง
ประกอบ sandbox, packet, plan หรือ dispatch command

## 3. พิสูจน์

```text
/prove add-profile-auth
```

ขั้นนี้คือหัวใจ Change Loop จะใช้ receipt เดิมที่ยังใช้ได้ซ้ำ จัดคิวรันเฉพาะส่วนที่ขาดหรือ stale สั่งเครื่องมือของโปรเจกต์คุณ แล้วตรวจผลลัพธ์

Agent ขับขั้นนี้ด้วย `advance add-profile-auth --through proven`; low-level
`proof` command ยังอยู่สำหรับ operator diagnostic และ integration

หลักฐานกลับมาได้สี่แบบ: `pass`, `fail`, `inconclusive`, `error` อะไรที่ไม่ใช่ pass จะบล็อก change ไว้ และ agent จะย้อนกลับไป Build เพื่อแก้

`inconclusive` **ไม่ใช่การผ่านแบบหย่อน ๆ** — browser suite ที่ exit 0 แต่ไม่มี claim annotation ครบถือว่า inconclusive เพราะไม่มีอะไรพิสูจน์ claim นั้นเลย

Harness จะตรวจ gate หนึ่งรอบ รวบรวมปัญหาที่แก้ได้ทั้งหมดเป็นแผนเดียว แล้วให้ agent
แก้ทั้งชุด จากนั้นตรวจซ้ำเฉพาะ evidence ที่ขาดหรือ stale เพราะการแก้ครั้งนั้น วงจรนี้
ไม่มีการจำกัดจำนวนครั้งแบบตายตัว: ระบบจะทำต่อขณะที่ยังคืบหน้า และถามคุณเฉพาะเมื่อ
ต้องมี decision, permission, external system ที่ยังใช้ไม่ได้ หรือ conflict ที่ต้องตัดสินใจ

## 4. นำเข้าโปรเจกต์

```text
/land add-profile-auth
```

Land เป็นเส้นแบ่งที่ชัดเจน และเป็นขั้นเดียวที่แตะ working tree จริงของคุณ มันตรวจความสดของ proof ซ้ำ, apply เฉพาะ sandbox ที่พิสูจน์แล้วโดยรักษาการแก้ไขอื่นที่ไม่เกี่ยวไว้, sync spec, ตรวจหลักฐาน, archive change แล้วเก็บกวาด sandbox

Agent ขับ transaction ที่ resume ได้ด้วย `advance add-profile-auth --through
archived` มีเพียง state `archived` เท่านั้นที่แปลว่างาน lifecycle เสร็จ

ถ้า target branch ขยับหลัง Prove Agent จะ replay sandbox เดิมบน base ใหม่,
Prove ใหม่ และทำ Land ต่อ คุณไม่ต้องเริ่ม Change หรือรัน recovery เอง แต่ conflict
ที่ replay ไม่ได้จะยังหยุดให้ตัดสินใจแทนการ merge เงียบ ๆ

:::caution
Land ไม่ commit ไม่ push และไม่เปิด PR ให้เอง สิ่งเหล่านั้นต้องได้รับอนุญาตจากคุณแยกต่างหาก
:::

## ย้อนกลับได้

วงจรนี้ไม่ใช่ waterfall ถ้า requirement เปลี่ยนกลางทาง คุณแก้ change ตัวเดิม ไม่ใช่เปิดตัวใหม่

```text
Change ⇄ Build ⇄ Prove
```

Agent ส่ง semantic amendment หนึ่งชุดเข้า change เดิม Harness รักษา completed
task กับ manual section, validate packet ที่ stage ไว้, rollback ถ้าไม่ผ่าน และ
invalidate claim ที่กระทบก่อน resume จึงไม่มีหลักฐานจากข้อตกลงเก่าถูกนับให้
ข้อตกลงใหม่

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

ยังมีทางออกที่เล็กกว่านั้นสำหรับ gate เดียวที่รันแล้ว fail ทั้งที่ตัว gate เองผิด: `change waive --capability <c>` ถอนการบังคับใช้ capability ตัวนั้นตัวเดียวตามการตัดสินใจที่ถูกบันทึกไว้ และ `--revoke` คืนข้อบังคับ ไม่มีเส้นทางที่พา proof ที่ fail ไป land โดยเจตนา
