---
title: /build
description: ทำตามข้อตกลงที่ compile แล้วใน workspace แยกผ่าน coordinator เดียว
---

```text
/build <change>
```

Build ใช้คำสั่งหลักของ agent เพียงคำสั่งเดียว:

```bash
claude-foundation advance <change> --through proven
```

Coordinator ตรวจ agreement สร้างหรือ sync workspace แยก compile dependency ของ
task ตรวจ lease ที่ยังทำงาน แล้วคืน action protocol v6 เพียงหนึ่งตัว เมื่อทำ action
นั้นเสร็จ Agent เรียก `resume` ที่ส่งกลับมา โดยไม่ประกอบ chain ของ `sandbox`,
`packet`, plan และ dispatch เอง Proof เริ่มในการเรียกเดียวกันก็ต่อเมื่อ Build เสร็จแล้ว
`/build` จึงไม่ต้องวนกลับมาที่ `DONE` ของ Build แยกอีกรอบ หยุดที่ `proven` และไม่ Land
ถ้าต้องการหยุดแค่ Build ยังใช้ `--through build` ได้

## Action หกแบบ

| Action | ความหมาย |
|---|---|
| `EDIT` | ทำเฉพาะ task, workspace และ path ที่คืนมา เปิดเฉพาะไฟล์ใน `contextFiles` สร้างไฟล์ใน `newFiles` แล้วรัน focused check หนึ่งครั้ง |
| `REPAIR` | แก้ repair batch ที่เรียงตาม dependency ให้ครบแล้ว resume |
| `RUN_EXTERNAL` | รัน boundary operation ที่ตั้งค่าไว้หนึ่งตัว |
| `WAIT` | รอ resource หรือเจ้าของภายนอก โดย state ถูกเก็บไว้ |
| `ASK_USER` | ขาดมติสำคัญหรืออำนาจจริง ๆ |
| `DONE` | ถึงเป้าหมาย Build แล้ว |

ทุก action ที่ยังไม่จบระบุสาเหตุ actor ทางเลือกที่ปลอดภัย state ที่เก็บไว้ และ
resume command ที่แน่นอน Automatic recovery ทำได้เฉพาะในอำนาจปัจจุบัน ระบบไม่
เปลี่ยน lease เก่าหรือการรันซ้ำให้กลายเป็น pass

เมื่อ task ที่ค้างทั้งหมดต้องทำทีละตัวใน repository เดียว `EDIT` จะส่งทุก task มาพร้อมกัน
เรียงตาม dependency ให้ทำให้ครบแล้ว resume ครั้งเดียว `advance` จะรัน `verify` ของแต่ละ
task ใหม่ ติ๊ก task ที่ผ่านใน `tasks.md` ให้เอง และคืนเฉพาะ task ที่ล้ม
(`verificationFailures`) พร้อม task ที่ต้องรอมัน Agent ไม่ต้องแก้ checkbox เอง

## Isolation และ concurrency

เขียน product ได้เฉพาะ workspace และ path ที่ `EDIT` คืนมา Shell mutation ต้องเริ่ม
จาก workspace นั้น (บน Claude Code phase guard จะปัก directory ที่ shell รายงานมาเป็น
anchor ให้เมื่ออยู่ใน workspace แล้ว) Worktree มีเฉพาะ tracked files ถ้าไม่มี setup
command Harness จะรันคำสั่งติดตั้งตาม lockfile ของ workspace เอง (`npm ci` หรือคำสั่ง
frozen-lockfile ของ pnpm, yarn, bun) ตั้ง `sandbox.installDependencies: false` เพื่อปิด
และ `sandbox.setupCommand` หรือ setup command ราย repository ใช้แทนได้ การติดตั้งที่ล้ม
ไม่ block Build: agent จะได้รับคำสั่ง directory และ log ไปทำต่อ ส่วนการ link หรือ copy
`node_modules` ของ checkout เข้า workspace จะถูกปฏิเสธ

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
หรือ verify command ของ task ที่เสร็จแล้วไม่ได้ ถ้าสัญญาของ task เปลี่ยนต้องเพิ่ม task ใหม่
verify command ที่ผิดของ task ที่ยังไม่เสร็จแก้ได้ตรง ๆ โดยคง approval ไว้:
`claude-foundation change amend <change> --task <task> --verify <command>` task จะถูก
รับเมื่อคำสั่งใหม่ผ่านใน workspace เท่านั้น และคำสั่งที่ผ่านเสมอจะถูกปฏิเสธ
`reviseRequirements` และ `removeRequirements` แก้หรือลบ requirement เดิมใน
amendment เดียวกัน จึงไม่ต้อง abandon change เพียงเพราะการตัดสินใจเปลี่ยน งาน cloud,
secret, Terraform, deploy หรือ restart ที่ต้องใช้
สิทธิ์จะเป็น external operation แบบมีชนิด Build ไม่ขอ credential

`DONE` ของ Build ยังไม่ใช่ proof `/build` จึงเดินต่อเข้า Prove ให้อัตโนมัติ เพราะ Prove
ไม่มี side effect ภายนอก และหยุดที่ `proven` โดยไม่ Land
