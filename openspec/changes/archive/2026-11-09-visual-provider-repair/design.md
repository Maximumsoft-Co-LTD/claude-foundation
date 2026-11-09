# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | change มี visual provider desktop และ mobile ทั้งคู่ fail ใน Prove รอบแรก desktop ได้ repair รอบ 1 แต่ mobile ถูกบันทึกเป็น drift ทันที |
| สาเหตุที่แท้จริง | visualRepairSplit เรียก planVisualRepair ทีละ provider บน state ชุดเดียว ตัวแรกตั้ง lastBatchWorkspaceHash ตัวที่สองจึงถูกตีความว่าเป็นการปฏิเสธ |
| หลักฐาน regression | test ที่ provider สองตัว fail ในรอบเดียวกันแล้วตรวจว่าได้ repair batch เดียวที่มี finding ของทั้งคู่ และไม่มี drift |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** งบ 2 รอบนับรวมทั้ง change โดยหนึ่งรอบคือหนึ่งครั้งที่ Prove รัน
  - **Why:** ผู้ใช้เลือกนับรวมทั้ง change
  - **Rejected:** none
  - **Consequences:** provider ที่เริ่ม fail ในรอบหลังได้รอบซ่อมน้อยกว่าตัวที่ fail ตั้งแต่ต้น
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** drift ของทุก provider ถูกถามในคำถาม visual-drift เดียว และ accept ครอบคลุมทั้งหมด
  - **Why:** ผู้ใช้เลือกถามครั้งเดียวและ accept ทั้งหมดในครั้งเดียว
  - **Rejected:** none
  - **Consequences:** ถ้าต้องการซ่อมบางหน้าจอต้องเลือกซ่อมต่อก่อน accept

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| agent ไม่แก้ทั้งรอบ | drift ถูกบันทึกพร้อม finding ของทั้งสอง provider และถามในคำถามเดียว | ผู้ใช้เลือกซ่อมต่อ ยอมรับ หรือแก้ agreement | visual-multi-provider-one-round |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/repair-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/runtime/workflow/change-validation.mjs`, `.claude/harness/tests/visual-repair.test.mjs`, `.claude/harness/tests/visual-drift-decision.test.mjs`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ EVIDENCE.md
│       ├── runtime/
│       │   ├── evidence/
│       │   │   ├── ~ proof-execution-runtime.mjs
│       │   │   ├── ~ repair-runtime.mjs
│       │   │   └── ~ visual-review.mjs
│       │   └── workflow/
│       │       └── ~ change-validation.mjs
│       └── tests/
│           ├── ~ visual-drift-decision.test.mjs
│           └── ~ visual-repair.test.mjs
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| สอง provider fail พร้อมกัน; agent ไม่แก้ทั้งรอบ; ครบงบ; provider เดียว; state แบบเดิม | task check | `node --test .claude/harness/tests/visual-repair.test.mjs .claude/harness/tests/visual-drift-decision.test.mjs` | T001 |
