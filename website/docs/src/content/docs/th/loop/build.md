---
title: /build
description: ทำตามข้อตกลงที่ compile แล้วใน workspace แยกผ่าน coordinator เดียว
---

```text
/build <change>
```

Build ใช้คำสั่งหลักของ agent เพียงคำสั่งเดียว:

```bash
claude-foundation advance <change> --through build
```

Coordinator ตรวจ agreement สร้างหรือ sync workspace แยก compile dependency ของ
task ตรวจ lease ที่ยังทำงาน แล้วคืน action protocol v3 เพียงหนึ่งตัว เมื่อทำ action
นั้นเสร็จ Agent เรียก `resume` ที่ส่งกลับมา โดยไม่ประกอบ chain ของ `sandbox`,
`packet`, plan และ dispatch เอง

## Action หกแบบ

| Action | ความหมาย |
|---|---|
| `EDIT` | ทำเฉพาะ task, workspace และ path ที่คืนมา แล้วรัน focused check ที่ระบุหนึ่งครั้ง |
| `REPAIR` | แก้ repair batch ที่เรียงตาม dependency ให้ครบแล้ว resume |
| `RUN_EXTERNAL` | รัน boundary operation ที่ตั้งค่าไว้หนึ่งตัว |
| `WAIT` | รอ resource หรือเจ้าของภายนอก โดย state ถูกเก็บไว้ |
| `ASK_USER` | ขาดมติสำคัญหรืออำนาจจริง ๆ |
| `DONE` | ถึงเป้าหมาย Build แล้ว |

ทุก action ที่ยังไม่จบระบุสาเหตุ actor ทางเลือกที่ปลอดภัย state ที่เก็บไว้ และ
resume command ที่แน่นอน Automatic recovery ทำได้เฉพาะในอำนาจปัจจุบัน ระบบไม่
เปลี่ยน lease เก่าหรือการรันซ้ำให้กลายเป็น pass

## Isolation และ concurrency

เขียน product ได้เฉพาะ workspace และ path ที่ `EDIT` คืนมา Shell mutation ต้องเริ่ม
จาก workspace นั้น Worktree มีเฉพาะ tracked files ถ้าต้องติดตั้ง dependency ให้ตั้ง
`sandbox.setupCommand` หรือ setup command ราย repository

Phase hook และ `claude-foundation exec` ใช้ containment policy เดียวกัน ทั้งคู่
ปฏิเสธ absolute operand ที่อยู่นอก workspace, การเปลี่ยน directory ออกภายหลัง และ
การเขียนผ่าน symlink ออกนอก workspace ส่วน `exec` derive phase จาก runtime state
และเริ่ม child process ของ Build ใน canonical workspace นี่ยังเป็น cooperative
containment ดังนั้น host ต้องรับผิดชอบ process isolation สำหรับผลทางอ้อม

Parallel mode คืนเฉพาะ task อิสระพร้อม lease instruction Host ต้องเริ่ม worker ที่
lease สำเร็จทั้งหมดก่อนรอ ตรวจ write จริง แล้ว resume คำสั่งเดิม Primitive อย่าง
`sandbox`, `packet`, `agents plan`, `agents dispatch` ยังอยู่ใน `help --all` สำหรับ
operator และ host integration

## พบ behavior ใหม่ระหว่าง Build

อย่าแก้ OpenSpec หลาย ledger ด้วยมือ ให้ส่ง semantic amendment หนึ่งชุด:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

Compiler รักษา task ที่เสร็จและ manual section ตรวจ agreement ใหม่แบบ transaction
แล้วกลับมา `advance` โดย `updateTasks` เพิ่ม claim coverage ได้ แต่เปลี่ยน outcome
หรือ verify command เดิมไม่ได้ ถ้าสัญญาของ task เปลี่ยนต้องเพิ่ม task ใหม่ งาน cloud,
secret, Terraform, deploy หรือ restart ที่ต้องใช้
สิทธิ์จะเป็น external operation แบบมีชนิด Build ไม่ขอ credential

`DONE` ของ Build ยังไม่ใช่ proof และยังไม่ Land
