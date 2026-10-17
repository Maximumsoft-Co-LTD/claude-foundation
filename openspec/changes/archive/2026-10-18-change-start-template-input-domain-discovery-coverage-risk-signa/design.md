# Design

## Work type

bugfix

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** แก้ coverage และคำแนะนำใน template
  - **Why:** ผู้ใช้เลือกหลังเห็นผลสืบ และ POC 6 lane ลดเวลา 30% ค่าใช้จ่าย 14% โดย oracle เต็ม
  - **Rejected:** none
  - **Consequences:** review tier และกฎตรวจคงเดิม งานที่รับค่าจากภายนอกยังได้ review และ coverage
  - **Decided by:** user
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** สร้างตาราง dimension จาก RISK_SIGNAL_DIMENSIONS
  - **Why:** ข้อความที่ agent copy ไม่มีทาง drift จากกฎตรวจ
  - **Rejected:** none
  - **Consequences:** semantic-intake.mjs export ตารางเพิ่มหนึ่ง function
  - **Decided by:** agent

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/runtime/workflow/validation/semantic-intake.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    └── harness/
        ├── runtime/
        │   └── workflow/
        │       ├── ~ change-lifecycle.mjs
        │       └── validation/
        │           └── ~ semantic-intake.mjs
        └── tests/
            └── ~ change-atomic-start.test.mjs
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| คำแนะนำแคบลง; signal อื่นคงเดิม; ทุก signal มี dimension; รูปแบบ row; draft ตามตัวอย่างผ่าน intake | task check | `node --test .claude/harness/tests/change-atomic-start.test.mjs` | T001 |
