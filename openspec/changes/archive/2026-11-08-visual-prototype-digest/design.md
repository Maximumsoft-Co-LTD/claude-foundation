# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | ผูก prototype แบบ strict แล้วแก้ไฟล์สำเนาในโฟลเดอร์ prototype ของ packet จากนั้นอนุมัติใหม่ claim ที่ผูกไว้ไม่ต้องการ visual อีกและ Prove ผ่านโดยไม่มีการเทียบภาพ |
| สาเหตุที่แท้จริง | visualRequiredClaimIds ใน visual-review.mjs คืน claim เฉพาะเมื่อ binding intact และตัวรัน reviewer ไม่ตรวจ digest ของสำเนา |
| หลักฐาน regression | test แก้สำเนา ลบสำเนา และแก้ในโหมด advisory แล้วตรวจว่า visual ยัง required และ provider คืน error โดยไม่เรียก reviewer |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** สำเนาที่ไม่ตรง digest ทำให้ visual ยัง required และ provider คืน error
  - **Why:** การตรวจหลักฐานต้อง fail-closed การตัดทิ้งเงียบ ๆ ทำให้ UI ผ่านโดยไม่มีการเทียบ
  - **Rejected:** none
  - **Consequences:** ถ้าต้องการเปลี่ยน prototype ระหว่าง Build ยังทำไม่ได้เพราะ amendment ไม่รับ prototypeSelection ต้องคืนสำเนาหรือ revise ก่อน Build

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| สำเนา strict ถูกแก้ | claim ที่ผูกไว้ยังต้องการ visual และ receipt visual เป็น error ที่ระบุว่าสำเนาไม่ตรง digest | คืนสำเนาให้ตรงไฟล์ต้นทางใน binding.source หรือ change revise ก่อน Build | visual-binding-fail-closed |
| สำเนา strict หายไป | claim ที่ผูกไว้ยังต้องการ visual และ receipt visual เป็น error ที่ระบุว่าไม่พบสำเนา | คืนสำเนาจาก binding.source | visual-binding-fail-closed |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/tests/visual-binding-drift.test.mjs` (add), `.claude/harness/tests/visual-review.test.mjs`, `.claude/harness/tests/visual-advisory.test.mjs`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── ~ EVIDENCE.md
│   │   ├── runtime/
│   │   │   └── evidence/
│   │   │       └── ~ visual-review.mjs
│   │   └── tests/
│   │       ├── ~ visual-advisory.test.mjs
│   │       ├── + visual-binding-drift.test.mjs
│   │       └── ~ visual-review.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| สำเนา strict ถูกแก้; สำเนา strict หายไป; สำเนา advisory ถูกแก้; สำเนาตรง digest | task check | `node --test .claude/harness/tests/visual-binding-drift.test.mjs .claude/harness/tests/visual-review.test.mjs .claude/harness/tests/visual-advisory.test.mjs` | T001 |
