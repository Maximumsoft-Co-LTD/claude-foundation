# Design

## Work type

bugfix

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Land ติดตั้ง dependency ให้ในโฟลเดอร์ของผู้ใช้
  - **Why:** ผู้ใช้เลือกข้อ 1: ให้ Land ติดตั้งให้
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
  - **Decided by:** user

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| ติดตั้งล้ม | Land ไม่ถูกย้อนกลับ ระบบบันทึกสถานะ failed และแสดงคำสั่งที่ต้องรันเอง | No separate step; the outcome is the handling | post-land-install |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/post-land-install.test.mjs` (add), `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `WORKFLOW.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── runtime/
│   │   │   └── workflow/
│   │   │       ├── ~ apply-runtime.mjs
│   │   │       └── ~ sandbox-runtime.mjs
│   │   └── tests/
│   │       └── + post-land-install.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| lockfile เปลี่ยน; dependency ไม่เปลี่ยน; ปิดการติดตั้ง; ติดตั้งล้ม | task check | `node --test .claude/harness/tests/post-land-install.test.mjs` | T001 |
