# Design

## สถานะปัจจุบัน

preview ใช้ไม่ได้ในโปรเจกต์จริงเลย และ package ล้มทั้งคำสั่งเมื่อ evidence config ผิด

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | ในโปรเจกต์ที่ติดตั้งจริง หลัง change start แล้วรัน preview <change> --provider race-check ได้ 'preview runs only before Build; ... is already change' และ package <change> ที่ evidence.yaml มี provider ไม่มี adapter ได้ BLOCKED แทนไฟล์ package |
| สาเหตุที่แท้จริง | change start ตั้ง state.workspace เป็น { mode: 'current', path: <root> } ก่อน Build แต่ preview ถือว่ามี workspace แปลว่า Build เริ่มแล้ว และ package เรียก evidence() ที่ fail ผ่าน die() ซึ่ง exit process นอก trap ทำให้ try/catch จับไม่ได้ |
| หลักฐาน regression | unit test ของ preview สำหรับทุกรูปแบบ workspace และ CLI test ที่รัน package กับ evidence.yaml ที่ผิด |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| มี sandbox แล้ว | ปฏิเสธด้วยข้อความ only before Build และไม่รันอะไร | preview ก่อน Build หรือพิสูจน์ใน Prove | preview-before-build |
| สถานะ building | ปฏิเสธด้วยข้อความ only before Build | พิสูจน์ใน Prove | preview-before-build |
| provider ไม่มี adapter | exit 0 ไฟล์ package ถูกเขียน และมีคำเตือนที่ระบุ evidence | แก้ evidence.yaml แล้วรัน package ใหม่ | package-tolerates-evidence |

## ความเข้ากันได้และการปล่อย

คำสั่งและรูปแบบ receipt เดิมไม่เปลี่ยน

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/preview-runtime.mjs`, `.claude/harness/tests/preview-runtime.test.mjs` |
| T002 | `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/approval-package.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    └── harness/
        ├── ~ foundation.mjs
        ├── runtime/
        │   └── workflow/
        │       ├── ~ approval-package.mjs
        │       └── ~ preview-runtime.mjs
        └── tests/
            ├── ~ approval-package.test.mjs
            └── ~ preview-runtime.test.mjs
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| workspace เป็น target; ไม่มี workspace; workspace mode อื่นที่ชี้ root; มี sandbox แล้ว; สถานะ building | task check | `node --test .claude/harness/tests/preview-runtime.test.mjs` | T001 |
| provider ไม่มี adapter; evidence.yaml เป็น JSON ที่เสีย; change ที่ไม่มีอยู่ | task check | `node --test .claude/harness/tests/approval-package.test.mjs` | T002 |
