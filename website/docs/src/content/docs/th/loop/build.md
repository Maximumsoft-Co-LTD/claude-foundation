---
title: /build
description: ลงมือทำตามข้อตกลงภายใน Git worktree ที่แยกออกมา โดยมี tasks.md เป็น ledger เดียว
---

```text
/build <change>
```

Build คือขั้นที่ทำตามข้อตกลง เป็นจุดที่ coding agent ได้ทำสิ่งที่มันเก่งจริง ๆ — และมันเกิดขึ้น **นอก working tree ของคุณ**

## การแยกพื้นที่

```bash
claude-foundation sandbox create <change>
```

คำสั่งนี้สร้าง Git worktree แยกไว้ใต้ `.foundation/sandboxes/` working tree ของคุณจะไม่ถูกแตะจนกว่าจะถึง Land ถ้าข้อตกลงถูกแก้ ให้ใช้ `sandbox sync <change>` ดึงการแก้เข้ามาแทนการสร้าง sandbox ใหม่

:::caution[แยกพื้นที่ ไม่ใช่ขอบเขตความปลอดภัย]
sandbox คือ **การแยกพื้นที่ทำงาน** ไม่ใช่ security boundary ระดับ OS โค้ดที่รันในนั้นก็ยังคือโค้ดที่รันบนเครื่องคุณ ตรวจความต่างนี้ได้ด้วย `sandbox inspect <change>`
:::

## เริ่มจาก packet ไม่ใช่จากประวัติ

```bash
claude-foundation packet <change> --phase build
```

packet คือการส่งต่องานแบบมีขอบเขต มันบรรจุเฉพาะสิ่งที่ขั้นถัดไปต้องใช้ agent ไม่ต้องเล่นบทสนทนาซ้ำเพื่อสร้าง context ขึ้นมาใหม่ ซึ่งเป็นเหตุผลที่ session ใหม่หยิบงานที่ session ก่อนเริ่มไว้ต่อได้

ขนาดของ packet ถูกบังคับจริง: 8 KiB สำหรับ task packet, 8 KiB สำหรับ review, 12 KiB ต่อรีโป, 16 KiB รวม และ 4 KiB สำหรับสรุปแผน

## ledger เดียว

`tasks.md` เป็น ledger **เดียว** ไม่มี checklist ที่มิเรอร์ ไม่มีไฟล์สถานะที่สอง และไม่มี lifecycle state ซ่อนอยู่ในหัวของ agent ถ้าอะไรไม่อยู่ใน `tasks.md` แปลว่าไม่ได้ถูกติดตาม

## ขอบเขต

agent แก้ได้เฉพาะ path ที่ sandbox อนุญาต ซึ่งมาจากขอบเขตการเขียนใน `repositories.yaml` ของ change นั้น — change ที่ประกาศว่าแตะรีโปเดียวจะเขียนข้ามไปอีกรีโปเงียบ ๆ ไม่ได้

## งานคู่ขนาน

สำหรับงานหลายรีโป

```bash
claude-foundation repos <change>
claude-foundation sandbox create <change> --all
claude-foundation agents plan <change>
```

แผนจะอนุญาตให้มี worker คู่ขนาน **เฉพาะ** ข้ามรีโปและ resource ที่เป็นอิสระต่อกันจริง ๆ change รีโปเดียวที่มี task ธรรมดาไม่เกินสองอันจะอยู่กับ agent ตัวเดียว เพราะการทำคู่ขนานที่สุดท้ายต้องมารอคิว resource ร่วมกันแพงกว่าที่ประหยัดได้

worker ได้รับแค่ `packet --task <task-id>` ส่วน host เป็นเจ้าของ lease ของ resource

```bash
claude-foundation agents acquire <change> <task> --owner <id>
claude-foundation agents release <change> <task> --owner <id>
```

ถ้า worker crash ขณะถือ lease อยู่ ให้ใช้ `agents release --force` เพื่อยึดคืน แต่ lease ที่ยังไม่หมดอายุต้องใส่ `--decision-ref` ด้วย เพราะ worker ที่ถืออยู่อาจยังทำงานอยู่จริง

## ทำให้ลู่เข้า

รัน check แบบเจาะจงระหว่างทาง แล้วถาม runtime ว่ายังเหลืออะไรขวาง proof อยู่

```bash
claude-foundation proof readiness <change>
```

readiness คืนค่าเป็น **blocker แบบมีชนิด** พร้อมคำสั่งถัดไปที่ถูกต้องของแต่ละอัน แก้ blocker ที่เป็นเรื่องโค้ดและการตั้งค่าให้จบตรงนี้ ใน Build ก่อนจะไปเสียรอบ Prove ใหม่กับมัน

## สิ่งที่ Build ต้องไม่ทำ

Build ไม่เล่นประวัติบทสนทนาซ้ำ ไม่มิเรอร์ task ไปยัง ledger ที่สอง ไม่ archive ไม่ commit และไม่ Land สิ่งเหล่านั้นเป็นอำนาจของขั้นอื่น และการยุบรวมมันคือวิธีที่ change ลงเอยด้วยการถูก apply ทั้งที่ไม่เคยถูกพิสูจน์

## การรันแบบไม่มีคนเฝ้า

host ที่ตั้งใจรันโดยไม่มีคนอยู่ให้ใช้ flag `--unattended` เปล่า ๆ หนึ่งตัวกับ `doctor` และ `sandbox create` มันเป็น flag แบบมีหรือไม่มีเท่านั้น รูปแบบที่ใส่ค่าหรือใส่ซ้ำจะถูกปฏิเสธก่อนที่จะเกิด telemetry การตรวจ workspace หรือการแก้ sandbox ใด ๆ

การตรวจจับเป็นการวินิจฉัย ไม่ใช่การอนุญาต runtime ไม่รับ override ที่ควบคุมจากฝั่ง workspace และจะทำให้การรันแบบไม่มีคนเฝ้าล้มเหลวแบบปิด guard นี้ต้องอาศัยความร่วมมือโดยจำเป็น เพราะ runtime ไม่มีทางรู้ว่าคุณเปิดโหมด "allow all" ในโฮสต์ไว้ — host ที่เปิดโหมดนี้จึงต้องเป็นฝ่ายเรียกรูปแบบที่มี guard เอง
