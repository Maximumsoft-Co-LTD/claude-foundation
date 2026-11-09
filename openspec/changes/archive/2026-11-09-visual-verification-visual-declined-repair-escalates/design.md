# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | paid lane visual-prototype-drift: prototype มีแบนเนอร์ BETA ที่ agreement ห้าม reviewer ขอให้เพิ่ม agent ไม่แก้และ resume ระบบส่ง repair เดิมซ้ำ change ค้างที่ building |
| สาเหตุที่แท้จริง | planVisualRepair คืน repair รอบเดิมเมื่อ workspace hash เท่ากับ batch ล่าสุด จึงไม่นับรอบและไม่บันทึก drift |
| หลักฐาน regression | test ที่ resume หลัง repair ของ visual โดย workspace ไม่เปลี่ยนแล้วตรวจว่า drift ถูกบันทึกและไม่มี repair ซ้ำ |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** resume ที่ workspace ไม่เปลี่ยนหลังได้ repair ของ visual ถือว่า agent ไม่แก้ และบันทึก drift ทันที
  - **Why:** ส่ง repair เดิมซ้ำบน workspace เดิมไม่ทำให้ภาพเปลี่ยน การวนไม่มีประโยชน์และขัดกับหลักไม่ block
  - **Rejected:** none
  - **Consequences:** agent ที่ยังไม่ได้ลงมือแก้แต่เรียก advance ซ้ำจะทำให้ drift ถูกบันทึก ผู้ใช้เลือกซ่อมต่อได้จากคำถาม

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| ไม่มี repair ของ visual ก่อนหน้า | ระบบส่ง repair รอบที่ 1 ไม่บันทึก drift | agent แก้หรือ resume โดยไม่แก้เพื่อส่งให้ผู้ใช้ตัดสิน | visual-declined-repair-escalates |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/repair-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ EVIDENCE.md
│       ├── runtime/
│       │   └── evidence/
│       │       ├── ~ proof-execution-runtime.mjs
│       │       └── ~ repair-runtime.mjs
│       └── tests/
│           ├── ~ visual-drift-decision.test.mjs
│           └── ~ visual-repair.test.mjs
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| agent ไม่แก้; agent แก้แล้วยังต่าง; ไม่มี repair ของ visual ก่อนหน้า; ครบ 2 รอบ | task check | `node --test .claude/harness/tests/visual-repair.test.mjs .claude/harness/tests/visual-drift-decision.test.mjs` | T001 |
