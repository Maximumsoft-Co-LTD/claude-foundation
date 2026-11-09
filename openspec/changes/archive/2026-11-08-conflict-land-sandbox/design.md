# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | Land change A ที่แก้ WORKFLOW.md โดยยังไม่ commit แล้วสร้าง change B ซึ่ง sandbox คัดลอก WORKFLOW.md ที่ Land แล้วมา B แก้บรรทัดติดกับส่วนของ A advance รายงาน REPAIR_SYNC_CONFLICT ซ้ำทุกครั้งแม้ไฟล์ถูกต้อง |
| สาเหตุที่แท้จริง | carryLandedOutput เก็บ landedCarried เฉพาะตอน bytes ยังไม่ถูกแก้ หลัง change แก้ไฟล์ บันทึกนั้นหายไป replayLandedChanges จึง merge งานที่ Land แล้วจาก base ซ้ำเข้า sandbox ที่มีงานนั้นอยู่แล้ว |
| หลักฐาน regression | test คัดลอกไฟล์ที่ Land แล้วเข้า sandbox แก้บรรทัดติดกัน แล้วตรวจว่า sync ไม่รายงาน conflict และไม่เขียนทับ sandbox |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** บันทึก digest ของ target ตอนคัดลอกไว้จน target เปลี่ยน และถือว่า path นั้น resolved เมื่อ target ยังตรง
  - **Why:** sandbox เริ่มจาก bytes ที่ Land แล้ว การแก้หลังจากนั้นคืองานของ change เอง จึงไม่ต้อง merge ซ้ำ
  - **Rejected:** none
  - **Consequences:** ถ้า change ตั้งใจลบเนื้อหาที่ Land แล้ว ระบบถือเป็นการแก้ของ change นั้น เหมือนการแก้ไฟล์ทั่วไป

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| path ที่ไม่ได้คัดลอก | ระบบรายงาน conflict ตามพฤติกรรมเดิม | agent merge ไฟล์โดยเก็บงานที่ Land แล้วไว้ | landed-carry-no-false-conflict |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/landed-carry-sync.test.mjs` (add), `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── runtime/
│   │   │   └── workflow/
│   │   │       └── ~ sandbox-runtime.mjs
│   │   └── tests/
│   │       └── + landed-carry-sync.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
└── ~ CHANGELOG.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| แก้ต่อจากงานที่คัดลอกมา; target เปลี่ยนหลังคัดลอก; path ที่ไม่ได้คัดลอก | task check | `node --test .claude/harness/tests/landed-carry-sync.test.mjs` | T001 |
